import { requireStaff } from "@/lib/team/auth";
import { handoffForTeammate } from "@/lib/team/shifts-db";
import TeamHeader from "../../team-header";
import ShiftCard from "../../shifts/shift-card";
import Answer from "./answer";

export const dynamic = "force-dynamic";

// A teammate asked this staff member to take their shift. Only the named teammate sees it, and only the shift summary.
export default async function HandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff(`/team/handoff/${encodeURIComponent(id)}`);
  const h = await handoffForTeammate(id, staff);
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={{ href: "/team/events", label: "Your events" }} />
      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        {!h ? (
          <p className="text-[15px] text-[#6B5D52] text-center py-6">We could not find that request.</p>
        ) : (
          <>
            <div className="px-1">
              <h1 className="font-heading text-2xl font-bold text-[#2C2420]">{h.fromName || "A teammate"} asked you to take a shift</h1>
              <p className="text-[15px] text-[#6B5D52]">{h.shift.date}</p>
            </div>
            <ShiftCard shift={h.shift} sameDay={h.sameDay} />
            {h.handoff.status === "asked" ? (
              <>
                <Answer handoffId={id} />
                <p className="text-xs text-[#A39585] px-1">If you accept, an admin still has to approve it. Until then {h.fromName || "your teammate"} stays on the shift.</p>
              </>
            ) : (
              <p className="text-[15px] text-[#6B5D52] px-1">
                {h.handoff.status === "teammate_accepted"
                  ? "You accepted. Waiting for an admin to approve."
                  : h.handoff.status === "approved"
                    ? "Approved. Check your events for the event page."
                    : "This request is closed."}
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
