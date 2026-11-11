import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { getSubmittedSession, managerEventView, missingReports } from "@/lib/team/events";
import { assigneeProgress, listStaff } from "@/lib/team/assignments-db";
import { staffingCounts, staffingLabel } from "@/lib/team/assignments";
import { bartendersNeeded } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import TeamHeader from "../../../team-header";
import { markThreadRead, threadMessages, unreadByEvent } from "@/lib/team/chat-db";
import AssignPanel from "./assign-panel";
import HideAction from "./hide-action";
import EditEvent, { type EditValues } from "./edit-event";
import { PACKAGE_CHOICES } from "@/lib/team/admin-edit";
import { eventDay, parseClock } from "@/lib/team/time";
import { isHidden } from "@/lib/team/hidden";
import { ensureMarket } from "@/lib/team/markets-db";
import { handoffPanel, postPanel } from "@/lib/team/shifts-db";
import { marketLabel } from "@/lib/team/markets";
import ShiftPanel from "./shift-panel";
import { eventDayOf, unavailableOn } from "@/lib/team/availability-db";
import { closeoutsFor } from "@/lib/team/closeout-db";
import Closeouts from "./closeouts";
import { compactLines } from "@/lib/team/reliability-db";
import { certIssues } from "@/lib/team/certs-db";
import ClientListPanel from "./client-list-panel";
import { autoSendOn, holdsFor, listLog } from "@/lib/client-list-db";
import { clientList, clientListText } from "@/lib/client-list";
import { getSheetView, syncOrderSheet } from "@/lib/order-sheet-db";
import { barReadyEntries } from "@/lib/team/bar-ready-db";
import { isManagerTab, type ManagerTab } from "@/lib/team/manager-tabs";
import { Details } from "../../../e/[id]/event-tabs";
import BarReadyCard from "../../../e/[id]/bar-ready";
import OrderSheet from "./order/order-sheet";
import ManagerTabs from "./manager-tabs";
import ManagerChat from "./manager-chat";
import { ChecklistProgress, MissingReports, TimePunches } from "./day-of";

export const dynamic = "force-dynamic";

// The manager view of one event, admins only: every admin section of the
// event under tabs (Details, Team, Order sheet, Client list, Day of, Chat).
// requireAdmin runs first, so bartenders (and admins in Bartender view) never
// get past it, and every route behind each tab checks admin again on the server.
function hhmm(v: unknown): string {
  const m = parseClock(v);
  if (m === null) return "";
  const n = m % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

export default async function AdminEventPage({
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

  await ensureMarket(session); // works out the market from the address the first time, and after an address change
  await syncOrderSheet(session);
  const [people, staff, hidden, panel, handoffs, unread, v, sheet, bar, missing, messages] = await Promise.all([
    assigneeProgress(session),
    listStaff(),
    isHidden(id),
    postPanel(session),
    handoffPanel(session),
    unreadByEvent(me.id, [id]),
    managerEventView(session),
    getSheetView(session),
    barReadyEntries(id, me),
    missingReports(id),
    threadMessages(id, me),
  ]);
  if (tab === "chat") await markThreadRead(id, me.id);
  const lookIds = [
    ...staff.filter((s) => s.active).map((s) => s.id),
    ...handoffs.flatMap((h) => [h.fromStaffId, h.teammateStaffId ?? ""]).filter(Boolean),
    ...panel.requesters.map((r) => r.staffId),
    ...handoffs.flatMap((h) => h.requesters.map((r) => r.staffId)),
  ];
  const [closeouts, records, certs, autoSend, pendingHolds, listEntries] = await Promise.all([
    closeoutsFor(id),
    compactLines(lookIds),
    certIssues(lookIds, panel.market),
    autoSendOn(),
    holdsFor(id, "pending"),
    listLog(id),
  ]);
  const away = await unavailableOn(eventDayOf(session));
  const chatUnread = tab === "chat" ? 0 : (unread.get(id) ?? 0);
  const marketSource = (session as { team_market_source?: string | null }).team_market_source ?? null;
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
    .map((s) => ({ id: s.id, name: s.name || s.phone, role: s.role, declined: people.some((p) => p.staffId === s.id), markets: s.markets, unavailable: away.has(s.id), record: records[s.id], cert: certs[s.id] }));
  const sheetFlags = sheet.sheet.sections.flatMap((s) => s.lines).filter((l) => l.conflict || l.gone).length;

  const header = (
    <div className="px-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{eventTitle(ed)}</h1>
        <p className="text-[15px] text-[#6B5D52]">
          {[v.date, v.arrival ? `arrive ${v.arrival}` : "", v.serviceStart && v.serviceEnd ? `service ${v.serviceStart} to ${v.serviceEnd}` : ""].filter(Boolean).join(", ")}
        </p>
        <p className="text-[15px] text-[#6B5D52]">{[v.market, v.guestCount ? `${v.guestCount} guests` : "", v.package].filter(Boolean).join(" · ")}</p>
        {v.timeZone !== "America/Chicago" && <p className="text-sm text-[#9A7049]">Times are Pacific time.</p>}
      </div>
      <Link href={`/team/e/${encodeURIComponent(id)}?as=bartender`} className="shrink-0 pt-1 text-sm text-[#B5845A] underline">
        Bartender view of this event
      </Link>
    </div>
  );

  const panels: Record<ManagerTab, React.ReactNode> = {
    details: (
      <>
        <Details v={v} />
        {!hidden && <EditEvent sessionId={id} version={session.version} initial={editValues} packages={packages} />}
        <HideAction sessionId={id} hidden={hidden} />
      </>
    ),
    team: hidden ? (
      <p className="text-sm text-[#6B5D52] px-1">Market: {marketLabel(panel.market)}. Hidden events cannot be posted or staffed. Unhide it on Details.</p>
    ) : (
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
    ),
    order: <OrderSheet initial={sheet} timeZone={v.timeZone} />,
    client: (
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
          listChanges: h.list_changes ?? "",
          price: h.price?.price_text ?? "",
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
    dayof: (
      <>
        <ChecklistProgress people={people} timeZone={v.timeZone} />
        <section className="space-y-2">
          <h2 className="px-1 font-heading text-base font-bold text-[#2C2420]">Bar ready</h2>
          <BarReadyCard sessionId={id} canSubmit={false} isAdmin entries={bar} timeZone={v.timeZone} />
        </section>
        <MissingReports reports={missing} timeZone={v.timeZone} />
        <TimePunches people={people} timeZone={v.timeZone} />
        {closeouts.length > 0 ? (
          <Closeouts closeouts={closeouts} timeZone={v.timeZone} />
        ) : (
          <section className={card}>
            <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Closeout</h2>
            <p className="text-[15px] text-[#6B5D52]">No closeouts yet.</p>
          </section>
        )}
      </>
    ),
    chat: <ManagerChat sessionId={id} initial={messages} unread={chatUnread} timeZone={v.timeZone} />,
  };

  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <ManagerTabs
        initialTab={tab}
        header={header}
        panels={panels}
        counts={{
          team: hidden ? 0 : counts.stillNeeded + handoffs.length,
          order: sheetFlags,
          client: pendingHolds.length,
          dayof: missing.length,
          chat: chatUnread,
        }}
      />
    </>
  );
}
