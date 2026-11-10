import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/team/auth";
import { eventPageData, openEvent } from "@/lib/team/events";
import { CHECKLIST_FOOTER } from "@/lib/team/checklist-config";
import TeamHeader from "../../team-header";
import EventTabs from "./event-tabs";

export const dynamic = "force-dynamic";

// Only the staff view built in lib/team/event-view.ts (an allowlist) and the
// lists reach the client component. The raw session row never does.
export default async function TeamEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await getCurrentStaff();
  if (!staff) redirect(`/team?next=/team/e/${encodeURIComponent(id)}`);

  const access = await openEvent(id, staff);
  if (!access.ok) {
    return (
      <>
        <TeamHeader signedIn back={{ href: "/team/events", label: "Your events" }} />
        <main className="max-w-md mx-auto px-4 py-10 text-center">
          <p className="text-[15px] text-[#6B5D52]">
            {access.reason === "not_found" ? "We could not find that event." : "You are not assigned to this event."}
          </p>
        </main>
      </>
    );
  }

  const data = await eventPageData(access.session, staff);
  return (
    <>
      <TeamHeader signedIn back={{ href: "/team/events", label: "Your events" }} />
      <EventTabs
        view={data.view}
        checklist={data.checklist}
        checklistState={data.checklistState}
        checklistFooter={CHECKLIST_FOOTER}
        shopping={data.shopping}
        shoppingState={data.shoppingState}
      />
    </>
  );
}
