// GHL note text and webhook payload for one event_updates row.
//
// Note layout, plain text only:
//
//   EVENT UPDATE v3
//   Nov 4, 2026, 9:10 PM
//   Raiden Utt, Wedding, 12/19/2026, 175 guests
//
//   WHAT CHANGED
//
//   Day of contact
//     Was: TBD, client will provide later
//     Now: Jazzy Fries
//
// Unapplied rows are titled EVENT CHANGE REQUEST with a
// "Needs manager approval: ..." line right under the title. Change order rows
// are titled CHANGE ORDER SENT with the price line under it.

import { buildEventFields, buildNatalieSupplyList } from "@/lib/ghl-payload";
import { approvalReason, changeBlocks, isChangeOrderRow, summarizeRow } from "@/lib/event-diff";
import { pendingChangeFields } from "@/lib/change-order";
import { parseEventDate } from "@/lib/event-date";
import type { EventUpdateRow, SessionRow } from "@/lib/event-updates";

/** "Nov 4, 2026, 9:10 PM" in Dallas time. */
function noteTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(/[  ]/g, " ");
}

function text(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** "Raiden Utt, Wedding, 12/19/2026, 175 guests", skipping whatever is missing. */
function clientLine(session: SessionRow | null): string {
  if (!session) return "";
  const ed = session.event_data ?? {};
  const name = text(ed.client_name) || text(session.name);
  // "Wedding or Reception" reads as "Wedding".
  const type = text(ed.event_type).split(/\s+or\s+/i)[0];
  const rawDate = text(ed.event_date) || text(session.event_date);
  const d = parseEventDate(rawDate);
  const date = d ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : rawDate;
  const guests = text(ed.guest_count) || text(session.guest_count);
  return [name, type, date, guests ? `${guests} guests` : ""].filter(Boolean).join(", ");
}

/** Plain text GHL note for one event_updates row. */
export function buildUpdateNote(row: EventUpdateRow, session: SessionRow | null = null): string {
  const lines: string[] = [];
  if (isChangeOrderRow(row) && !row.change_order) {
    lines.push("CHANGE ORDER CANCELED", "Client went back to the booked details, nothing to sign");
  } else if (isChangeOrderRow(row)) {
    lines.push("CHANGE ORDER SENT", "Waiting on client signature, not applied yet");
    if (row.change_order?.price_text) lines.push(row.change_order.price_text);
  } else {
    lines.push(row.applied ? `EVENT UPDATE v${row.version}` : "EVENT CHANGE REQUEST");
    const reason = approvalReason(row);
    if (reason) lines.push(`Needs manager approval: ${reason}`);
  }
  if (row.change_approval_needed) lines.push("Change approval needed: client asked for something outside the rules");
  lines.push(noteTimestamp(row.created_at));
  const client = clientLine(session);
  if (client) lines.push(client);
  lines.push("", "WHAT CHANGED", "", changeBlocks(row.changes).join("\n\n"));
  return lines.join("\n");
}

/** The plain text update_summary for a row, rebuilt from its changes so old rows get the current format. */
export function buildUpdateSummary(row: EventUpdateRow): string {
  // Change order rows keep the "Change order sent:" summary saved with them.
  if (isChangeOrderRow(row) && row.summary) return row.summary;
  return summarizeRow(row);
}

/** GHL webhook payload for one update: the merged event plus regenerated documents. */
export function buildUpdatePayload(session: SessionRow, row: EventUpdateRow): Record<string, unknown> {
  const eventData = session.event_data ?? {};
  const { cleanEventData, fields } = buildEventFields(eventData);
  const payload: Record<string, unknown> = {
    ...cleanEventData,
    ...fields,
    natalie_supply_list: buildNatalieSupplyList(eventData) || null,
    event_updated: true,
    event_update_applied: row.applied,
    update_version: row.version,
    update_summary: buildUpdateSummary(row),
    within_deadline: row.within_deadline,
    // Change order rows carry the pending change as priced when it was sent.
    needs_change_order: isChangeOrderRow(row) && !!row.change_order,
    ...pendingChangeFields(isChangeOrderRow(row) ? row.change_order : session.pending_change),
    payment_preference: (eventData.payment_preference as string | undefined) || "",
    change_approval_needed: row.change_approval_needed ? "Yes" : "No",
    booked_total: session.booked_price?.total ?? null,
  };
  if (!payload.email && session.email) payload.email = session.email;
  return payload;
}
