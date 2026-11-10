import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { requireAdmin } from "@/lib/team/auth";
import { staffingByEvent } from "@/lib/team/assignments-db";
import { staffingLabel, withoutHidden } from "@/lib/team/assignments";
import { hiddenEventIds } from "@/lib/team/hidden";
import { dayHeader, eventListItem, pastSection, upcomingSections } from "@/lib/team/event-list";
import { chicagoToday } from "@/lib/team/time";
import TeamHeader from "../../team-header";
import EventList from "../../events/event-list";
import HiddenList from "./hidden-list";
import PostAll from "./post-all";
import { ensureMarkets } from "@/lib/team/markets-db";
import { isMarket, MARKETS, MARKET_INFO, sessionMarket } from "@/lib/team/markets";

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
  await requireAdmin(view === "upcoming" ? "/team/admin/events" : `/team/admin/events?${view}=1`);
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
  const counts = await staffingByEvent(sessions);
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
    ]
      .filter(Boolean)
      .join(" · ");
    return { ...item, href: `/team/admin/e/${s.id}`, badge: { text, tone } };
  });
  const unstaffed = sessions.filter((s) => {
    const day = eventListItem(s).day;
    return !!day && day >= today && (counts.get(s.id)?.stillNeeded ?? 0) > 0 && !posted.has(s.id);
  }).length;
  const filterHref = (m: string | null) => `/team/admin/events${view === "past" ? "?past=1" : ""}${m ? `${view === "past" ? "&" : "?"}market=${m}` : ""}`;
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
        {view === "upcoming" && <PostAll count={unstaffed} market={marketFilter} />}
        <EventList sections={sections} empty={view === "past" ? "No past events." : marketFilter ? "No upcoming events in this market." : "No upcoming events."} />
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
