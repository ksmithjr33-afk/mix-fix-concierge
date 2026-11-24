// Who is on each event, for the "who is on it" line on the /team/events cards.
// One query for the whole list, never one per card. Server only. The line
// itself is worked out in lib/team/team-line.ts.

import { supabase } from "@/lib/supabase";
import { bartendersNeeded, type SessionLike } from "@/lib/team/event-view";
import { barbackStatus } from "@/lib/package-extras";
import { teamLine, type TeamNeeds, type TeamPerson } from "@/lib/team/team-line";
import { eventRoleOf } from "@/lib/team/event-roles";
import type { EventListItem } from "@/lib/team/event-list";

/** Everyone ever offered each event (declined included, for the staffing counts), in one query. The role is the one worked on the event. */
export async function teamsByEvent(ids: string[]): Promise<Map<string, TeamPerson[]>> {
  const teams = new Map<string, TeamPerson[]>();
  if (ids.length === 0) return teams;
  const { data, error } = await supabase
    .from("event_assignments")
    .select("*, staff:staff_id (name, role)")
    .in("session_id", ids);
  if (error) throw new Error(`event_assignments lookup failed: ${error.message}`);
  for (const r of (data as { session_id: string; staff_id: string; status: string; assigned_at?: string | null; role?: string | null; staff: unknown }[]) ?? []) {
    const s = (Array.isArray(r.staff) ? r.staff[0] : r.staff) as { name?: string; role?: string } | null;
    const person: TeamPerson = { staffId: r.staff_id, name: s?.name ?? "", role: eventRoleOf(r, s?.role), status: r.status, assignedAt: r.assigned_at ?? "" };
    teams.set(r.session_id, [...(teams.get(r.session_id) ?? []), person]);
  }
  return teams;
}

/** What the event still needs filled: bartenders, and a barback when the package has one on. */
export function needsOf(session: SessionLike & { package_extras?: unknown }): TeamNeeds {
  return { bartenders: bartendersNeeded(session), barback: barbackStatus(session).on };
}

/**
 * Put the line on each row. Admins and managers: every row, with everyone on
 * it. Staff: pass viewerId; their own name is left out. Rows from a day before
 * today drop the open spots.
 */
export function withTeams<T extends EventListItem>(
  items: T[],
  teams: Map<string, TeamPerson[]>,
  needs: Map<string, TeamNeeds>,
  today: string,
  viewerId?: string,
): T[] {
  return items.map((e) => {
    const line = teamLine(teams.get(e.id) ?? [], needs.get(e.id) ?? { bartenders: null, barback: false }, { viewerId, upcoming: !e.day || e.day >= today });
    return line ? { ...e, team: line } : e;
  });
}
