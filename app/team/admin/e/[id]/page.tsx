import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { assigneeProgress, listStaff } from "@/lib/team/assignments-db";
import { staffingCounts, staffingLabel } from "@/lib/team/assignments";
import { bartendersNeeded, buildStaffEventView } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import TeamHeader from "../../../team-header";
import AssignPanel from "./assign-panel";
import HideAction from "./hide-action";
import EditEvent, { type EditValues } from "./edit-event";
import { PACKAGE_CHOICES } from "@/lib/team/admin-edit";
import { eventDay, parseClock } from "@/lib/team/time";
import { isHidden } from "@/lib/team/hidden";

export const dynamic = "force-dynamic";

// Assign or remove staff for one event, with each person's checklist and shopping progress.
function hhmm(v: unknown): string {
  const m = parseClock(v);
  if (m === null) return "";
  const n = m % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

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

  const [people, staff, hidden] = await Promise.all([assigneeProgress(session), listStaff(), isHidden(id)]);
  const v = buildStaffEventView(session);
  const counts = staffingCounts(bartendersNeeded(session), people.map((p) => p.status));
  const ed = session.event_data ?? {};
  const editValues: EditValues = {
    event_date: eventDay(ed.event_date ?? session.event_date) ?? "",
    bar_service_start: hhmm(ed.bar_service_start),
    bar_service_end: hhmm(ed.bar_service_end),
    guest_count: str(ed.guest_count ?? session.guest_count),
    bartenders: str(bartendersNeeded(session) ?? ""),
    package: str(ed.package ?? session.package_type),
    event_address: str(ed.event_address),
    parking_info: str(ed.parking_info),
    day_of_contact_name: str(ed.day_of_contact_name),
    day_of_contact_phone: str(ed.day_of_contact_phone),
    special_requests: str(ed.special_requests),
  };
  const packages = PACKAGE_CHOICES.includes(editValues.package) || !editValues.package ? PACKAGE_CHOICES : [editValues.package, ...PACKAGE_CHOICES];
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
        {hidden ? (
          <HideAction sessionId={id} hidden />
        ) : (
          <>
            <AssignPanel
              sessionId={id}
              summary={`${staffingLabel(counts)}${counts.accepted ? `, ${counts.accepted} accepted` : ""}${counts.stillNeeded ? ` · ${counts.stillNeeded} still needed` : ""}`}
              covered={counts.needed !== null && counts.stillNeeded === 0}
              people={people}
              available={available}
            />
            <EditEvent sessionId={id} version={session.version} initial={editValues} packages={packages} />
            <HideAction sessionId={id} hidden={false} />
          </>
        )}
      </main>
    </>
  );
}
