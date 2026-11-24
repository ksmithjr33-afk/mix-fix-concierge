import { requireStaff } from "@/lib/team/auth";
import { offWeekdaysOf, todayFor, upcomingUnavailable } from "@/lib/team/availability-db";
import { rangeLabel } from "@/lib/team/availability";
import TeamHeader from "../team-header";
import AvailabilityForm from "./availability-form";
import WeekdayForm from "./weekday-form";
import { isAdminRole } from "@/lib/team/roles";

export const dynamic = "force-dynamic";

// A staff member's own availability: weekdays they never work, and unavailable
// dates (single dates or ranges with a note). Past dates cannot be changed.
export default async function AvailabilityPage() {
  const staff = await requireStaff("/team/availability");
  const today = await todayFor(staff.id);
  const [rows, weekdays] = await Promise.all([upcomingUnavailable(staff.id, today), offWeekdaysOf(staff.id)]);
  return (
    <>
      <TeamHeader signedIn admin={isAdminRole(staff.role)} back={{ href: "/team/me", label: "Me" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Availability</h1>
          <p className="text-[15px] text-[#6B5D52]">
            Mark the days you cannot work. You will not get new shift texts, shift offers, or see open shifts on those days. Events you already accepted stay yours.
          </p>
        </div>
        <WeekdayForm initial={weekdays} />
        <AvailabilityForm
          today={today}
          rows={rows.map((r) => ({ id: r.id, label: rangeLabel(r), note: r.note ?? "", started: r.start_day < today }))}
        />
      </main>
    </>
  );
}
