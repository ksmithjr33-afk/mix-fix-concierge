import Link from "next/link";
import { requireStaff } from "@/lib/team/auth";
import { shiftForStaff } from "@/lib/team/shifts-db";
import TeamHeader from "../../team-header";
import ShiftCard from "../shift-card";
import RequestButton from "./request-button";

export const dynamic = "force-dynamic";

// A posted shift. Only shown to staff in the shift's market, and only the allowlisted summary.
export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff(`/team/shifts/${encodeURIComponent(id)}`);
  const page = await shiftForStaff(id, staff);
  const back = { href: "/team/events?tab=open", label: "Open shifts" };

  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={back} />
      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        {page.state === "gone" && <p className="text-[15px] text-[#6B5D52] text-center py-6">This shift is no longer open.</p>}
        {page.state === "got" && (
          <div className="text-center py-6 space-y-2">
            <p className="text-[15px] text-[#2C2420]">You got this shift.</p>
            <Link href={`/team/e/${page.sessionId}`} className="text-sm text-[#B5845A] underline">
              Open the event page
            </Link>
          </div>
        )}
        {page.state === "open" && (
          <>
            <div className="px-1">
              <h1 className="font-heading text-2xl font-bold text-[#2C2420]">
                {page.item.shift.eventType} in {page.item.shift.city}
              </h1>
              <p className="text-[15px] text-[#6B5D52]">{page.item.shift.date}</p>
            </div>
            <ShiftCard shift={page.item.shift} sameDay={page.item.sameDay} />
            <RequestButton postId={id} initial={page.item.myRequest} overlaps={page.item.sameDay.some((e) => e.overlaps)} />
            <p className="text-xs text-[#A39585] px-1">An admin picks who gets the shift. You get a text either way.</p>
          </>
        )}
      </main>
    </>
  );
}
