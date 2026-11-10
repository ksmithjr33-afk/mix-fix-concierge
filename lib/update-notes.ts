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
// Unapplied rows (extra drink requests) are titled EVENT CHANGE REQUEST with a
// "Needs manager approval: ..." line right under the title. An update that
// changed the price has the price line under the title, and one made inside six
// days of the event says so.

import { buildEventFields, buildNatalieSupplyList } from "@/lib/ghl-payload";
import { approvalReason, changeBlocks, computeDeadlines, summarizeRow } from "@/lib/event-diff";
import { pendingChangeFields, withHoursBooked } from "@/lib/price-change";
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

/** True when the update came in fewer than six days before the event (America/Chicago). */
export function withinSixDays(row: EventUpdateRow, session: SessionRow | null): boolean {
  const date = session?.event_data?.event_date ?? session?.event_date ?? null;
  return computeDeadlines(date, new Date(row.created_at)).withinSixDays;
}

/** Plain text GHL note for one event_updates row. */
export function buildUpdateNote(row: EventUpdateRow, session: SessionRow | null = null): string {
  const lines: string[] = [];
  lines.push(row.applied ? `EVENT UPDATE v${row.version}` : "EVENT CHANGE REQUEST");
  const reason = approvalReason(row);
  if (reason) lines.push(`Needs manager approval: ${reason}`);
  if (row.applied && row.change_order?.price_text) lines.push(`Price: ${row.change_order.price_text}`);
  if (withinSixDays(row, session)) lines.push("Within 6 days of the event");
  if (row.change_approval_needed) lines.push("Change approval needed: client asked for something outside the rules");
  if (row.updated_by === "admin") lines.push(`Updated by admin: ${row.updated_by_name || "team member"}`);
  lines.push(noteTimestamp(row.created_at));
  const client = clientLine(session);
  if (client) lines.push(client);
  lines.push("", "WHAT CHANGED", "", changeBlocks(row.changes).join("\n\n"));
  return lines.join("\n");
}

/** The plain text update_summary for a row, rebuilt from its changes so old rows get the current format. */
export function buildUpdateSummary(row: EventUpdateRow): string {
  return summarizeRow(row);
}

/** GHL webhook payload for one update: the merged event plus regenerated documents. */
export function buildUpdatePayload(session: SessionRow, row: EventUpdateRow): Record<string, unknown> {
  const eventData = withHoursBooked(session.event_data ?? {}, session);
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
    within_six_days: withinSixDays(row, session),
    // Every update applies right away, nothing waits on a signature.
    needs_change_order: false,
    // The price change saved with this update, so the team can charge or credit it.
    ...pendingChangeFields(row.applied ? row.change_order : null, row.changes, session),
    payment_preference: (eventData.payment_preference as string | undefined) || "",
    change_approval_needed: row.change_approval_needed ? "Yes" : "No",
    booked_total: session.booked_price?.total ?? null,
    // Who made the change, so the team can tell an admin edit from a client change.
    updated_by: row.updated_by === "admin" ? "admin" : "client",
    updated_by_name: row.updated_by === "admin" ? row.updated_by_name || "" : "",
  };
  if (!payload.email && session.email) payload.email = session.email;
  return payload;
}
