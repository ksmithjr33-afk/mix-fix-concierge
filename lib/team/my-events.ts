// The events a staff member is on (offered or accepted), as list rows. Server only.
// Used by their own events list and by an admin's read only "Preview as".

import { teamRows } from "@/lib/team/team-sessions";
import { asTeamRow, showsOnTeam } from "@/lib/planning";
import { supabase } from "@/lib/supabase";
import { eventListItem, type EventListItem, type EventRowSource } from "@/lib/team/event-list";
import { hiddenEventIds } from "@/lib/team/hidden";
import { withoutHidden } from "@/lib/team/assignments";
import type { StaffMember } from "@/lib/team/event-view";
import type { OpenShiftItem } from "@/lib/team/shifts-db";
import { staffingCounts, staffingTone, type AssignmentStatus } from "@/lib/team/assignments";
import { bartendersNeeded } from "@/lib/team/event-view";
import { needsOf, teamsByEvent, withTeams } from "@/lib/team/team-db";
import type { TeamNeeds } from "@/lib/team/team-line";
import { chicagoToday } from "@/lib/team/time";
import { unreadByEvent } from "@/lib/team/chat-db";
import { pickupBadges } from "@/lib/team/menu-pickup-db";
import { iceUnassignedIds } from "@/lib/team/ice-pickup-db";
import { unavailableBetween } from "@/lib/team/availability-db";
import { MARKETS, MARKET_INFO } from "@/lib/team/markets";
import { addDays, unavailableDays } from "@/lib/team/calendar";
import type { SessionRow } from "@/lib/event-updates";
import { isAdminRole } from "@/lib/team/roles";

export async function assignedEventItems(staffId: string): Promise<EventListItem[]> {
  return (await assignedEventRows(staffId)).items;
}

/** Their events as rows, with what each one still needs filled (for the who is on it line). */
export async function assignedEventRows(staffId: string): Promise<{ items: EventListItem[]; needs: Map<string, TeamNeeds> }> {
  const needs = new Map<string, TeamNeeds>();
  const [{ data, error }, hidden] = await Promise.all([
    supabase.from("event_assignments").select("status, session:session_id (*)").eq("staff_id", staffId).neq("status", "declined"),
    hiddenEventIds(),
  ]);
  if (error || !data) return { items: [], needs };
  const items = data.flatMap((a) => {
    const s = (Array.isArray(a.session) ? a.session[0] : a.session) as (SessionRow & EventRowSource & { status: string }) | null;
    if (!s || !showsOnTeam(s)) return [];
    const row = asTeamRow(s);
    needs.set(row.id, needsOf(row));
    return [eventListItem(row, a.status as string)];
  });
  return { items: withoutHidden(items, hidden), needs };
}

// ----- What each role sees on /team/events and its calendar -----


/**
 * The events this person can open, as list rows: every submitted event for
 * admins (opening the manager view, with staffing color and menu pickup
 * status), and only their own events for bartenders. Both carry their own
 * unread chat count. Hidden events are left out.
 */
export async function eventsForViewer(staff: StaffMember): Promise<EventListItem[]> {
  if (isAdminRole(staff.role)) {
    const [{ data }, { data: mine }, hidden] = await Promise.all([
      supabase.from("sessions").select("*").in("status", ["submitted", "in_progress"]),
      supabase.from("event_assignments").select("session_id, status").eq("staff_id", staff.id),
      hiddenEventIds(),
    ]);
    const rows = withoutHidden(teamRows((data as SessionRow[]) ?? []) as (SessionRow & EventRowSource)[], hidden);
    const own = new Map(((mine as { session_id: string; status: string }[]) ?? []).map((a) => [a.session_id, a.status]));
    const ids = rows.map((r) => r.id);
    // One query gives both the staffing color and the who is on it line.
    const [teams, unread, menus, noIce] = await Promise.all([teamsByEvent(ids), unreadByEvent(staff.id, ids), pickupBadges(ids), iceUnassignedIds(rows)]);
    const needs = new Map(rows.map((r) => [r.id, needsOf(r)]));
    const items = rows.map((r) => {
      // Bartenders needed counts only people working the event as Bartender.
      const c = staffingCounts(bartendersNeeded(r), (teams.get(r.id) ?? []).filter((p) => p.role === "bartender").map((p) => p.status as AssignmentStatus));
      const menu = menus.get(r.id);
      return {
        ...eventListItem(r, own.get(r.id), { admin: true }),
        href: `/team/admin/e/${r.id}`,
        chat: { href: `/team/admin/e/${r.id}?tab=chat`, unread: unread.get(r.id) ?? 0 },
        ...(c ? { staffing: staffingTone(c) } : {}),
        ...(menu ? { menu: { state: menu.state as "unassigned" | "assigned" | "picked_up", text: menu.text } } : {}),
        ...(noIce.has(r.id) ? { noIce: true } : {}),
      };
    });
    return withTeams(items, teams, needs, chicagoToday());
  }
  const { items, needs } = await assignedEventRows(staff.id);
  const ids = items.map((i) => i.id);
  // Their teammates: first names, never their own, only on their own events.
  const [unread, teams] = await Promise.all([unreadByEvent(staff.id, ids), teamsByEvent(ids)]);
  const withChat = items.map((i) => ({ ...i, chat: { href: `/team/e/${i.id}?tab=chat`, unread: unread.get(i.id) ?? 0 } }));
  return withTeams(withChat, teams, needs, chicagoToday(), staff.id);
}

/** Open shifts (already shown on the Open shifts tab) as calendar chips. Never a client name. */
export function shiftItems(shifts: OpenShiftItem[]): EventListItem[] {
  return shifts.map(({ shift }) => {
    const market = MARKETS.find((m) => MARKET_INFO[m].label === shift.market) ?? null;
    const title = [shift.eventType || "Event", shift.city ? `in ${shift.city}` : ""].filter(Boolean).join(" ");
    return {
      id: shift.postId,
      kind: "shift" as const,
      day: shift.day,
      arrival: shift.arrival,
      title,
      detail: [shift.guestCount ? `${shift.guestCount} guests` : "", shift.package].filter(Boolean).join(" · "),
      search: title.toLowerCase(),
      href: `/team/shifts/${shift.postId}`,
      market,
    };
  });
}

/** A bartender's own unavailable days around today, for the calendar. */
export async function myUnavailableDays(staffId: string, today: string): Promise<string[]> {
  const from = addDays(today, -62);
  const to = addDays(today, 366);
  return unavailableDays(await unavailableBetween(from, to, [staffId]), from, to);
}
