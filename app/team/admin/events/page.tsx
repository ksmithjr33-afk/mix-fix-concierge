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

  const sessions = withoutHidden(allSessions, hidden);
  const counts = await staffingByEvent(sessions);
  const items = sessions.map((s) => {
    const c = counts.get(s.id)!;
    const item = eventListItem(s);
    const tone: "ok" | "warn" | "muted" = c.needed === null ? "muted" : c.stillNeeded > 0 ? "warn" : "ok";
    const text = c.stillNeeded > 0 ? `${staffingLabel(c)} · ${c.stillNeeded} needed` : staffingLabel(c);
    return { ...item, href: `/team/admin/e/${s.id}`, badge: { text, tone } };
  });
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
        <EventList sections={sections} empty={view === "past" ? "No past events." : "No upcoming events."} />
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
