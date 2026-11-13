import Link from "next/link";
import { timed } from "@/lib/timing";
import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { requireAdmin } from "@/lib/team/auth";
import { staffingByEvent } from "@/lib/team/assignments-db";
import { staffingLabel, staffingTone, withoutHidden } from "@/lib/team/assignments";
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
import { isYmd, pickLayout } from "@/lib/team/calendar";
import { unreadByEvent } from "@/lib/team/chat-db";
import { getPrefs, savePrefs } from "@/lib/team/prefs-db";
import { pickupBadges } from "@/lib/team/menu-pickup-db";
import { menuMissingIds } from "@/lib/team/approved-menu-db";
import { ListCalendarToggle } from "../../calendar-view";
import { orderStatuses } from "@/lib/order-sheet-db";
import { STATUS_LABEL } from "@/lib/order-sheet";
import { sessionsWithPendingHolds, sessionsWithPendingRequests } from "@/lib/client-list-db";

export const dynamic = "force-dynamic";

type View = "upcoming" | "past" | "hidden";

// Every submitted event by date, with how many bartenders are assigned against
// how many it needs. Hidden events only show under "Hidden events".
async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const view: View = params.hidden === "1" ? "hidden" : params.past === "1" ? "past" : "upcoming";
  const marketFilter = isMarket(params.market) ? params.market : null;
  // Date range filter on the event day, either end optional.
  const from = isYmd(params.from) ? params.from : null;
  const to = isYmd(params.to) ? params.to : null;
  const admin = await requireAdmin(view === "upcoming" ? "/team/admin/events" : `/team/admin/events?${view}=1`);
  // List or calendar: the address bar, else what this admin used last. Read with the events and hidden list.
  const [prefs, { data }, hidden, postRead] = await Promise.all([
    getPrefs(admin.id).then(async (prefs) => {
      if (view === "upcoming" && (params.layout === "list" || params.layout === "calendar") && params.layout !== prefs.staffingLayout) {
        Object.assign(prefs, await savePrefs(admin.id, { staffingLayout: params.layout }, prefs));
      }
      return prefs;
    }),
    supabase.from("sessions").select("*").eq("status", "submitted"),
    hiddenEventIds(),
    view === "hidden" ? null : supabase.from("shift_posts").select("session_id, kind").eq("status", "posted"),
  ]);
  const layout = pickLayout(params.layout, prefs.staffingLayout);
  const calendar = view === "upcoming" && layout === "calendar";
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
  const inRange = (s: SessionRow) => {
    const day = eventListItem(s).day;
    if (!from && !to) return true;
    return !!day && (!from || day >= from) && (!to || day <= to);
  };
  // The calendar gets every market and date: it has its own market filter and navigation.
  const sessions = calendar ? visible : (marketFilter ? visible.filter((s) => sessionMarket(s) === marketFilter) : visible).filter(inRange);
  const [counts, unread, availability, orders, heldLists, menus, requests, noMenu] = await Promise.all([
    staffingByEvent(sessions),
    unreadByEvent(admin.id, sessions.map((s) => s.id)),
    view === "upcoming" ? availableCounts(sessions) : Promise.resolve(new Map<string, number | null>()),
    orderStatuses(sessions),
    sessionsWithPendingHolds(sessions.map((s) => s.id)),
    pickupBadges(sessions.map((s) => s.id)),
    sessionsWithPendingRequests(sessions.map((s) => s.id)),
    menuMissingIds(sessions),
  ]);
  const { data: postRows, error: postErr } = postRead ?? { data: null, error: null };
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
      orders.has(s.id) ? STATUS_LABEL[orders.get(s.id)!] : "",
      requests.has(s.id) ? "change request waiting" : heldLists.has(s.id) ? "first list waiting for review" : "",
      menus.get(s.id)?.text ?? "",
      noMenu.has(s.id) ? "no approved menu" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const menu = menus.get(s.id);
    return {
      ...item,
      href: `/team/admin/e/${s.id}`,
      badge: { text, tone },
      chat: { href: `/team/admin/e/${s.id}?tab=chat`, unread: unread.get(s.id) ?? 0 },
      staffing: staffingTone(c),
      ...(requests.has(s.id) ? { request: true } : {}),
      ...(noMenu.has(s.id) ? { noMenu: true } : {}),
      ...(menu ? { menu: { state: menu.state as "unassigned" | "assigned" | "picked_up", text: menu.text } } : {}),
    };
  });
  const unstaffed = sessions.filter((s) => {
    const day = eventListItem(s).day;
    return !!day && day >= today && (counts.get(s.id)?.stillNeeded ?? 0) > 0 && !posted.has(s.id);
  }).length;
  const href = (o: { past?: boolean; market?: string | null; layout?: "calendar" | "list" | null; dates?: boolean }) => {
    const q = new URLSearchParams();
    if (o.past) q.set("past", "1");
    if (o.market) q.set("market", o.market);
    if (o.dates !== false && from) q.set("from", from);
    if (o.dates !== false && to) q.set("to", to);
    if (o.layout) q.set("layout", o.layout);
    const qs = q.toString();
    return `/team/admin/events${qs ? `?${qs}` : ""}`;
  };
  const filterHref = (m: string | null) => href({ past: view === "past", market: m });
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
  const sections = view === "past" ? pastSection(items, today) : upcomingSections(items, today);
  const open = items.filter((i) => (!i.day || i.day >= today) && i.badge.tone === "warn").length;

  return (
    <>
      <TeamHeader signedIn admin />
      <main className={`${calendar ? "max-w-[96rem] sm:px-6" : "max-w-2xl"} mx-auto px-4 py-6 space-y-4`}>
        <div className="px-1">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Staffing</h1>
            <div className="flex items-baseline gap-4 shrink-0">
              <Link href="/team/admin/leftovers" className="text-sm text-[#B5845A] underline">
                Leftover stock
              </Link>
              <Link href="/team/admin/events/new" className="rounded-lg bg-[#B5845A] text-white px-3 py-1.5 text-sm font-medium">
                Add event
              </Link>
            </div>
          </div>
          <p className="text-[15px] text-[#6B5D52]">
            {view === "past"
              ? "Past events"
              : open > 0
                ? `${open} upcoming ${open === 1 ? "event needs" : "events need"} bartenders`
                : "Every upcoming event is covered"}
          </p>
        </div>
        {!calendar && (
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
        )}
        {!calendar && (
        <form method="get" action="/team/admin/events" className="px-1 flex flex-wrap items-end gap-2" aria-label="Date range">
          {view === "past" && <input type="hidden" name="past" value="1" />}
          {marketFilter && <input type="hidden" name="market" value={marketFilter} />}
          <label className="text-xs text-[#A39585] uppercase tracking-wide">
            From
            <input type="date" name="from" defaultValue={from ?? ""} className="block rounded-lg border border-[#DDD5CC] bg-white px-2 py-1 text-[#2C2420]" />
          </label>
          <label className="text-xs text-[#A39585] uppercase tracking-wide">
            To
            <input type="date" name="to" defaultValue={to ?? ""} className="block rounded-lg border border-[#DDD5CC] bg-white px-2 py-1 text-[#2C2420]" />
          </label>
          <button type="submit" className="rounded-lg bg-[#2C2420] text-white px-3 py-1.5 text-sm">
            Filter dates
          </button>
          {(from || to) && (
            <Link href={href({ past: view === "past", market: marketFilter, dates: false })} className="text-sm text-[#B5845A] underline pb-1.5">
              Clear dates
            </Link>
          )}
        </form>
        )}
        {view === "upcoming" && (
          <div className="px-1">
            <ListCalendarToggle calendar={calendar} listHref={href({ market: marketFilter, layout: "list" })} calendarHref={href({ layout: "calendar", dates: false })} />
          </div>
        )}
        {view === "upcoming" && <PostAll count={unstaffed} market={marketFilter} />}
        {view === "upcoming" ? (
          <StaffingBoard
            calendar={calendar}
            sections={sections}
            items={items}
            today={today}
            prefs={prefs}
            markets={MARKETS.map((m) => ({ key: m, label: MARKET_INFO[m].label }))}
            empty={calendar ? "No events in this range." : marketFilter ? "No upcoming events in this market." : "No upcoming events."}
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

export default async function Page(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return timed(`admin-events:${(await props.searchParams).layout ?? "default"}`, () => AdminEventsPage(props));
}
