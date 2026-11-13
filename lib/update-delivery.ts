// Delivers event_updates rows to GHL: one contact note per row and one POST to
// the GHL_UPDATE_WEBHOOK_URL inbound webhook. Called directly by the chat route
// right after applyEventUpdate, and by /api/update-webhook as a manual retry.
// The outcome is written back on the row (note_created, webhook_sent) so a
// retry only redoes what failed.

import { supabase } from "@/lib/supabase";
import { createNoteByEmail } from "@/lib/ghl-api";
import { getSession, type EventUpdateRow, type SessionRow } from "@/lib/event-updates";
import { eventTimeZone } from "@/lib/team/markets";
import { buildUpdateNote, buildUpdatePayload, createdByFields } from "@/lib/update-notes";
import { buildEventFields, buildNatalieSupplyList } from "@/lib/ghl-payload";
import { withHoursBooked } from "@/lib/price-change";
import { changeRequestFields } from "@/lib/client-list";
import { notifyStaffOfUpdate } from "@/lib/team/assignments-db";
import { deliveryFields, type DeliveryListOptions } from "@/lib/client-list-db";
import { computeDeadlines } from "@/lib/event-diff";
import { syncOrderSheet } from "@/lib/order-sheet-db";

export interface DeliveryResult {
  id: string;
  version: number;
  note_created: boolean;
  webhook_sent: boolean;
  error: string | null;
}

export async function postWebhook(url: string, payload: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return null;
    const body = (await res.text().catch(() => "")).slice(0, 300);
    return `GHL webhook responded ${res.status}${body ? `: ${body}` : ""}`;
  } catch (err) {
    return `GHL webhook request failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * A GHL payload that is not an event update: the first list after a custom
 * recipe review, a change request waiting for an admin, an approved request
 * with nothing new to apply, or a decline. Goes to the update webhook with
 * event_updated false, so the intake workflow never runs again.
 */
export function listOnlyPayload(session: SessionRow, extra: Record<string, unknown>): Record<string, unknown> {
  const eventData = withHoursBooked(session.event_data ?? {}, session);
  const { cleanEventData, fields } = buildEventFields(eventData);
  const payload: Record<string, unknown> = {
    ...cleanEventData,
    ...fields,
    natalie_supply_list: buildNatalieSupplyList(eventData) || null,
    event_updated: false,
    event_update_applied: false,
    list_change_declined: false,
    ...changeRequestFields(),
    ...createdByFields(session),
    ...extra,
  };
  if (!payload.email && session.email) payload.email = session.email;
  return payload;
}

export async function postListOnly(session: SessionRow, extra: Record<string, unknown>): Promise<string | null> {
  const url = process.env.GHL_UPDATE_WEBHOOK_URL;
  if (!url) return "GHL_UPDATE_WEBHOOK_URL is not set in this environment, payload NOT sent";
  return postWebhook(url, listOnlyPayload(session, extra));
}

async function deliverRow(
  session: SessionRow,
  row: EventUpdateRow & { note_created?: boolean },
  extra: Record<string, unknown> = {}
): Promise<DeliveryResult> {
  const tag = `[update-webhook] session ${session.id} update ${row.id} v${row.version}`;
  const errors: string[] = [];

  // Note first. Skipped on retry if it already went through, so retries do not duplicate it.
  let noteCreated = row.note_created === true;
  if (!noteCreated) {
    const email = (session.event_data?.email as string) || session.email || "";
    const note = await createNoteByEmail(email, buildUpdateNote(row, session)).catch((err) => ({
      success: false,
      contactId: null,
      reason: err instanceof Error ? err.message : String(err),
    }));
    noteCreated = note.success;
    if (!noteCreated) errors.push(`GHL note not created: ${note.reason ?? "unknown"}`);
  }

  // A separate GHL inbound webhook, so updates never retrigger the intake workflow.
  const webhookUrl = process.env.GHL_UPDATE_WEBHOOK_URL;
  let webhookSent = false;
  if (!webhookUrl) {
    errors.push("GHL_UPDATE_WEBHOOK_URL is not set in this environment, payload NOT sent");
  } else {
    const webhookError = await postWebhook(webhookUrl, buildUpdatePayload(session, row, extra));
    webhookSent = webhookError === null;
    if (webhookError) errors.push(webhookError);
  }

  const error = errors.length > 0 ? errors.join("; ") : null;
  if (error) {
    console.error(`${tag} note_created=${noteCreated} webhook_sent=${webhookSent} error: ${error}`);
  } else {
    console.log(`${tag} note_created=true webhook_sent=true`);
  }

  const { error: saveError } = await supabase
    .from("event_updates")
    .update({
      note_created: noteCreated,
      webhook_sent: webhookSent,
      webhook_sent_at: webhookSent ? new Date().toISOString() : null,
      webhook_error: error,
    })
    .eq("id", row.id);
  if (saveError) console.error(`${tag} could not save delivery status:`, saveError.message);

  return { id: row.id, version: row.version, note_created: noteCreated, webhook_sent: webhookSent, error };
}

/**
 * Send each row's note and webhook payload. The payload carries the session's
 * current event_data, so the session is read fresh here. Never throws.
 *
 * With staffOrigin (the chat route passes it), each assigned staff member also
 * gets a text with a link to their event page. The manual retry leaves it out
 * so a retry never texts staff twice. A text failure never blocks delivery.
 *
 * Each payload carries the client shopping list fields (decided once per
 * update, see deliveryFields) and the order sheet link. clientList says who
 * caused the update: the client (the default), an admin edit and whether its
 * "Send updated list to client" box was on, or an approved held change.
 * extra is added to every payload (an approved change request says so).
 */
export async function deliverEventUpdates(
  sessionId: string,
  rows: EventUpdateRow[],
  opts: { staffOrigin?: string; clientList?: DeliveryListOptions; extra?: Record<string, unknown> } = {}
): Promise<DeliveryResult[]> {
  if (rows.length === 0) return [];
  const session = await getSession(sessionId);
  if (!session || !session.event_data) {
    console.error(`[update-webhook] session ${sessionId} not found or has no event_data, nothing sent`);
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      note_created: false,
      webhook_sent: false,
      error: "session not found",
    }));
  }

  const changedFields = rows.filter((r) => r.applied).flatMap((r) => (r.changes ?? []).map((c) => c.field));
  const staffTexts = opts.staffOrigin
    ? notifyStaffOfUpdate(session, changedFields, opts.staffOrigin).catch(() => 0)
    : Promise.resolve(0);

  // Hand edits on the order sheet are kept; lines that left the calculation are tidied up.
  await syncOrderSheet(session).catch((err) => console.error(`[update-webhook] session ${sessionId} order sheet sync failed:`, err));

  const locked = computeDeadlines(session.event_data.event_date ?? session.event_date, new Date(), eventTimeZone(session)).withinSixDays;
  const listFields = await deliveryFields(session, rows, opts.clientList ?? { mode: "client" }, locked).catch((err) => {
    console.error(`[update-webhook] session ${sessionId} client list decision failed:`, err);
    return new Map<string, Record<string, unknown>>();
  });

  const results: DeliveryResult[] = [];
  for (const row of rows) {
    try {
      results.push(await deliverRow(session, row, { list_change_declined: false, ...((listFields.get(row.id) ?? {}) as Record<string, unknown>), ...(opts.extra ?? {}) }));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[update-webhook] session ${sessionId} update ${row.id} failed:`, error);
      results.push({ id: row.id, version: row.version, note_created: false, webhook_sent: false, error });
    }
  }
  const texted = await staffTexts;
  if (texted > 0) console.log(`[update-webhook] session ${sessionId}: texted ${texted} assigned staff`);
  return results;
}

/**
 * Rows for a session that still need delivery: webhook_sent is false. The
 * version 1 initial submission rows went out through the intake webhook and are
 * excluded. With updateIds, only those rows are considered.
 */
export async function getUndeliveredUpdates(sessionId: string, updateIds?: string[]): Promise<EventUpdateRow[]> {
  let query = supabase
    .from("event_updates")
    .select("*")
    .eq("session_id", sessionId)
    .eq("webhook_sent", false)
    // Initial submissions went out through the intake webhook, and old signed change
    // orders are applied by /api/manager-update, which never fires this webhook.
    .not("summary", "in", '("Initial submission","Change order signed")')
    .order("version", { ascending: true })
    .order("created_at", { ascending: true });
  if (updateIds && updateIds.length > 0) query = query.in("id", updateIds);

  const { data, error } = await query;
  if (error) throw new Error(`event_updates lookup failed: ${error.message}`);
  return (data as EventUpdateRow[]) ?? [];
}
