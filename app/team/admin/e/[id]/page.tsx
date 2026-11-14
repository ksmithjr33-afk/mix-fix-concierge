import Link from "next/link";
import { timed } from "@/lib/timing";
import { requireAdmin } from "@/lib/team/auth";
import { getSubmittedSession, managerEventView, missingReports, teamLists } from "@/lib/team/events";
import { assigneeProgress, listStaff } from "@/lib/team/assignments-db";
import { staffingCounts, staffingLabel } from "@/lib/team/assignments";
import { bartendersNeeded } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import TeamHeader from "../../../team-header";
import { markThreadRead, mutedChats, threadMessages, unreadByEvent } from "@/lib/team/chat-db";
import { adminPickupView } from "@/lib/team/menu-pickup-db";
import MenuPickupPanel from "./menu-pickup-panel";
import { adminMenuView } from "@/lib/team/approved-menu-db";
import { distancesToEvent } from "@/lib/team/profile-db";
import HideAction from "./hide-action";
import EditEvent, { type EditValues } from "./edit-event";
import { PACKAGE_CHOICES } from "@/lib/team/admin-edit";
import { eventDay, eventSchedule, parseClock, todayIn } from "@/lib/team/time";
import { isHidden } from "@/lib/team/hidden";
import { ensureMarket } from "@/lib/team/markets-db";
import { handoffPanel, postPanel } from "@/lib/team/shifts-db";
import { marketLabel } from "@/lib/team/markets";
import { eventDayOf, unavailableOn } from "@/lib/team/availability-db";
import { closeoutsFor, unreviewedProblems } from "@/lib/team/closeout-db";
import { staffSupplies } from "@/lib/team/supplies-db";
import { withDrinkEdits } from "@/lib/team/event-view";
import { barPhotoMissing } from "@/lib/team/bar-ready";
import { dayOfCount, serviceStarted, wrapUpLate } from "@/lib/team/wrapup";
import { firstName } from "@/lib/team/event-view";
import { compactLines } from "@/lib/team/reliability-db";
import { certIssues } from "@/lib/team/certs-db";
import { autoSendOn, holdsFor, listLog } from "@/lib/client-list-db";
import { clientList, clientListText } from "@/lib/client-list";
import { getSheetView, syncOrderSheet } from "@/lib/order-sheet-db";
import { barReadyEntries } from "@/lib/team/bar-ready-db";
import { isManagerTab, type ManagerTab } from "@/lib/team/manager-tabs";
import { Details } from "../../../e/[id]/event-details";
import { AssignPanel, BarReadyCard, ClientListPanel, Closeouts, ManagerChat, OrderSheet, ShiftPanel } from "./lazy-panels";
import ManagerTabs from "./manager-tabs";
import { BartenderLists, ClockStatus, MissingReports, TimePunches } from "./day-of";
import ClientLinksCard from "./client-links-card";
import { clientLinks, clientStatusLine } from "@/lib/client-links";
import { changeBlocks, type FieldChange } from "@/lib/event-diff";
import { giphyEnabled } from "@/lib/team/media";
import { eventNumberFor, historyFor } from "@/lib/client-history-db";
import { repeatLabel } from "@/lib/client-history";
import ClientHistoryCard from "./client-history-card";
import PriceNeededCard from "./price-needed-card";
import { pendingBlocks, pendingSummary } from "@/lib/price-pending";

export const dynamic = "force-dynamic";

// The manager view of one event, admins only: every admin section of the
// event under tabs (Details, Team, Shopping list, Client list, Day of, Chat).
// requireAdmin runs first, so bartenders (and admins in Bartender view) never
// get past it, and every route behind each tab checks admin again on the server.
function hhmm(v: unknown): string {
  const m = parseClock(v);
  if (m === null) return "";
  const n = m % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

async function AdminEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const asked = (await searchParams).tab;
  const tab: ManagerTab = isManagerTab(asked) ? asked : "details";
  const me = await requireAdmin(`/team/admin/e/${encodeURIComponent(id)}${tab !== "details" ? `?tab=${tab}` : ""}`);
  const back = { href: "/team/admin/events", label: "All events" };
  const session = await getSubmittedSession(id);
  if (!session) {
    return (
      <>
        <TeamHeader signedIn admin back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">We could not find that event.</main>
      </>
    );
  }

  // The market from the address (first time, and after an address change) and
  // the Shopping list sync both finish before anything below reads them.
  await Promise.all([ensureMarket(session), syncOrderSheet(session)]);

  // Only the open tab's panel is built. Everything a tab count needs loads on
  // every visit; what only one tab shows loads when that tab is open. Each
  // promise starts as soon as what it depends on is ready.
  const on = (t: ManagerTab) => tab === t;
  const none = <T,>(v: T) => Promise.resolve(v);
  const suppliesP = staffSupplies(session); // the bartenders' list, read from the Shopping list
  const peopleP = suppliesP.then((s) => assigneeProgress(session, s.list));
  const listsP = Promise.all([peopleP, suppliesP]).then(([people, s]) => teamLists(session, people.filter((p) => p.status !== "declined").map((p) => p.staffId), s.list));
  const staffP = on("team") || on("details") ? listStaff() : none<Awaited<ReturnType<typeof listStaff>>>([]);
  const panelP = on("team") ? postPanel(session) : null;
  const handoffsP = handoffPanel(session);
  const lookIdsP = panelP
    ? early(Promise.all([staffP, handoffsP, panelP]).then(([staff, handoffs, panel]) => [
        ...staff.filter((s) => s.active).map((s) => s.id),
        ...handoffs.flatMap((h) => [h.fromStaffId, h.teammateStaffId ?? ""]).filter(Boolean),
        ...panel.requesters.map((r) => r.staffId),
        ...handoffs.flatMap((h) => h.requesters.map((r) => r.staffId)),
      ]))
    : null;

  const [supplies, people, lists, staff, panel, handoffs, hidden, unread, view, sheet, bar, missing, pickup, menuFile, closeouts, pendingHolds] = await Promise.all([
    suppliesP,
    peopleP,
    listsP,
    staffP,
    panelP,
    handoffsP,
    isHidden(id),
    unreadByEvent(me.id, [id]),
    managerEventView(session),
    getSheetView(session),
    barReadyEntries(id, me),
    missingReports(id),
    adminPickupView(session),
    adminMenuView(session),
    closeoutsFor(id),
    holdsFor(id, "pending"),
  ]);
  // Team tab only.
  const [records, certs, distances, away] =
    panel && lookIdsP
      ? await Promise.all([
          lookIdsP.then((ids) => compactLines(ids)),
          lookIdsP.then((ids) => certIssues(ids, panel.market)),
          distancesToEvent(session, staff.filter((s) => s.active).map((s) => s.id)),
          unavailableOn(eventDayOf(session)),
        ])
      : [
          {} as Awaited<ReturnType<typeof compactLines>>,
          {} as Awaited<ReturnType<typeof certIssues>>,
          new Map() as Awaited<ReturnType<typeof distancesToEvent>>,
          new Set<string>() as Awaited<ReturnType<typeof unavailableOn>>,
        ];
  // Details, Client list and Chat only.
  const [links, autoSend, listEntries, messages, muted, history, eventNumber] = await Promise.all([
    on("details") ? clientLinks(session, me) : null, // admins only: null for anyone else
    on("client") ? autoSendOn() : false,
    on("client") ? listLog(id) : [],
    on("chat") ? threadMessages(id, me) : [],
    on("chat") ? mutedChats(me.id) : new Set<string>(),
    // Client history only with Details open; the header's repeat tag reads just this email's sessions. Admins only.
    on("details")
      ? historyFor(session, me).catch((err) => {
          console.error("[client history] could not load:", err);
          return null;
        })
      : null,
    eventNumberFor(session, me).catch(() => null),
  ]);
  const repeat = repeatLabel(eventNumber);
  if (tab === "chat") await markThreadRead(id, me.id);
  const v = { ...view, drinks: withDrinkEdits(view.drinks, supplies.recipes) };
  const addedBy = (session as { created_by?: string | null; created_by_name?: string | null }).created_by === "admin" ? (session as { created_by_name?: string | null }).created_by_name || "an admin" : null;
  const onEventIds = people.filter((p) => p.status !== "declined").map((p) => p.staffId);

  // The Day of count: missing reports, no bar photo after service starts, lists
  // with unchecked items at service start, wrap ups with problems not yet
  // reviewed, and wrap ups not in 2 hours after service ends.
  const now = new Date();
  const edNow = session.event_data ?? {};
  const started = serviceStarted(edNow, now);
  const accepted = people.filter((p) => p.status === "accepted");
  const photoCount = bar.reduce((n, e) => n + e.photos.length, 0);
  const waiting = accepted.filter((p) => !closeouts.some((c) => c.staffId === p.staffId)).map((p) => ({ name: firstName(p.name) || p.name, late: wrapUpLate(edNow, now) }));
  const dayofCount = dayOfCount({
    missingReports: missing.length,
    photoMissing: accepted.length > 0 && barPhotoMissing(edNow, now, photoCount),
    listsUnfinished: started ? accepted.filter((p) => { const l = lists.get(p.staffId); return !!l && (l.checklist.unchecked.length > 0 || l.supplies.unchecked.length > 0); }).length : 0,
    wrapUpProblems: unreviewedProblems(closeouts),
    wrapUpsLate: waiting.filter((w) => w.late).length,
  });
  const onList = new Set(onEventIds);
  const chatUnread = on("chat") ? 0 : (unread.get(id) ?? 0);
  const marketSource = (session as { team_market_source?: string | null }).team_market_source ?? null;
  const counts = staffingCounts(bartendersNeeded(session), people.map((p) => p.status));
  const ed = session.event_data ?? {};
  const sheetFlags = sheet.sheet.sections.flatMap((s) => s.lines).filter((l) => l.conflict || l.gone).length;

  const header = (
    <div className="px-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{eventTitle(ed)}</h1>
        <p className="text-[15px] text-[#6B5D52]">
          {[v.date, v.arrival ? `arrive ${v.arrival}` : "", v.serviceStart && v.serviceEnd ? `service ${v.serviceStart} to ${v.serviceEnd}` : ""].filter(Boolean).join(", ")}
        </p>
        <p className="text-[15px] text-[#6B5D52]">{[v.market, v.guestCount ? `${v.guestCount} guests` : "", v.package].filter(Boolean).join(" · ")}</p>
        {repeat && <p className="mt-1 inline-block text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#EDE3F5] text-[#5B3F7A]">{repeat}</p>}
        {v.timeZone !== "America/Chicago" && <p className="text-sm text-[#9A7049]">Times are Pacific time.</p>}
      </div>
      <Link href={`/team/e/${encodeURIComponent(id)}?as=bartender`} className="shrink-0 pt-1 text-sm text-[#B5845A] underline">
        Bartender view of this event
      </Link>
    </div>
  );

  const panels: Record<ManagerTab, () => React.ReactNode> = {
    details: () => {
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
      return (
        <>
          {session.price_pending && (
            <PriceNeededCard sessionId={id} summary={pendingSummary(session.price_pending_info)} blocks={pendingBlocks(session.price_pending_info)} />
          )}
          <ClockStatus people={people} timeZone={v.timeZone} />
          {addedBy && (
            <p className="px-1 text-sm text-[#6B5D52]">Added by {addedBy}</p>
          )}
          <MenuPickupPanel
            initial={pickup}
            people={staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name || s.phone, role: s.role }))}
            menu={menuFile}
            today={todayIn(eventSchedule(edNow).tz, now)}
          />
          {links && (
            <ClientLinksCard conciergeUrl={links.conciergeUrl} eventUrl={links.eventUrl} openConcierge={links.openConcierge} openEvent={links.openEvent} status={clientStatusLine(links, v.timeZone)} />
          )}
          {history && <ClientHistoryCard history={history} clientKey={history.matchedOn} />}
          <Details v={v} />
          {!hidden && <EditEvent sessionId={id} version={session.version} initial={editValues} packages={packages} />}
          <HideAction sessionId={id} hidden={hidden} />
        </>
      );
    },
    team: () => {
      if (!panel) return null;
      if (hidden) return <p className="text-sm text-[#6B5D52] px-1">Market: {marketLabel(panel.market)}. Hidden events cannot be posted or staffed. Unhide it on Details.</p>;
      const onEvent = new Set(people.filter((p) => p.status !== "declined").map((p) => p.staffId));
      const available = staff
        .filter((s) => s.active && !onEvent.has(s.id))
        .map((s) => ({ id: s.id, name: s.name || s.phone, role: s.role, declined: people.some((p) => p.staffId === s.id), markets: s.markets, unavailable: away.has(s.id), record: records[s.id], cert: certs[s.id], distance: distances.get(s.id) }));
      return (
        <>
          <AssignPanel
            sessionId={id}
            summary={`${staffingLabel(counts)}${counts.accepted ? `, ${counts.accepted} accepted` : ""}${counts.stillNeeded ? ` · ${counts.stillNeeded} still needed` : ""}`}
            covered={counts.needed !== null && counts.stillNeeded === 0}
            people={people}
            available={available}
            timeZone={v.timeZone}
            market={panel.market}
            showProgress={false}
          />
          <ShiftPanel sessionId={id} panel={panel} handoffs={handoffs} marketSource={marketSource} timeZone={v.timeZone} records={records} certs={certs} />
        </>
      );
    },
    order: () => <OrderSheet initial={sheet} timeZone={v.timeZone} />,
    client: () => (
      <ClientListPanel
        sessionId={id}
        autoSend={autoSend}
        timeZone={v.timeZone}
        listText={clientListText(clientList(ed))}
        holds={pendingHolds.map((h) => ({
          id: h.id,
          kind: h.kind,
          createdAt: h.created_at,
          summary: h.summary ?? "",
          blocks: changeBlocks((h.changes ?? []) as FieldChange[]),
          listChanges: h.list_changes ?? "",
          price: h.price?.price_text ?? "",
          priceAmount: h.price?.amount ?? null,
        }))}
        log={listEntries.map((l) => ({
          id: l.id,
          at: l.created_at,
          action: l.action,
          reason: l.reason ?? "",
          detail: l.detail,
          changes: l.changes ?? "",
          by: l.by_name ?? "",
          dryRun: l.dry_run,
        }))}
      />
    ),
    dayof: () => (
      <>
        <section className="space-y-2">
          <h2 className="px-1 font-heading text-base font-bold text-[#2C2420]">Bar setup photos</h2>
          <BarReadyCard sessionId={id} canSubmit={false} isAdmin entries={bar} timeZone={v.timeZone} reminder={accepted.length > 0 && barPhotoMissing(edNow, now, photoCount) ? "Bar service has started and no bar setup photo is in yet." : undefined} />
        </section>
        <BartenderLists people={people} lists={lists} reports={missing} timeZone={v.timeZone} />
        <MissingReports reports={missing.filter((r) => !onList.has(r.staffId))} timeZone={v.timeZone} />
        <Closeouts sessionId={id} closeouts={closeouts} waiting={started ? waiting : []} timeZone={v.timeZone} />
        <TimePunches people={people} timeZone={v.timeZone} />
      </>
    ),
    chat: () => <ManagerChat sessionId={id} initial={messages} unread={chatUnread} timeZone={v.timeZone} muted={muted.has(id)} isAdmin gifSearch={giphyEnabled()} />,
  };

  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <ManagerTabs
        initialTab={tab}
        sessionId={id}
        header={header}
        panel={panels[tab]()}
        counts={{
          // The menu is not picked up (or nobody is assigned) inside 48 hours, and no approved menu inside 72 hours.
          details: (pickup.outstanding ? 1 : 0) + (menuFile.missing ? 1 : 0) + (session.price_pending ? 1 : 0),
          team: hidden ? 0 : counts.stillNeeded + handoffs.length,
          order: sheetFlags,
          client: pendingHolds.length,
          dayof: dayofCount,
          chat: chatUnread,
        }}
      />
    </>
  );
}

/** A promise awaited later: no unhandled rejection if the page fails before it is awaited. */
function early<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}

export default async function Page(props: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return timed(`manager:${(await props.searchParams).tab ?? "details"}`, () => AdminEventPage(props));
}
