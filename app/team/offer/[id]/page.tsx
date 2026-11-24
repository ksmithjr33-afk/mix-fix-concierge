import Link from "next/link";
import { requireStaff } from "@/lib/team/auth";
import { offerForStaff } from "@/lib/team/offers-db";
import TeamHeader from "../../team-header";
import ShiftCard from "../../shifts/shift-card";
import OfferButtons from "./offer-buttons";
import { isAdminRole } from "@/lib/team/roles";

export const dynamic = "force-dynamic";

// A shift offer, for the person it was texted to. Only the shift summary
// (date, times, city, event type, guests, package). Nothing about who else
// was offered or in what order.
export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff(`/team/offer/${encodeURIComponent(id)}`);
  const page = await offerForStaff(id, staff);
  return (
    <>
      <TeamHeader signedIn admin={isAdminRole(staff.role)} back={{ href: "/team/events", label: "Events" }} />
      <main className="max-w-md mx-auto px-4 py-6 space-y-4">
        {page.state === "gone" && <p className="text-[15px] text-[#6B5D52] text-center py-6">This offer is closed. No action needed.</p>}
        {page.state === "passed" && <p className="text-[15px] text-[#6B5D52] text-center py-6">You passed on the shift on {page.date}. Thanks for letting us know.</p>}
        {page.state === "held" && <p className="text-[15px] text-[#2C2420] text-center py-6">You accepted the shift on {page.date}. An admin will confirm it and text you.</p>}
        {page.state === "got" && (
          <div className="text-center py-6 space-y-2">
            <p className="text-[15px] text-[#2C2420]">You have this shift.</p>
            <Link href={`/team/e/${page.sessionId}`} className="text-sm text-[#B5845A] underline">
              Open the event page
            </Link>
          </div>
        )}
        {page.state === "open" && (
          <>
            <div className="px-1">
              <h1 className="font-heading text-2xl font-bold text-[#2C2420]">
                {page.shift.eventType} in {page.shift.city}
              </h1>
              <p className="text-[15px] text-[#6B5D52]">{page.shift.date}</p>
            </div>
            <ShiftCard shift={page.shift} sameDay={[]} />
            <OfferButtons stepId={page.stepId} />
          </>
        )}
      </main>
    </>
  );
}
