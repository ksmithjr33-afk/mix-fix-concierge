// The Past events tab on /team/events, 30 at a time. Server only.
//
// - Admins and managers: every past submitted event, admin title (client full name).
// - Everyone else: only past events they were assigned to and did not decline,
//   staff title (client first name), with their own paid status.
// Hidden events are left out for everyone, as on the upcoming list. Calendar
// only events show as they do there (admins get the Calendar only badge).
// Search runs here, over every past event the person can see, not just the
// rows already loaded.

import { supabase } from "@/lib/supabase";
import { eventListItem, type EventListItem, type EventRowSource } from "@/lib/team/event-list";
import { hiddenEventIds } from "@/lib/team/hidden";
import { withoutHidden } from "@/lib/team/assignments";
import { assignedEventItems } from "@/lib/team/my-events";
import { unreadByEvent } from "@/lib/team/chat-db";
import { myPaidDates } from "@/lib/team/payroll-db";
import { matchesSearch } from "@/lib/team/search";
import { isAdminRole } from "@/lib/team/roles";
import { chicagoToday, shortDate } from "@/lib/team/time";
import type { StaffMember } from "@/lib/team/event-view";

export const PAST_PAGE = 30;
export const MAX_QUERY = 80;

export interface PastPage {
  items: EventListItem[];
  more: boolean;
}

/** Newest day first; inside a day, the same order as the upcoming list. */
export function newestFirst(a: EventListItem, b: EventListItem): number {
  const da = a.day ?? "";
  const db = b.day ?? "";
  if (da !== db) return db.localeCompare(da);
  return a.arrival.localeCompare(b.arrival) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

async function allPastFor(staff: StaffMember, today: string): Promise<EventListItem[]> {
  const admin = isAdminRole(staff.role);
  let items: EventListItem[];
  if (admin) {
    const [{ data }, { data: mine }, hidden] = await Promise.all([
      supabase.from("sessions").select("*").eq("status", "submitted"),
      supabase.from("event_assignments").select("session_id, status").eq("staff_id", staff.id),
      hiddenEventIds(),
    ]);
    const rows = withoutHidden((data as EventRowSource[]) ?? [], hidden);
    const own = new Map(((mine as { session_id: string; status: string }[]) ?? []).map((a) => [a.session_id, a.status]));
    items = rows.map((r) => ({ ...eventListItem(r, own.get(r.id), { admin: true }), href: `/team/admin/e/${r.id}` }));
  } else {
    // Not declined, not hidden, submitted only: the same rule as the upcoming list.
    items = await assignedEventItems(staff.id);
  }
  return items.filter((e) => e.day && e.day < today);
}

/** One page of past events for this person. `offset` counts rows already shown. */
export async function pastEventsFor(
  staff: StaffMember,
  opts: { q?: unknown; offset?: unknown; limit?: number; today?: string } = {},
): Promise<PastPage> {
  const today = opts.today ?? chicagoToday();
  const q = typeof opts.q === "string" ? opts.q.slice(0, MAX_QUERY) : "";
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
  const limit = opts.limit ?? PAST_PAGE;
  const admin = isAdminRole(staff.role);
  const all = (await allPastFor(staff, today)).filter((e) => matchesSearch(e, q)).sort(newestFirst);
  const page = all.slice(offset, offset + limit);
  const ids = page.map((e) => e.id);
  // Chat counts and paid dates only for the rows on this page.
  const [unread, paid] = await Promise.all([unreadByEvent(staff.id, ids), admin ? new Map<string, string>() : myPaidDates(staff.id, ids)]);
  const items = page.map((e) => ({
    ...e,
    chat: { href: admin ? `/team/admin/e/${e.id}?tab=chat` : `/team/e/${e.id}?tab=chat`, unread: unread.get(e.id) ?? 0 },
    ...(admin ? {} : { paid: paid.has(e.id) ? `Paid ${shortDate(paid.get(e.id)!)}` : "Not paid yet" }),
  }));
  return { items, more: offset + limit < all.length };
}
