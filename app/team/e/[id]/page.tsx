import { requireStaff } from "@/lib/team/auth";
import { eventPageData, openEvent } from "@/lib/team/events";
import { CHECKLIST_FOOTER } from "@/lib/team/checklist-config";
import { barReadyEntries } from "@/lib/team/bar-ready-db";
import { barReadyOpen } from "@/lib/team/bar-ready";
import { closeoutState } from "@/lib/team/closeout-db";
import { companyGear } from "@/lib/team/closeout";
import { shoppingGroups } from "@/lib/team/shopping";
import { assignmentRef, clockView, punchesFor } from "@/lib/team/clock-db";
import { eventData } from "@/lib/team/markets";
import { myHandoff, teammateChoices } from "@/lib/team/shifts-db";
import { markThreadRead, threadMessages, unreadByEvent } from "@/lib/team/chat-db";
import TeamHeader from "../../team-header";
import EventTabs from "./event-tabs";

export const dynamic = "force-dynamic";

/** The render time, handed to the clock card so its first paint matches the server. */
function serverNow(): number {
  return Date.now();
}

// Only the staff view built in lib/team/event-view.ts (an allowlist) and the
// lists reach the client component. The raw session row never does.
export default async function TeamEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const chatTab = (await searchParams).tab === "chat";
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

  const ed = eventData(access.session);
  const [data, entries, assignment, messages, unread, closeout] = await Promise.all([
    eventPageData(access.session, staff),
    barReadyEntries(id, staff),
    assignmentRef(id, staff.id),
    threadMessages(id, staff),
    unreadByEvent(staff.id, [id]),
    closeoutState(access.session, staff),
  ]);
  if (chatTab) await markThreadRead(id, staff.id);
  const punches = assignment ? await punchesFor(assignment.id) : [];
  const accepted = assignment?.status === "accepted";
  const [handoff, teammates] = accepted ? await Promise.all([myHandoff(id, staff.id), teammateChoices(access.session, staff.id)]) : [null, []];
  const renderedAt = serverNow();
  const open = barReadyOpen(ed);
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={back} />
      <EventTabs
        initialTab={chatTab ? "chat" : "details"}
        chat={{ sessionId: id, initial: messages, unread: unread.get(id) ?? 0, timeZone: data.view.timeZone }}
        offered={assignment?.status === "offered"}
        giveUp={accepted ? { sessionId: id, handoff, teammates, canStart: punches.length === 0 } : null}
        clock={clockView(assignment, ed, punches)}
        renderedAt={renderedAt}
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
          timeZone: data.view.timeZone,
        }}
        closeout={
          closeout.open && staff.role !== "admin"
            ? { canSubmit: closeout.canSubmit, mine: closeout.mine, gear: companyGear(), timeZone: data.view.timeZone }
            : null
        }
      />
    </>
  );
}
