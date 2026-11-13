import Link from "next/link";
import { timed } from "@/lib/timing";
import { requireStaff } from "@/lib/team/auth";
import { firstName } from "@/lib/team/event-view";
import { pastSection, upcomingSections } from "@/lib/team/event-list";
import { chicagoToday } from "@/lib/team/time";
import TeamHeader from "../team-header";
import EventList from "./event-list";
import { openShiftsFor } from "@/lib/team/shifts-db";
import { myCertNotices } from "@/lib/team/certs-db";
import { myEstimates } from "@/lib/team/pay-db";
import { eventsForViewer, myUnavailableDays, shiftItems } from "@/lib/team/my-events";
import { pickLayout } from "@/lib/team/calendar";
import { getPrefs, savePrefs } from "@/lib/team/prefs-db";
import { myPickups } from "@/lib/team/menu-pickup-db";
import { staffMarkets } from "@/lib/team/markets-db";
import { MARKETS, MARKET_INFO } from "@/lib/team/markets";
import CalendarView, { ListCalendarToggle } from "../calendar-view";
import MyPickupCard from "../menu-pickup-card";

export const dynamic = "force-dynamic";

async function TeamEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "open" ? "open" : "mine";
  const askedPast = tab === "mine" && params.past === "1";
  const staff = await requireStaff(tab === "open" ? "/team/events?tab=open" : askedPast ? "/team/events?past=1" : "/team/events");
  const admin = staff.role === "admin";
  const today = chicagoToday();
  const past = askedPast;
  // Everything below needs only who is signed in, so it is read together.
  // List or calendar: the address bar, else what this person used last.
  const prefsP = getPrefs(staff.id).then(async (prefs) => {
    if (tab === "mine" && (params.layout === "list" || params.layout === "calendar") && params.layout !== prefs.eventsLayout) {
      Object.assign(prefs, await savePrefs(staff.id, { eventsLayout: params.layout }, prefs));
    }
    return prefs;
  });
  const calendarP = prefsP.then((prefs) => tab === "mine" && !askedPast && pickLayout(params.layout, prefs.eventsLayout) === "calendar");
  // Admins: every event. Bartenders: only their own events. Hidden events never.
  const visibleP = eventsForViewer(staff);
  const [prefs, calendar, shifts, certNotes, visible, pay, pickups, unavailable, filterMarkets] = await Promise.all([
    prefsP,
    calendarP,
    openShiftsFor(staff),
    tab === "open" && !admin ? myCertNotices(staff.id) : { enforced: false, lines: [] },
    visibleP,
    // The viewer's own estimated pay, only on events they are on. Never anyone else's.
    visibleP.then((v) => myEstimates(staff.id, v.filter((e) => e.status === "accepted" || e.status === "offered").map((e) => e.id))),
    tab === "mine" && !past ? myPickups(staff) : [],
    // The calendar: bartenders also see their own unavailable days, as they do today elsewhere.
    calendarP.then((c) => (c && !admin ? myUnavailableDays(staff.id, today) : [])),
    calendarP.then((c) => (c ? (admin ? [...MARKETS] : staffMarkets(staff.id)) : [])),
  ]);
  const events = visible.map((e) => (pay[e.id] && (e.status === "accepted" || e.status === "offered") ? { ...e, pay: pay[e.id] } : e));
  const sections = past ? pastSection(events, today) : upcomingSections(events, today);
  const hasPast = events.some((e) => e.day && e.day < today);
  // The calendar: bartenders also see open shifts in their markets.
  const calItems = calendar ? (admin ? events : [...events, ...shiftItems(shifts)]) : [];

  return (
    <>
      <TeamHeader signedIn admin={admin} />
      <main className={`${calendar ? "max-w-[96rem] sm:px-6" : "max-w-2xl"} mx-auto px-4 py-6 space-y-4`}>
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
        {pickups.map((p) => (
          <MyPickupCard key={p.sessionId} pickup={p} />
        ))}
        {tab === "open" && certNotes.lines.length > 0 && (
          <div className={`rounded-2xl px-4 py-3 text-[15px] space-y-1 ${certNotes.enforced ? "bg-[#F6E3DC] text-[#A0412D]" : "bg-[#FFF8EC] border border-[#E3C9A0] text-[#2C2420]"}`}>
            {certNotes.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
            <Link href="/team/certifications" className="underline">
              My certifications
            </Link>
          </div>
        )}
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
                <ListCalendarToggle calendar={calendar} listHref="/team/events?layout=list" calendarHref="/team/events?layout=calendar" />
              </div>
            )}
            {calendar ? (
              <CalendarView
                items={calItems}
                today={today}
                prefs={prefs}
                markets={filterMarkets.map((m) => ({ key: m, label: MARKET_INFO[m].label }))}
                unavailable={unavailable}
                empty={admin ? "No events in this range." : "None of your events or open shifts fall in this range."}
                audience={admin ? "admin" : "staff"}
              />
            ) : (
              <EventList sections={sections} empty={past ? "No past events." : "No upcoming events yet."} respond={!past} />
            )}
          </>
        )}
        <div className="px-1 pt-2" hidden={tab === "open" || calendar}>
          {past ? (
            <Link href="/team/events?layout=list" className="text-sm text-[#B5845A] underline">
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

export default async function Page(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return timed(`events:${(await props.searchParams).tab === "open" ? "open" : (await props.searchParams).layout ?? "default"}`, () => TeamEventsPage(props));
}
