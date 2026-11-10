import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { requireAdmin } from "@/lib/team/auth";
import { staffingByEvent } from "@/lib/team/assignments-db";
import { staffingLabel } from "@/lib/team/assignments";
import { eventListItem, pastSection, upcomingSections } from "@/lib/team/event-list";
import { chicagoToday } from "@/lib/team/time";
import TeamHeader from "../../team-header";
import EventList from "../../events/event-list";

export const dynamic = "force-dynamic";

// Every submitted event by date, with how many bartenders are assigned against how many it needs.
export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const past = (await searchParams).past === "1";
  await requireAdmin(past ? "/team/admin/events?past=1" : "/team/admin/events");
  const { data } = await supabase.from("sessions").select("*").eq("status", "submitted");
  const sessions = (data as SessionRow[]) ?? [];
  const counts = await staffingByEvent(sessions);

  const items = sessions.map((s) => {
    const c = counts.get(s.id)!;
    const item = eventListItem(s);
    const tone: "ok" | "warn" | "muted" = c.needed === null ? "muted" : c.stillNeeded > 0 ? "warn" : "ok";
    const text = c.stillNeeded > 0 ? `${staffingLabel(c)} · ${c.stillNeeded} needed` : staffingLabel(c);
    return { ...item, href: `/team/admin/e/${s.id}`, badge: { text, tone } };
  });
  const today = chicagoToday();
  const sections = past ? pastSection(items, today) : upcomingSections(items, today);
  const open = items.filter((i) => (!i.day || i.day >= today) && i.badge.tone === "warn").length;

  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Staffing</h1>
          <p className="text-[15px] text-[#6B5D52]">
            {past ? "Past events" : open > 0 ? `${open} upcoming ${open === 1 ? "event needs" : "events need"} bartenders` : "Every upcoming event is covered"}
          </p>
        </div>
        <EventList sections={sections} empty={past ? "No past events." : "No upcoming events."} />
        <div className="px-1 pt-2">
          <Link href={past ? "/team/admin/events" : "/team/admin/events?past=1"} className="text-sm text-[#B5845A] underline">
            {past ? "Back to upcoming events" : "Past events"}
          </Link>
        </div>
      </main>
    </>
  );
}
