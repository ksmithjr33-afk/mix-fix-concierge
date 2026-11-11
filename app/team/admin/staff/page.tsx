import { requireAdmin } from "@/lib/team/auth";
import { listStaff } from "@/lib/team/assignments-db";
import TeamHeader from "../../team-header";
import StaffManager from "./staff-manager";
import { upcomingUnavailableByStaff } from "@/lib/team/availability-db";
import { rangeLabel } from "@/lib/team/availability";
import { chicagoToday } from "@/lib/team/time";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const me = await requireAdmin("/team/admin/staff");
  const [staff, away] = await Promise.all([listStaff(), upcomingUnavailableByStaff(chicagoToday())]);
  // One line per person per topic, shown under their name.
  const notes: Record<string, string[]> = {};
  const add = (id: string, line: string) => (notes[id] = [...(notes[id] ?? []), line]);
  for (const [id, rows] of away) {
    const shown = rows.slice(0, 3).map(rangeLabel).join("; ");
    add(id, `Unavailable: ${shown}${rows.length > 3 ? ` and ${rows.length - 3} more` : ""}`);
  }
  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Staff</h1>
          <p className="text-[15px] text-[#6B5D52]">Add, edit, or deactivate. Admins with alerts on get texts about declines, missing items, and bar check ins.</p>
        </div>
        <StaffManager initial={staff} meId={me.id} notes={notes} />
      </main>
    </>
  );
}
