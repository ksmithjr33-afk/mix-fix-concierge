import { requireAdmin } from "@/lib/team/auth";
import { listStaff } from "@/lib/team/assignments-db";
import TeamHeader from "../../team-header";
import StaffManager from "./staff-manager";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const me = await requireAdmin("/team/admin/staff");
  const staff = await listStaff();
  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Staff</h1>
          <p className="text-[15px] text-[#6B5D52]">Add, edit, or deactivate. Admins with alerts on get texts about declines, missing items, and bar check ins.</p>
        </div>
        <StaffManager initial={staff} meId={me.id} />
      </main>
    </>
  );
}
