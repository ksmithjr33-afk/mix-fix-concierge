import { redirect } from "next/navigation";
import { timed } from "@/lib/timing";
import { requireStaff } from "@/lib/team/auth";
import { eventLanding } from "@/lib/team/manager-tabs";
import { eventPageData, openEvent } from "@/lib/team/events";
import { CHECKLIST_FOOTER } from "@/lib/team/checklist-config";
import { barReadyEntries } from "@/lib/team/bar-ready-db";
import { barPhotoMissing, barPhotosOpen, barReadyOpensAt } from "@/lib/team/bar-ready";
import { timeLabel } from "@/lib/team/clock-label";
import { closeoutState } from "@/lib/team/closeout-db";
import { companyGear } from "@/lib/team/closeout";
import { myEstimate } from "@/lib/team/pay-db";
import { shoppingGroups } from "@/lib/team/shopping";
import { assignmentRef, clockView, punchesFor } from "@/lib/team/clock-db";
import { eventData } from "@/lib/team/markets";
import { myHandoff, teammateChoices } from "@/lib/team/shifts-db";
import { markThreadRead, threadMessages, unreadByEvent } from "@/lib/team/chat-db";
import { myPickupFor } from "@/lib/team/menu-pickup-db";
import { staffIceView } from "@/lib/team/ice-pickup-db";
import { staffMenuSection } from "@/lib/team/approved-menu-db";
import { giphyEnabled } from "@/lib/team/media";
import TeamHeader from "../../team-header";
import EventTabs, { type Tab } from "./event-tabs";

export const dynamic = "force-dynamic";

/** The render time, handed to the clock card so its first paint matches the server. */
function serverNow(): number {
  return Date.now();
}

// Only the staff view built in lib/team/event-view.ts (an allowlist) and the
// lists reach the client component. The raw session row never does.
async function TeamEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const chatTab = query.tab === "chat";
  // Links from texts can open a tab: the chat, or the wrap up reminder.
  const askedTab: Tab = (["chat", "wrapup", "shopping", "checklist"] as const).find((t) => t === query.tab) ?? "details";
  const asBartender = query.as === "bartender";
  const staff = await requireStaff(`/team/e/${encodeURIComponent(id)}${askedTab !== "details" ? `?tab=${askedTab}` : asBartender ? "?as=bartender" : ""}`);
  // Admins land on the manager view of the event from any link (texts, lists,
  // the calendar), unless they asked for the bartender view of it. An admin in
  // Bartender view comes back as a bartender here, so they stay on this page.
  const landing = eventLanding(staff, id, query);
  if (landing) redirect(landing);
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
  // What depends on this person's assignment starts as soon as it is read.
  const assignmentP = assignmentRef(id, staff.id);
  const [data, entries, assignment, messages, unread, closeout, menuPickup, menuSection, punches, pay, [handoff, teammates], ice] = await Promise.all([
    eventPageData(access.session, staff),
    barReadyEntries(id, staff),
    assignmentP,
    threadMessages(id, staff),
    unreadByEvent(staff.id, [id]),
    closeoutState(access.session, staff),
    myPickupFor(id, staff),
    staffMenuSection(access.session, staff),
    assignmentP.then((a) => (a ? punchesFor(a.id) : [])),
    // Only the viewer's own estimate, and only on an event they are on.
    assignmentP.then((a) => (a && a.status !== "declined" ? myEstimate(staff.id, access.session) : null)),
    assignmentP.then((a) => (a?.status === "accepted" ? Promise.all([myHandoff(id, staff.id), teammateChoices(access.session, staff.id)]) : ([null, []] as [null, never[]]))),
    // The ice pickup card: everyone on the event sees who is picking up and each status.
    staffIceView(access.session, staff),
  ]);
  if (chatTab) await markThreadRead(id, staff.id);
  const accepted = assignment?.status === "accepted";
  const renderedAt = serverNow();
  const open = barPhotosOpen(ed);
  const photoCount = entries.reduce((n, e) => n + e.photos.length, 0);
  const onEvent = staff.role === "admin" || (!!assignment && assignment.status !== "declined");
  const opensAt = barReadyOpensAt(ed);
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={back} />
      <EventTabs
        initialTab={askedTab === "wrapup" && !closeout.open ? "details" : askedTab}
        chat={{ sessionId: id, initial: messages, unread: unread.get(id) ?? 0, timeZone: data.view.timeZone, isAdmin: staff.role === "admin", gifSearch: giphyEnabled() }}
        offered={assignment?.status === "offered"}
        giveUp={accepted ? { sessionId: id, handoff, teammates, canStart: punches.length === 0 } : null}
        clock={clockView(assignment, ed, punches)}
        renderedAt={renderedAt}
        managerHref={staff.role === "admin" ? `/team/admin/e/${encodeURIComponent(id)}` : null}
        view={data.view}
        checklist={data.checklist}
        checklistState={data.checklistState}
        checklistFooter={CHECKLIST_FOOTER}
        confirmedAt={data.confirmedAt}
        shopping={shoppingGroups(data.view.package, data.shopping)}
        shoppingState={data.shoppingState}
        supplyUpdates={data.supplyUpdates}
        barReady={{
          show: onEvent,
          canSubmit: open,
          isAdmin: staff.role === "admin",
          entries,
          timeZone: data.view.timeZone,
          opensNote: opensAt && renderedAt < opensAt.getTime() ? `You can add photos from arrival time, ${timeLabel(opensAt.toISOString(), undefined, data.view.timeZone)}.` : "",
        }}
        photoReminder={
          accepted && open && barPhotoMissing(ed, new Date(renderedAt), photoCount)
            ? "No bar setup photo yet. When you have a minute, take one so the office can see the setup."
            : null
        }
        pay={pay}
        closeout={
          closeout.open && staff.role !== "admin"
            ? { canSubmit: closeout.canSubmit, mine: closeout.mine, gear: companyGear(), items: closeout.items, clientAlcohol: closeout.clientAlcohol, timeZone: data.view.timeZone }
            : null
        }
        wrapUpDone={!!closeout.mine}
        menuPickup={menuPickup}
        menuSection={menuSection}
        ice={ice}
      />
    </>
  );
}

export default async function Page(props: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return timed(`bartender-event:${(await props.searchParams).tab ?? "details"}`, () => TeamEventPage(props));
}
