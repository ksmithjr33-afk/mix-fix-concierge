// The events a staff member is on (offered or accepted), as list rows. Server only.
// Used by their own events list and by an admin's read only "Preview as".

import { supabase } from "@/lib/supabase";
import { eventListItem, type EventListItem, type EventRowSource } from "@/lib/team/event-list";
import { hiddenEventIds } from "@/lib/team/hidden";
import { withoutHidden } from "@/lib/team/assignments";
import type { StaffMember } from "@/lib/team/event-view";
import type { OpenShiftItem } from "@/lib/team/shifts-db";
import { staffingByEvent } from "@/lib/team/assignments-db";
import { staffingTone } from "@/lib/team/assignments";
import { unreadByEvent } from "@/lib/team/chat-db";
import { pickupBadges } from "@/lib/team/menu-pickup-db";
import { iceUnassignedIds } from "@/lib/team/ice-pickup-db";
import { unavailableBetween } from "@/lib/team/availability-db";
import { MARKETS, MARKET_INFO } from "@/lib/team/markets";
import { addDays, unavailableDays } from "@/lib/team/calendar";
import type { SessionRow } from "@/lib/event-updates";

export async function assignedEventItems(staffId: string): Promise<EventListItem[]> {
  const [{ data, error }, hidden] = await Promise.all([
    supabase.from("event_assignments").select("status, session:session_id (*)").eq("staff_id", staffId).neq("status", "declined"),
    hiddenEventIds(),
  ]);
  if (error || !data) return [];
  const items = data.flatMap((a) => {
    const s = (Array.isArray(a.session) ? a.session[0] : a.session) as (EventRowSource & { status: string }) | null;
    return s && s.status === "submitted" ? [eventListItem(s, a.status as string)] : [];
  });
  return withoutHidden(items, hidden);
}

// ----- What each role sees on /team/events and its calendar -----


/**
 * The events this person can open, as list rows: every submitted event for
 * admins (opening the manager view, with staffing color and menu pickup
 * status), and only their own events for bartenders. Both carry their own
 * unread chat count. Hidden events are left out.
 */
export async function eventsForViewer(staff: StaffMember): Promise<EventListItem[]> {
  if (staff.role === "admin") {
    const [{ data }, { data: mine }, hidden] = await Promise.all([
      supabase.from("sessions").select("*").eq("status", "submitted"),
      supabase.from("event_assignments").select("session_id, status").eq("staff_id", staff.id),
      hiddenEventIds(),
    ]);
    const rows = withoutHidden((data as (SessionRow & EventRowSource)[]) ?? [], hidden);
    const own = new Map(((mine as { session_id: string; status: string }[]) ?? []).map((a) => [a.session_id, a.status]));
    const ids = rows.map((r) => r.id);
    const [counts, unread, menus, noIce] = await Promise.all([staffingByEvent(rows), unreadByEvent(staff.id, ids), pickupBadges(ids), iceUnassignedIds(rows)]);
    return rows.map((r) => {
      const c = counts.get(r.id);
      const menu = menus.get(r.id);
      return {
        ...eventListItem(r, own.get(r.id)),
        href: `/team/admin/e/${r.id}`,
        chat: { href: `/team/admin/e/${r.id}?tab=chat`, unread: unread.get(r.id) ?? 0 },
        ...(c ? { staffing: staffingTone(c) } : {}),
        ...(menu ? { menu: { state: menu.state as "unassigned" | "assigned" | "picked_up", text: menu.text } } : {}),
        ...(noIce.has(r.id) ? { noIce: true } : {}),
      };
    });
  }
  const items = await assignedEventItems(staff.id);
  const unread = await unreadByEvent(staff.id, items.map((i) => i.id));
  return items.map((i) => ({ ...i, chat: { href: `/team/e/${i.id}?tab=chat`, unread: unread.get(i.id) ?? 0 } }));
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
