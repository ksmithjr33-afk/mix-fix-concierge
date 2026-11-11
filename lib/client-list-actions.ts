// Admin actions on held client shopping lists, from the admin event page:
// Approve or Decline a client change held inside six days, and Review and send
// the first list of an event with a custom recipe. Server only, admins only.

import { applyEventUpdate, getSession, type SessionRow } from "@/lib/event-updates";
import { deliverEventUpdates, postWebhook } from "@/lib/update-delivery";
import { buildEventFields, buildNatalieSupplyList } from "@/lib/ghl-payload";
import { withHoursBooked } from "@/lib/price-change";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { clientList, clientListFields } from "@/lib/client-list";
import {
  autoSendOn,
  clientListLink,
  decideHold,
  getHold,
  logApprovedNoChange,
  logDecline,
  orderSheetLink,
  releaseFirstList,
  type Actor,
} from "@/lib/client-list-db";

export type HoldResult = { ok: true; message: string } | { ok: false; error: string; status: number };

/**
 * A GHL payload that is not an event update: the first list after a custom
 * recipe review, a held change sent with nothing new to apply, or a decline.
 * Goes to the update webhook with event_updated false, so the intake workflow
 * never runs again.
 */
function listOnlyPayload(session: SessionRow, extra: Record<string, unknown>): Record<string, unknown> {
  const eventData = withHoursBooked(session.event_data ?? {}, session);
  const { cleanEventData, fields } = buildEventFields(eventData);
  const payload: Record<string, unknown> = {
    ...cleanEventData,
    ...fields,
    natalie_supply_list: buildNatalieSupplyList(eventData) || null,
    event_updated: false,
    event_update_applied: false,
    list_change_declined: false,
    ...extra,
  };
  if (!payload.email && session.email) payload.email = session.email;
  return payload;
}

async function postListOnly(session: SessionRow, extra: Record<string, unknown>): Promise<string | null> {
  const url = process.env.GHL_UPDATE_WEBHOOK_URL;
  if (!url) return "GHL_UPDATE_WEBHOOK_URL is not set in this environment, payload NOT sent";
  return postWebhook(url, listOnlyPayload(session, extra));
}

function actor(admin: StaffMember): Actor {
  return { id: admin.id, name: firstName(admin.name) || "Admin" };
}

async function pendingHold(holdId: unknown, sessionId: unknown, kind: "change" | "custom_recipe") {
  if (typeof holdId !== "string" || typeof sessionId !== "string") return null;
  const hold = await getHold(holdId);
  if (!hold || hold.session_id !== sessionId || hold.kind !== kind) return null;
  return hold;
}

/** Approve: apply the held change (no six day cutoff, the engine's price) and send the list with reason "approved". */
export async function approveHold(admin: StaffMember, sessionId: unknown, holdId: unknown, origin: string): Promise<HoldResult> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const hold = await pendingHold(holdId, sessionId, "change");
  if (!hold) return { ok: false, error: "We could not find that held change.", status: 404 };
  if (hold.status !== "pending") return { ok: false, error: "That change was already decided.", status: 409 };
  const by = actor(admin);
  if (!(await decideHold(hold.id, "approved", by))) return { ok: false, error: "That change was already decided.", status: 409 };

  const result = await applyEventUpdate(hold.session_id, hold.partial ?? {}, {
    source: "manager",
    ignoreCutoff: true,
    editor: { name: by.name, staffId: by.id },
  });
  if (!result) return { ok: false, error: "We could not find that event.", status: 404 };

  if (result.rows.some((r) => r.applied)) {
    await deliverEventUpdates(hold.session_id, result.rows, { staffOrigin: origin, clientList: { mode: "approved", by, holdId: hold.id } });
    return { ok: true, message: "Approved. The change is saved and the updated list went to the client." };
  }
  // Already on file: nothing to apply, the client still hears it was approved.
  const session = await getSession(hold.session_id);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const enabled = await autoSendOn();
  const fields = clientListFields({ enabled, send: true, reason: "approved", changes: "", url: clientListLink(session.id), list: clientList(session.event_data ?? {}) });
  await postListOnly(session, { ...fields, order_sheet_url: orderSheetLink(session.id) });
  await logApprovedNoChange(session, hold, by, { sent: fields.client_shopping_list_send });
  return { ok: true, message: "Approved. It was already on file, so nothing else changed." };
}

/** Decline: the event stays as it is, and GHL gets list_change_declined so it can text the client. */
export async function declineHold(admin: StaffMember, sessionId: unknown, holdId: unknown): Promise<HoldResult> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const hold = await pendingHold(holdId, sessionId, "change");
  if (!hold) return { ok: false, error: "We could not find that held change.", status: 404 };
  const by = actor(admin);
  if (!(await decideHold(hold.id, "declined", by))) return { ok: false, error: "That change was already decided.", status: 409 };
  const session = await getSession(hold.session_id);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const enabled = await autoSendOn();
  const fields = clientListFields({ enabled, send: false, reason: null, changes: "", url: clientListLink(session.id), list: clientList(session.event_data ?? {}), declined: true });
  await postListOnly(session, { ...fields, order_sheet_url: orderSheetLink(session.id), list_change_declined_summary: hold.summary ?? "" });
  await logDecline(session, hold, by);
  return { ok: true, message: "Declined. The event was not changed, and GHL was told so it can text the client." };
}

/** Review and send: the first list of an event with a custom recipe, after an admin checked it. */
export async function reviewAndSend(admin: StaffMember, sessionId: unknown, holdId: unknown): Promise<HoldResult> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const hold = await pendingHold(holdId, sessionId, "custom_recipe");
  if (!hold) return { ok: false, error: "We could not find that held list.", status: 404 };
  const by = actor(admin);
  if (!(await decideHold(hold.id, "approved", by))) return { ok: false, error: "That list was already sent.", status: 409 };
  const session = await getSession(hold.session_id);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const fields = await releaseFirstList(session, hold.id, by);
  const error = await postListOnly(session, { ...fields });
  if (error) console.error(`[client-list] session ${session.id} review and send:`, error);
  return { ok: true, message: fields.client_shopping_list_send ? "Sent. The client's first list went out." : "Reviewed. Auto send is off, so nothing went to the client." };
}
