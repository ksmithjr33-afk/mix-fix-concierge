import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentStaff } from "@/lib/team/auth";
import { firstName, scrub } from "@/lib/team/event-view";
import { chicagoToday, eventDay, eventSchedule, formatClock, longDate } from "@/lib/team/time";
import TeamHeader from "../team-header";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  event_date: string | null;
  event_data: Record<string, unknown> | null;
}

interface Listed {
  id: string;
  day: string | null;
  title: string;
  when: string;
}

function listed(r: Row): Listed {
  const ed = { ...(r.event_data ?? {}) };
  if (!ed.event_date && r.event_date) ed.event_date = r.event_date;
  const s = eventSchedule(ed);
  const title = scrub(ed.event_name) || [firstName(ed.client_name), scrub(ed.event_type)].filter(Boolean).join(", ") || "Event";
  return {
    id: r.id,
    day: eventDay(ed.event_date),
    title,
    when: [longDate(s.day) || String(ed.event_date ?? ""), s.arrivalMin !== null ? `arrive ${formatClock(s.arrivalMin)}` : ""]
      .filter(Boolean)
      .join(", "),
  };
}

/** Upcoming events this staff member can open: every submitted event for admins, assigned events for bartenders. */
async function upcoming(staffId: string, admin: boolean): Promise<Listed[]> {
  let rows: Row[] = [];
  if (admin) {
    const { data } = await supabase.from("sessions").select("id, event_date, event_data").eq("status", "submitted");
    rows = (data as Row[]) ?? [];
  } else {
    const { data, error } = await supabase
      .from("event_assignments")
      .select("status, session:session_id (id, event_date, event_data, status)")
      .eq("staff_id", staffId)
      .neq("status", "declined");
    if (!error && data) {
      rows = data
        .map((a) => (Array.isArray(a.session) ? a.session[0] : a.session) as (Row & { status: string }) | null)
        .filter((s): s is Row & { status: string } => !!s && s.status === "submitted");
    }
  }
  const today = chicagoToday();
  return rows
    .map(listed)
    .filter((e) => !e.day || e.day >= today)
    .sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999"));
}

export default async function TeamEventsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/team?next=/team/events");
  const events = await upcoming(staff.id, staff.role === "admin");

  return (
    <>
      <TeamHeader signedIn />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Hi {firstName(staff.name) || "there"}</h1>
          <p className="text-[15px] text-[#6B5D52]">{staff.role === "admin" ? "All upcoming events" : "Your upcoming events"}</p>
        </div>
        {events.length === 0 ? (
          <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">
            No upcoming events yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/team/e/${e.id}`}
                  className="block bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 hover:border-[#B5845A] transition-colors"
                >
                  <span className="block font-heading font-bold text-[#2C2420]">{e.title}</span>
                  <span className="block text-sm text-[#6B5D52]">{e.when}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
