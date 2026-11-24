// The "who is on it" line on the /team/events cards (list, calendar, Past
// events). Pure, no database, so the test scripts can check it. The names come
// from one query for the whole list in lib/team/team-db.ts.
//
// - Accepted people first, by first name, with the role after everyone but
//   bartenders: "Jayde, Shontae, Marcus (bar back)". Bartenders before other
//   roles, then in the order they were offered the event.
// - Offered and not answered yet after them: "Sam (not answered)", shown lighter.
// - Declined people never show.
// - Open spots at the end, in red: "1 bartender still needed", "bar back
//   needed", or "No one assigned yet" when nobody is on it. Only on events
//   that have not happened yet.
// - Staff see it only on their own events, never with their own name in it,
//   and only first names (everyone does).

import { roleSuffix } from "@/lib/team/roles";

// Kept here (not imported from event-view) so the calendar, a client
// component, can use teamLineText without pulling the event view in.
const firstName = (name: string): string => String(name ?? "").trim().split(/\s+/)[0] ?? "";

export interface TeamPerson {
  staffId: string;
  name: string;
  role: string;
  status: string; // "offered" | "accepted" | "declined"
  assignedAt: string;
}

export interface TeamLine {
  accepted: string[]; // "Marcus (bar back)"
  pending: string[]; // "Sam (not answered)"
  needed: string; // "1 bartender still needed", "" when nothing is open
}

export interface TeamNeeds {
  bartenders: number | null; // bartenders the event needs, null when unknown
  barback: boolean; // the package has a barback on
}

const BAR_BACK = "bar_back";

function order(a: TeamPerson, b: TeamPerson): number {
  const ra = a.role === "bartender" || !a.role ? 0 : 1;
  const rb = b.role === "bartender" || !b.role ? 0 : 1;
  return ra - rb || (a.assignedAt ?? "").localeCompare(b.assignedAt ?? "") || a.name.localeCompare(b.name) || a.staffId.localeCompare(b.staffId);
}

/** "1 bartender still needed", "bar back needed", both, "No one assigned yet", or "". */
export function neededText(onIt: TeamPerson[], needs: TeamNeeds): string {
  if (onIt.length === 0) return "No one assigned yet";
  const parts: string[] = [];
  // Only people working the event as Bartender fill bartender spots (the role on the assignment).
  const bartenders = onIt.filter((p) => p.role === "bartender" || !p.role).length;
  const open = needs.bartenders === null ? 0 : Math.max(0, needs.bartenders - bartenders);
  if (open > 0) parts.push(`${open} bartender${open === 1 ? "" : "s"} still needed`);
  if (needs.barback && !onIt.some((p) => p.role === BAR_BACK)) parts.push("bar back needed");
  return parts.join(", ");
}

/**
 * The line for one event. `viewerId` (staff only) leaves the viewer out of the
 * names. `upcoming` false (a past event) drops the open spots. Null when there
 * is nothing to show.
 */
export function teamLine(people: TeamPerson[], needs: TeamNeeds, opts: { viewerId?: string; upcoming?: boolean } = {}): TeamLine | null {
  const onIt = people.filter((p) => p.status === "accepted" || p.status === "offered");
  const shown = onIt.filter((p) => p.staffId !== opts.viewerId && firstName(p.name)).sort(order);
  const label = (p: TeamPerson) => `${firstName(p.name)}${roleSuffix(p.role)}`;
  const line: TeamLine = {
    accepted: shown.filter((p) => p.status === "accepted").map(label),
    pending: shown.filter((p) => p.status === "offered").map((p) => `${label(p)} (not answered)`),
    needed: opts.upcoming === false ? "" : neededText(onIt, needs),
  };
  return line.accepted.length || line.pending.length || line.needed ? line : null;
}

/** The line as plain text, for the calendar chip's title and screen readers. */
export function teamLineText(t: TeamLine | null | undefined): string {
  if (!t) return "";
  const names = [...t.accepted, ...t.pending].join(", ");
  return [names, t.needed].filter(Boolean).join(" · ");
}
