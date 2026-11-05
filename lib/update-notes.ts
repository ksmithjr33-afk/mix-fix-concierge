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
// "Needs manager approval: ..." line right under the title.

import { buildEventFields, buildNatalieSupplyList } from "@/lib/ghl-payload";
import { approvalReason, changeBlocks, summarizeRow } from "@/lib/event-diff";
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
  const lines = [row.applied ? `EVENT UPDATE v${row.version}` : "EVENT CHANGE REQUEST"];
  const reason = approvalReason(row);
  if (reason) lines.push(`Needs manager approval: ${reason}`);
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
  const eventData = session.event_data ?? {};
  const { cleanEventData, fields } = buildEventFields(eventData);
  const payload: Record<string, unknown> = {
    ...cleanEventData,
    ...fields,
    natalie_supply_list: buildNatalieSupplyList(eventData) || null,
    event_updated: row.applied,
    update_version: row.version,
    update_summary: buildUpdateSummary(row),
    within_deadline: row.within_deadline,
  };
  if (!payload.email && session.email) payload.email = session.email;
  return payload;
}
