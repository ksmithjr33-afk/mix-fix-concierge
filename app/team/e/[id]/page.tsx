import { requireStaff } from "@/lib/team/auth";
import { eventPageData, getAssignment, openEvent } from "@/lib/team/events";
import { CHECKLIST_FOOTER } from "@/lib/team/checklist-config";
import { barReadyEntries } from "@/lib/team/bar-ready-db";
import { barReadyOpen } from "@/lib/team/bar-ready";
import { shoppingGroups } from "@/lib/team/shopping";
import TeamHeader from "../../team-header";
import EventTabs from "./event-tabs";

export const dynamic = "force-dynamic";

// Only the staff view built in lib/team/event-view.ts (an allowlist) and the
// lists reach the client component. The raw session row never does.
export default async function TeamEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaff(`/team/e/${encodeURIComponent(id)}`);
  const back = { href: "/team/events", label: staff.role === "admin" ? "All events" : "Your events" };

  const access = await openEvent(id, staff);
  if (!access.ok) {
    return (
      <>
        <TeamHeader signedIn admin={staff.role === "admin"} back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center">
          <p className="text-[15px] text-[#6B5D52]">
            {access.reason === "not_found" ? "We could not find that event." : "You are not assigned to this event."}
          </p>
        </main>
      </>
    );
  }

  const ed = access.session.event_data ?? {};
  const [data, entries, assignment] = await Promise.all([
    eventPageData(access.session, staff),
    barReadyEntries(id, staff),
    getAssignment(id, staff.id),
  ]);
  const open = barReadyOpen(ed);
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={back} />
      <EventTabs
        offered={assignment?.status === "offered"}
        manageHref={staff.role === "admin" ? `/team/admin/e/${id}` : null}
        view={data.view}
        checklist={data.checklist}
        checklistState={data.checklistState}
        checklistFooter={CHECKLIST_FOOTER}
        confirmedAt={data.confirmedAt}
        shopping={shoppingGroups(data.view.package, data.shopping)}
        shoppingState={data.shoppingState}
        barReady={{
          show: open || entries.length > 0,
          canSubmit: open,
          isAdmin: staff.role === "admin",
          entries,
        }}
      />
    </>
  );
}
