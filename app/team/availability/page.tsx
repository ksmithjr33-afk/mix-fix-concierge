import { requireStaff } from "@/lib/team/auth";
import { todayFor, upcomingUnavailable } from "@/lib/team/availability-db";
import { rangeLabel } from "@/lib/team/availability";
import TeamHeader from "../team-header";
import AvailabilityForm from "./availability-form";

export const dynamic = "force-dynamic";

// A staff member's own unavailable dates: add single dates or ranges with a
// note, and remove them. Past dates cannot be changed.
export default async function AvailabilityPage() {
  const staff = await requireStaff("/team/availability");
  const today = await todayFor(staff.id);
  const rows = await upcomingUnavailable(staff.id, today);
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={{ href: "/team/me", label: "Me" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Availability</h1>
          <p className="text-[15px] text-[#6B5D52]">
            Mark the days you cannot work. You will not get new shift texts or see open shifts on those days. Events you already accepted stay yours.
          </p>
        </div>
        <AvailabilityForm
          today={today}
          rows={rows.map((r) => ({ id: r.id, label: rangeLabel(r), note: r.note ?? "", started: r.start_day < today }))}
        />
      </main>
    </>
  );
}
