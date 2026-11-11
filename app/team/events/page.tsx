import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { requireStaff } from "@/lib/team/auth";
import { firstName } from "@/lib/team/event-view";
import { eventListItem, pastSection, upcomingSections, type EventListItem, type EventRowSource } from "@/lib/team/event-list";
import { chicagoToday } from "@/lib/team/time";
import { hiddenEventIds } from "@/lib/team/hidden";
import { withoutHidden } from "@/lib/team/assignments";
import TeamHeader from "../team-header";
import EventList from "./event-list";
import { openShiftsFor } from "@/lib/team/shifts-db";
import { assignedEventItems } from "@/lib/team/my-events";
import { calendarGrid, calLinksOf, calMode, isYmd } from "@/lib/team/calendar";
import CalendarView, { ListCalendarToggle } from "../calendar-view";

export const dynamic = "force-dynamic";

// "*" so the event's market (and its time zone) comes along once the column exists.
const COLUMNS = "*";

/** Events this staff member can open: every submitted event for admins, assigned events for bartenders. */
async function visibleEvents(staffId: string, admin: boolean): Promise<EventListItem[]> {
  if (admin) {
    // Every event, with the admin's own assignment status where they are on one.
    const [{ data }, { data: mine }] = await Promise.all([
      supabase.from("sessions").select(COLUMNS).eq("status", "submitted"),
      supabase.from("event_assignments").select("session_id, status").eq("staff_id", staffId),
    ]);
    const own = new Map(((mine as { session_id: string; status: string }[]) ?? []).map((a) => [a.session_id, a.status]));
    return ((data as EventRowSource[]) ?? []).map((r) => eventListItem(r, own.get(r.id)));
  }
  return assignedEventItems(staffId);
}

export default async function TeamEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "open" ? "open" : "mine";
  const calendar = tab === "mine" && params.layout === "calendar";
  const past = tab === "mine" && !calendar && params.past === "1";
  const staff = await requireStaff(tab === "open" ? "/team/events?tab=open" : past ? "/team/events?past=1" : "/team/events");
  const admin = staff.role === "admin";
  const shifts = await openShiftsFor(staff);
  const [all, hidden] = await Promise.all([visibleEvents(staff.id, admin), hiddenEventIds()]);
  const events = withoutHidden(all, hidden);
  const today = chicagoToday();
  const sections = past ? pastSection(events, today) : upcomingSections(events, today);
  const hasPast = events.some((e) => e.day && e.day < today);
  const mode = calMode(params.cal);
  const anchor = isYmd(params.d) ? params.d : today;
  const calLink = (o: { mode?: "week" | "month"; d?: string }) => {
    const q = new URLSearchParams({ layout: "calendar" });
    const m = o.mode ?? mode;
    const d = o.d === "today" ? today : (o.d ?? anchor);
    if (m !== "week") q.set("cal", m);
    if (d !== today) q.set("d", d);
    return `/team/events?${q.toString()}`;
  };

  return (
    <>
      <TeamHeader signedIn admin={admin} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Hi {firstName(staff.name) || "there"}</h1>
          <p className="text-[15px] text-[#6B5D52]">
            {past ? "Past events" : admin ? "All upcoming events" : "Your upcoming events"}
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-1 bg-[#DDD5CC] p-1 rounded-xl" aria-label="Events">
          <Link href="/team/events" aria-current={tab === "mine" ? "page" : undefined} className={`py-2 rounded-lg text-sm font-medium text-center ${tab === "mine" ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"}`}>
            {admin ? "Events" : "My events"}
          </Link>
          <Link href="/team/events?tab=open" aria-current={tab === "open" ? "page" : undefined} className={`py-2 rounded-lg text-sm font-medium text-center ${tab === "open" ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"}`}>
            Open shifts{shifts.length ? ` (${shifts.length})` : ""}
          </Link>
        </nav>
        {tab === "open" ? (
          shifts.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">No open shifts in your markets right now. We text you when one is posted.</p>
          ) : (
            <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
              {shifts.map(({ shift, myRequest, sameDay }) => (
                <li key={shift.postId}>
                  <Link href={`/team/shifts/${shift.postId}`} className="flex items-start gap-3 px-3 py-2.5 hover:bg-[#EFE7DF] transition-colors">
                    <span className="w-[4.5rem] shrink-0 pt-0.5 text-sm font-medium text-[#2C2420] tabular-nums">
                      {shift.arrival || "TBD"}
                      <span className="block text-[10px] font-normal uppercase tracking-wide text-[#A39585]">arrive</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-heading font-bold text-[#2C2420]">{shift.shortDate}</span>
                        {shift.cover && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">Cover needed</span>}
                        {myRequest === "requested" && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#E4EBDF] text-[#55684A]">Requested</span>}
                      </span>
                      <span className="block text-sm text-[#6B5D52] break-words">
                        {[shift.eventType, shift.city, shift.guestCount ? `${shift.guestCount} guests` : "", shift.package].filter(Boolean).join(" · ")}
                      </span>
                      {sameDay.length > 0 && <span className="block text-xs text-[#9A7049]">You have another event that day</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            {!past && (
              <div className="px-1">
                <ListCalendarToggle calendar={calendar} listHref="/team/events" calendarHref={calLink({})} />
              </div>
            )}
            {calendar ? (
              <CalendarView grid={calendarGrid(mode, anchor, today, events)} links={calLinksOf(calendarGrid(mode, anchor, today, events), calLink)} empty={admin ? "No events in this range." : "None of your events fall in this range."} />
            ) : (
              <EventList sections={sections} empty={past ? "No past events." : "No upcoming events yet."} respond={!past} />
            )}
          </>
        )}
        <div className="px-1 pt-2" hidden={tab === "open" || calendar}>
          {past ? (
            <Link href="/team/events" className="text-sm text-[#B5845A] underline">
              Back to upcoming events
            </Link>
          ) : (
            hasPast && (
              <Link href="/team/events?past=1" className="text-sm text-[#B5845A] underline">
                Past events
              </Link>
            )
          )}
        </div>
      </main>
    </>
  );
}
