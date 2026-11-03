// GHL note text and webhook payload for one event_updates row.

import { buildEventFields, buildNatalieSupplyList } from "@/lib/ghl-payload";
import { chicagoToday, formatValue, fieldLabel } from "@/lib/event-diff";
import type { EventUpdateRow, SessionRow } from "@/lib/event-updates";

function noteDate(iso: string): string {
  const [y, m, d] = chicagoToday(new Date(iso)).split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/**
 * Plain text GHL note for one event_updates row. Applied rows are titled
 * "EVENT UPDATE v[version] [date]". Late drink changes and manager requests
 * were not applied, so they get a change request title instead.
 */
export function buildUpdateNote(row: EventUpdateRow): string {
  const date = noteDate(row.created_at);
  const title = row.applied
    ? `EVENT UPDATE v${row.version} ${date}`
    : row.within_deadline === false
      ? `EVENT CHANGE REQUEST ${date} (past deadline, manager to confirm)`
      : `EVENT CHANGE REQUEST ${date} (manager to reach out)`;

  const lines = [title, ""];
  for (const c of row.changes) {
    if (c.field === "manager_request") {
      lines.push(`Request: ${formatValue(c.new)}`);
    } else {
      lines.push(`${fieldLabel(c.field)}`);
      lines.push(`  Old: ${formatValue(c.old)}`);
      lines.push(`  New: ${formatValue(c.new)}`);
    }
  }
  lines.push("", `Source: ${row.source}`);
  return lines.join("\n");
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
    update_summary: row.summary,
    within_deadline: row.within_deadline,
  };
  if (!payload.email && session.email) payload.email = session.email;
  return payload;
}
