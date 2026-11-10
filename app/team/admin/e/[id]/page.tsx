import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { assigneeProgress, listStaff } from "@/lib/team/assignments-db";
import { staffingCounts, staffingLabel } from "@/lib/team/assignments";
import { bartendersNeeded, buildStaffEventView } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import TeamHeader from "../../../team-header";
import AssignPanel from "./assign-panel";

export const dynamic = "force-dynamic";

// Assign or remove staff for one event, with each person's checklist and shopping progress.
export default async function AdminEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/team/admin/e/${encodeURIComponent(id)}`);
  const back = { href: "/team/admin/events", label: "Staffing" };
  const session = await getSubmittedSession(id);
  if (!session) {
    return (
      <>
        <TeamHeader signedIn admin back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">We could not find that event.</main>
      </>
    );
  }

  const [people, staff] = await Promise.all([assigneeProgress(session), listStaff()]);
  const v = buildStaffEventView(session);
  const counts = staffingCounts(bartendersNeeded(session), people.map((p) => p.status));
  const onEvent = new Set(people.filter((p) => p.status !== "declined").map((p) => p.staffId));
  const available = staff
    .filter((s) => s.active && !onEvent.has(s.id))
    .map((s) => ({ id: s.id, name: s.name || s.phone, role: s.role, declined: people.some((p) => p.staffId === s.id) }));

  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <main className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{eventTitle(session.event_data ?? {})}</h1>
          <p className="text-[15px] text-[#6B5D52]">
            {[v.date, v.arrival ? `arrive ${v.arrival}` : "", v.serviceStart && v.serviceEnd ? `service ${v.serviceStart} to ${v.serviceEnd}` : ""]
              .filter(Boolean)
              .join(", ")}
          </p>
          <p className="text-[15px] text-[#6B5D52]">{[v.guestCount ? `${v.guestCount} guests` : "", v.package].filter(Boolean).join(" · ")}</p>
          <Link href={`/team/e/${id}`} className="inline-block mt-1 text-sm text-[#B5845A] underline">
            Open the event page
          </Link>
        </div>
        <AssignPanel
          sessionId={id}
          summary={`${staffingLabel(counts)}${counts.accepted ? `, ${counts.accepted} accepted` : ""}${counts.stillNeeded ? ` · ${counts.stillNeeded} still needed` : ""}`}
          covered={counts.needed !== null && counts.stillNeeded === 0}
          people={people}
          available={available}
        />
      </main>
    </>
  );
}
