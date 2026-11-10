import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { requireStaff } from "@/lib/team/auth";
import { firstName } from "@/lib/team/event-view";
import { eventListItem, pastSection, upcomingSections, type EventListItem, type EventRowSource } from "@/lib/team/event-list";
import { chicagoToday } from "@/lib/team/time";
import TeamHeader from "../team-header";
import EventList from "./event-list";

export const dynamic = "force-dynamic";

const COLUMNS = "id, event_date, guest_count, package_type, event_data, status";

/** Events this staff member can open: every submitted event for admins, assigned events for bartenders. */
async function visibleEvents(staffId: string, admin: boolean): Promise<EventListItem[]> {
  if (admin) {
    const { data } = await supabase.from("sessions").select(COLUMNS).eq("status", "submitted");
    return ((data as EventRowSource[]) ?? []).map((r) => eventListItem(r));
  }
  const { data, error } = await supabase
    .from("event_assignments")
    .select(`status, session:session_id (${COLUMNS})`)
    .eq("staff_id", staffId)
    .neq("status", "declined");
  if (error || !data) return [];
  return data.flatMap((a) => {
    const s = (Array.isArray(a.session) ? a.session[0] : a.session) as (EventRowSource & { status: string }) | null;
    return s && s.status === "submitted" ? [eventListItem(s, a.status as string)] : [];
  });
}

export default async function TeamEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const past = (await searchParams).past === "1";
  const staff = await requireStaff(past ? "/team/events?past=1" : "/team/events");
  const admin = staff.role === "admin";
  const events = await visibleEvents(staff.id, admin);
  const today = chicagoToday();
  const sections = past ? pastSection(events, today) : upcomingSections(events, today);
  const hasPast = events.some((e) => e.day && e.day < today);

  return (
    <>
      <TeamHeader signedIn />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Hi {firstName(staff.name) || "there"}</h1>
          <p className="text-[15px] text-[#6B5D52]">
            {past ? "Past events" : admin ? "All upcoming events" : "Your upcoming events"}
          </p>
        </div>
        <EventList sections={sections} empty={past ? "No past events." : "No upcoming events yet."} />
        <div className="px-1 pt-2">
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
