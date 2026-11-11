import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { requireAdmin } from "@/lib/team/auth";
import { staffingByEvent } from "@/lib/team/assignments-db";
import { staffingLabel, withoutHidden } from "@/lib/team/assignments";
import { hiddenEventIds } from "@/lib/team/hidden";
import { dayHeader, eventListItem, pastSection, upcomingSections } from "@/lib/team/event-list";
import { chicagoToday, eventSchedule, todayIn } from "@/lib/team/time";
import { selectBlock } from "@/lib/team/shifts";
import { bartendersNeeded } from "@/lib/team/event-view";
import StaffingBoard from "./staffing-board";
import { availableCounts } from "@/lib/team/availability-db";
import TeamHeader from "../../team-header";
import EventList from "../../events/event-list";
import HiddenList from "./hidden-list";
import PostAll from "./post-all";
import { ensureMarkets } from "@/lib/team/markets-db";
import { eventData, isMarket, MARKETS, MARKET_INFO, sessionMarket } from "@/lib/team/markets";
import { calendarGrid, calLinksOf, calMode, isYmd } from "@/lib/team/calendar";
import { unreadByEvent } from "@/lib/team/chat-db";
import { ListCalendarToggle } from "../../calendar-view";

export const dynamic = "force-dynamic";

type View = "upcoming" | "past" | "hidden";

// Every submitted event by date, with how many bartenders are assigned against
// how many it needs. Hidden events only show under "Hidden events".
export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const view: View = params.hidden === "1" ? "hidden" : params.past === "1" ? "past" : "upcoming";
  const marketFilter = isMarket(params.market) ? params.market : null;
  const calendar = view === "upcoming" && params.layout === "calendar";
  const admin = await requireAdmin(view === "upcoming" ? "/team/admin/events" : `/team/admin/events?${view}=1`);
  const [{ data }, hidden] = await Promise.all([supabase.from("sessions").select("*").eq("status", "submitted"), hiddenEventIds()]);
  const allSessions = (data as SessionRow[]) ?? [];
  const today = chicagoToday();

  if (view === "hidden") {
    const hiddenItems = allSessions
      .filter((s) => hidden.has(s.id))
      .map((s) => eventListItem(s))
      .sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999"));
    return (
      <>
        <TeamHeader signedIn admin />
        <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          <div className="px-1">
            <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Hidden events</h1>
            <p className="text-[15px] text-[#6B5D52]">Hidden from every team list. Nothing was deleted. Unhide to bring one back.</p>
          </div>
          <HiddenList items={hiddenItems.map((i) => ({ id: i.id, title: i.title, detail: [dayHeader(i.day, today), i.detail].filter(Boolean).join(" · ") }))} />
          <div className="px-1 pt-2">
            <Link href="/team/admin/events" className="text-sm text-[#B5845A] underline">
              Back to staffing
            </Link>
          </div>
        </main>
      </>
    );
  }

  const visible = withoutHidden(allSessions, hidden);
  // New events get a market from their address, a few per page load (the cron does the rest).
  await ensureMarkets(visible.filter((s) => (eventListItem(s).day ?? "9999") >= today), 3);
  const sessions = marketFilter ? visible.filter((s) => sessionMarket(s) === marketFilter) : visible;
  const [counts, unread, availability] = await Promise.all([
    staffingByEvent(sessions),
    unreadByEvent(admin.id, sessions.map((s) => s.id)),
    view === "upcoming" ? availableCounts(sessions) : Promise.resolve(new Map<string, number | null>()),
  ]);
  const { data: postRows, error: postErr } = await supabase.from("shift_posts").select("session_id, kind").eq("status", "posted");
  const posted = new Set(postErr ? [] : ((postRows as { session_id: string; kind: string }[]) ?? []).filter((p) => p.kind === "open").map((p) => p.session_id));
  const cover = new Set(postErr ? [] : ((postRows as { session_id: string; kind: string }[]) ?? []).filter((p) => p.kind === "cover").map((p) => p.session_id));
  const items = sessions.map((s) => {
    const c = counts.get(s.id)!;
    const item = eventListItem(s, undefined, { showMarket: true });
    const tone: "ok" | "warn" | "muted" = c.needed === null ? "muted" : c.stillNeeded > 0 || cover.has(s.id) ? "warn" : "ok";
    const text = [
      c.stillNeeded > 0 ? `${staffingLabel(c)} · ${c.stillNeeded} needed` : staffingLabel(c),
      posted.has(s.id) ? "posted" : "",
      cover.has(s.id) ? "cover needed" : "",
      sessionMarket(s) ? "" : "no market",
      // Bartenders in the event's market who did not mark the day unavailable.
      typeof availability.get(s.id) === "number" && (item.day ?? "") >= today ? `${availability.get(s.id)} available` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return { ...item, href: `/team/admin/e/${s.id}`, badge: { text, tone }, chat: { href: `/team/e/${s.id}?tab=chat`, unread: unread.get(s.id) ?? 0 } };
  });
  const unstaffed = sessions.filter((s) => {
    const day = eventListItem(s).day;
    return !!day && day >= today && (counts.get(s.id)?.stillNeeded ?? 0) > 0 && !posted.has(s.id);
  }).length;
  const mode = calMode(params.cal);
  const anchor = isYmd(params.d) ? params.d : today;
  const href = (o: { past?: boolean; market?: string | null; layout?: "calendar" | null; cal?: string; d?: string }) => {
    const q = new URLSearchParams();
    if (o.past) q.set("past", "1");
    if (o.market) q.set("market", o.market);
    if (o.layout) q.set("layout", o.layout);
    if (o.layout && o.cal && o.cal !== "week") q.set("cal", o.cal);
    if (o.layout && o.d && o.d !== today) q.set("d", o.d);
    const qs = q.toString();
    return `/team/admin/events${qs ? `?${qs}` : ""}`;
  };
  const filterHref = (m: string | null) =>
    href({ past: view === "past", market: m, layout: calendar ? "calendar" : null, cal: mode, d: anchor });
  const calLink = (o: { mode?: "week" | "month"; d?: string }) =>
    href({ market: marketFilter, layout: "calendar", cal: o.mode ?? mode, d: o.d === "today" ? today : (o.d ?? anchor) });
  // Select mode: why an event has no checkbox (hidden events are not listed here).
  const reasons: Record<string, string> = {};
  for (const s of sessions) {
    const sch = eventSchedule(eventData(s));
    const why = selectBlock({
      hidden: false,
      past: !!sch.day && sch.day < todayIn(sch.tz),
      day: sch.day,
      market: sessionMarket(s),
      needed: bartendersNeeded(s),
      spotsOpen: counts.get(s.id)?.stillNeeded ?? 0,
      alreadyPosted: posted.has(s.id),
    });
    if (why) reasons[s.id] = why;
  }
  const grid = calendar ? calendarGrid(mode, anchor, today, items) : null;
  const sections = view === "past" ? pastSection(items, today) : upcomingSections(items, today);
  const open = items.filter((i) => (!i.day || i.day >= today) && i.badge.tone === "warn").length;

  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Staffing</h1>
          <p className="text-[15px] text-[#6B5D52]">
            {view === "past"
              ? "Past events"
              : open > 0
                ? `${open} upcoming ${open === 1 ? "event needs" : "events need"} bartenders`
                : "Every upcoming event is covered"}
          </p>
        </div>
        <nav className="flex flex-wrap gap-1.5 px-1" aria-label="Market">
          {[null, ...MARKETS].map((m) => (
            <Link
              key={m ?? "all"}
              href={filterHref(m)}
              className={`text-sm px-3 py-1 rounded-full border ${marketFilter === m ? "bg-[#2C2420] text-white border-[#2C2420]" : "border-[#DDD5CC] text-[#6B5D52]"}`}
            >
              {m ? MARKET_INFO[m].label : "All markets"}
            </Link>
          ))}
        </nav>
        {view === "upcoming" && (
          <div className="px-1">
            <ListCalendarToggle calendar={calendar} listHref={href({ market: marketFilter })} calendarHref={calLink({})} />
          </div>
        )}
        {view === "upcoming" && <PostAll count={unstaffed} market={marketFilter} />}
        {view === "upcoming" ? (
          <StaffingBoard
            calendar={calendar}
            sections={sections}
            grid={grid}
            links={grid ? calLinksOf(grid, calLink) : null}
            empty={calendar ? (marketFilter ? "No events in this market in this range." : "No events in this range.") : marketFilter ? "No upcoming events in this market." : "No upcoming events."}
            reasons={reasons}
          />
        ) : (
          <EventList sections={sections} empty={marketFilter ? "No past events in this market." : "No past events."} />
        )}
        <div className="px-1 pt-2 flex flex-wrap gap-x-5 gap-y-2">
          <Link href={view === "past" ? "/team/admin/events" : "/team/admin/events?past=1"} className="text-sm text-[#B5845A] underline">
            {view === "past" ? "Back to upcoming events" : "Past events"}
          </Link>
          <Link href="/team/admin/events?hidden=1" className="text-sm text-[#B5845A] underline">
            Hidden events{hidden.size ? ` (${hidden.size})` : ""}
          </Link>
        </div>
      </main>
    </>
  );
}
