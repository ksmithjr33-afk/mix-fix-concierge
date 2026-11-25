// The Past events tab on /team/events, 30 at a time. Server only.
//
// - Admins and managers: every past submitted event, admin title (client full name).
// - Everyone else: only past events they were assigned to and did not decline,
//   staff title (client first name), with their own paid status.
// Hidden events are left out for everyone, as on the upcoming list. Calendar
// only events show as they do there (admins get the Calendar only badge).
// Search runs here, over every past event the person can see, not just the
// rows already loaded.

import type { SessionRow } from "@/lib/event-updates";
import { teamRows } from "@/lib/team/team-sessions";
import { supabase } from "@/lib/supabase";
import { eventListItem, type EventListItem, type EventRowSource } from "@/lib/team/event-list";
import { hiddenEventIds } from "@/lib/team/hidden";
import { withoutHidden } from "@/lib/team/assignments";
import { assignedEventRows } from "@/lib/team/my-events";
import { needsOf, teamsByEvent, withTeams } from "@/lib/team/team-db";
import type { TeamNeeds } from "@/lib/team/team-line";
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

async function allPastFor(staff: StaffMember, today: string): Promise<{ items: EventListItem[]; needs: Map<string, TeamNeeds> }> {
  const admin = isAdminRole(staff.role);
  let items: EventListItem[];
  let needs = new Map<string, TeamNeeds>();
  if (admin) {
    const [{ data }, { data: mine }, hidden] = await Promise.all([
      supabase.from("sessions").select("*").in("status", ["submitted", "in_progress"]),
      supabase.from("event_assignments").select("session_id, status").eq("staff_id", staff.id),
      hiddenEventIds(),
    ]);
    const rows = withoutHidden(teamRows((data as SessionRow[]) ?? []) as unknown as EventRowSource[], hidden);
    const own = new Map(((mine as { session_id: string; status: string }[]) ?? []).map((a) => [a.session_id, a.status]));
    items = rows.map((r) => ({ ...eventListItem(r, own.get(r.id), { admin: true }), href: `/team/admin/e/${r.id}` }));
    needs = new Map(rows.map((r) => [r.id, needsOf(r)]));
  } else {
    // Not declined, not hidden, submitted only: the same rule as the upcoming list.
    ({ items, needs } = await assignedEventRows(staff.id));
  }
  return { items: items.filter((e) => e.day && e.day < today), needs };
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
  const { items: past, needs } = await allPastFor(staff, today);
  const all = past.filter((e) => matchesSearch(e, q)).sort(newestFirst);
  const page = all.slice(offset, offset + limit);
  const ids = page.map((e) => e.id);
  // Chat counts, paid dates, and who was on it, only for the rows on this page (one query each).
  const [unread, paid, teams] = await Promise.all([unreadByEvent(staff.id, ids), admin ? new Map<string, string>() : myPaidDates(staff.id, ids), teamsByEvent(ids)]);
  const items = withTeams(page, teams, needs, today, admin ? undefined : staff.id).map((e) => ({
    ...e,
    chat: { href: admin ? `/team/admin/e/${e.id}?tab=chat` : `/team/e/${e.id}?tab=chat`, unread: unread.get(e.id) ?? 0 },
    ...(admin ? {} : { paid: paid.has(e.id) ? `Paid ${shortDate(paid.get(e.id)!)}` : "Not paid yet" }),
  }));
  return { items, more: offset + limit < all.length };
}
