import Link from "next/link";
import { timed } from "@/lib/timing";
import { requireAdmin } from "@/lib/team/auth";
import { getSubmittedSession, managerEventView, missingReports, teamLists } from "@/lib/team/events";
import { assigneeProgress, listStaff } from "@/lib/team/assignments-db";
import { staffingCounts, staffingLabel } from "@/lib/team/assignments";
import { bartendersNeeded } from "@/lib/team/event-view";
import { adminEventTitle, eventSubtitle } from "@/lib/team/event-list";
import TeamHeader from "../../../team-header";
import { markThreadRead, mutedChats, threadMessages, unreadByEvent } from "@/lib/team/chat-db";
import { adminPickupView } from "@/lib/team/menu-pickup-db";
import MenuPickupPanel from "./menu-pickup-panel";
import IcePickupPanel from "./ice-pickup-panel";
import { iceView, pastPlaces, sheetIceBags } from "@/lib/team/ice-pickup-db";
import { adminMenuView } from "@/lib/team/approved-menu-db";
import { distancesToEvent } from "@/lib/team/profile-db";
import HideAction from "./hide-action";
import EditEvent, { type EditValues } from "./edit-event";
import { formValue, PACKAGE_CHOICES } from "@/lib/team/admin-edit";
import { chicagoStamp, eventSchedule, todayIn } from "@/lib/team/time";
import BartendersNeeded from "./bartenders-needed";
import { bartendersFix, bookedBartenders, estimateNote, staffingLog } from "@/lib/team/staffing-fix";
import { isHidden } from "@/lib/team/hidden";
import { ensureMarket } from "@/lib/team/markets-db";
import { handoffPanel, postPanel } from "@/lib/team/shifts-db";
import { eventData, marketLabel } from "@/lib/team/markets";
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
import { allowedTab, isManagerTab, managerTabsFor, type ManagerTab } from "@/lib/team/manager-tabs";
import { eventBusinessFor } from "@/lib/team/business-db";
import { supplyCostFor } from "@/lib/team/supply-costs-db";
import BusinessTab from "./business-tab";
import { Details, DrinkSections, WhatChanged } from "../../../e/[id]/event-details";
import EditableDetails from "./editable-details";
import { editCards } from "@/lib/team/edit-cards";
import PackageCard from "../../../package-card";
import { barbackStatus, bookingShortOf } from "@/lib/package-extras";
import DeliveryStrip from "./delivery-strip";
import HeldChangesBar from "./held-changes-bar";
import { heldSummary } from "@/lib/team/held-changes-db";
import { availabilityFor } from "@/lib/team/delivery-availability-db";
import { AssignPanel, BarReadyCard, ClientListPanel, Closeouts, ManagerChat, OffersPanel, OrderSheet, ShiftPanel } from "./lazy-panels";
import ManagerTabs from "./manager-tabs";
import { BartenderLists, ClockStatus, MissingReports, TimePunches } from "./day-of";
import ClientLinksCard from "./client-links-card";
import CalendarOnlyCard from "./calendar-only-card";
import AgreementCard from "./agreement-card";
import { agreementsFor } from "@/lib/team/agreements-db";
import { clientLinks, clientStatusLine } from "@/lib/client-links";
import { changeBlocks, type FieldChange } from "@/lib/event-diff";
import { giphyEnabled } from "@/lib/team/media";
import { eventNumberFor, historyFor } from "@/lib/client-history-db";
import { repeatLabel } from "@/lib/client-history";
import ClientHistoryCard from "./client-history-card";
import BookingSummaryCard from "./booking-summary-card";
import { bookingSummary } from "@/lib/booking-summary";
import { listReports } from "@/lib/team/low-stock-db";
import LowStockList from "../../running-low/report-list";
import { isAdminRole } from "@/lib/team/roles";
import PriceNeededCard from "./price-needed-card";
import { guestCountFlag } from "@/lib/intake-guests";
import { pendingBlocks, pendingSummary } from "@/lib/price-pending";
import { eventTimesheetRows } from "@/lib/team/timesheet-db";
import { payoutSheet } from "@/lib/team/payout-db";
import PayoutCard from "../../payout-card";
import { timePageHref } from "@/lib/team/clock-card";
import { rateTeamCard, tierBadges } from "@/lib/team/scorecard-db";
import { offersPanel } from "@/lib/team/scorecard-offers-db";
import RateTeamCard from "./rate-team-card";
import BookingCard from "./booking-card";
import { bookingCardData } from "@/lib/partners/client-view";
import type { EventSession } from "@/lib/partners/db";
import { venuePhotosFor } from "@/lib/team/venue-photos-db";
import VenuePhotos from "../../../e/[id]/venue-photos";
import Receipts from "../../../e/[id]/receipts";
import { adminReceiptsView, pendingReceiptCount } from "@/lib/team/receipts-db";
import SurpriseBanner from "../../../surprise-banner";
import { surpriseBannerText } from "@/lib/partners/surprise-banner";
import { billingFor } from "@/lib/partners/client-view";

export const dynamic = "force-dynamic";

// The manager view of one event, admins only: every admin section of the
// event under tabs (Details, Team, Pickups, Shopping list, Client list, Day of,
// Receipts, Chat, Agreement, and Business for admins).
// requireAdmin runs first, so bartenders (and admins in Bartender view) never
// get past it, and every route behind each tab checks admin again on the server.
async function AdminEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const asked = (await searchParams).tab;
  const askedTab: ManagerTab = isManagerTab(asked) ? asked : "details";
  const me = await requireAdmin(`/team/admin/e/${encodeURIComponent(id)}${askedTab !== "details" ? `?tab=${askedTab}` : ""}`);
  // Business is admins only: a manager asking for it gets Details, and its data never loads.
  const tab: ManagerTab = allowedTab(me.role, asked);
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
  const staffP = on("team") || on("pickups") ? listStaff() : none<Awaited<ReturnType<typeof listStaff>>>([]);
  const panelP = on("team") ? postPanel(session) : null;
  // Shift offers card: the planned order or the live offers. Never breaks the tab.
  const offersP = on("team")
    ? offersPanel(me, session).catch((err) => {
        console.error("[offers] panel failed:", err);
        return null;
      })
    : null;
  const handoffsP = handoffPanel(session);
  const sheetP = getSheetView(session);
  // Ice: the Shopping list's ice prefills the total bags. Used before locations only with Pickups open.
  const iceP = sheetP.then((s) => iceView(session, me, { listBags: sheetIceBags(session, s.sheet.sections) }));
  const placesP = on("pickups") ? pastPlaces() : none<Awaited<ReturnType<typeof pastPlaces>>>([]);
  const lookIdsP = panelP
    ? early(Promise.all([staffP, handoffsP, panelP]).then(([staff, handoffs, panel]) => [
        ...staff.filter((s) => s.active).map((s) => s.id),
        ...handoffs.flatMap((h) => [h.fromStaffId, h.teammateStaffId ?? ""]).filter(Boolean),
        ...panel.requesters.map((r) => r.staffId),
        ...handoffs.flatMap((h) => h.requesters.map((r) => r.staffId)),
      ]))
    : null;

  const [supplies, people, lists, staff, panel, handoffs, hidden, unread, view, sheet, bar, missing, pickup, menuFile, closeouts, pendingHolds, ice, places, receiptsWaiting] = await Promise.all([
    suppliesP,
    peopleP,
    listsP,
    staffP,
    panelP,
    handoffsP,
    isHidden(id),
    unreadByEvent(me.id, [id]),
    managerEventView(session),
    sheetP,
    barReadyEntries(id, me),
    missingReports(id),
    adminPickupView(session),
    adminMenuView(session),
    closeoutsFor(id),
    holdsFor(id, "pending"),
    iceP,
    placesP,
    // The Receipts tab badge: receipts waiting on review. 0 before the migration.
    pendingReceiptCount(id),
  ]);
  // Admin edits not sent to the team yet: the bar on every tab. Null before the migration.
  const held = await heldSummary(me, id).catch(() => null);
  // Team tab only.
  const [records, certs, distances, away, tiers] =
    panel && lookIdsP
      ? await Promise.all([
          lookIdsP.then((ids) => compactLines(ids)),
          lookIdsP.then((ids) => certIssues(ids, panel.market)),
          distancesToEvent(session, staff.filter((s) => s.active).map((s) => s.id)),
          unavailableOn(eventDayOf(session)),
          // Scorecard tiers beside names: admins and managers, display only, never their own.
          lookIdsP.then((ids) => tierBadges(me, [...ids, ...people.map((p) => p.staffId)])).catch(() => ({}) as Record<string, string>),
        ])
      : [
          {} as Awaited<ReturnType<typeof compactLines>>,
          {} as Awaited<ReturnType<typeof certIssues>>,
          new Map() as Awaited<ReturnType<typeof distancesToEvent>>,
          new Set<string>() as Awaited<ReturnType<typeof unavailableOn>>,
          {} as Record<string, string>,
        ];
  const offers = offersP ? await offersP : null;
  // Deliveries and pickups for everyone on the event: Team and Shopping list tabs only.
  const onEventPeople = people.filter((p) => p.status !== "declined");
  const delivery =
    on("team") || on("order")
      ? await availabilityFor(onEventPeople.map((p) => p.staffId), eventSchedule(session.event_data ?? {}).day)
          .then((m) => onEventPeople.map((p) => ({ staffId: p.staffId, name: p.name || p.phone, availability: m.get(p.staffId)! })))
          .catch(() => [])
      : [];
  // Details, Client list and Chat only.
  const [links, autoSend, listEntries, messages, muted, history, eventNumber, agreements, clockRows, payout, business, supplyCosts, lowStock, rateCard, venue, receipts, booking] = await Promise.all([
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
    // Agreements have pricing: admins and managers only (null for anyone else).
    on("agreement") ? agreementsFor(id, me, eventSchedule(session.event_data ?? {}).tz).catch(() => null) : null,
    // The Time clock card: the same rows the Time page and the payroll CSV build.
    on("details")
      ? eventTimesheetRows(id).catch((err) => {
          console.error("[time clock] could not load:", err);
          return [];
        })
      : [],
    // The Payout card on Day of: admins and managers (null for anyone else).
    on("dayof")
      ? payoutSheet(me, session).catch((err) => {
          console.error("[payout] could not load:", err);
          return null;
        })
      : null,
    // The Business tab: admins only (null for anyone else, managers included).
    on("business") ? eventBusinessFor(me, session) : null,
    // Costs on the Shopping list: admins only (null for managers).
    on("order") ? sheetP.then((s) => supplyCostFor(me, session, s)).then((c) => (c && !c.catalogEmpty ? c : null)) : null,
    // Running low: the open reports for this event, at the top of Day of.
    on("dayof") ? listReports(me, { open: true, sessionId: id }) : [],
    // Rate the team: admins and managers, after the event ends, never the viewer.
    on("dayof") ? rateTeamCard(me, session, people.map((p) => ({ staffId: p.staffId, name: p.name, status: p.status }))).catch(() => null) : null,
    // Bar and venue photos on the Location card. Never blocks the card: before the migration it loads empty.
    on("details")
      ? venuePhotosFor(session, me, null).catch((err) => {
          console.error("[venue photos] could not load:", err);
          return null;
        })
      : null,
    // Receipts: every receipt on the event, admins and managers (approving is admins only).
    on("receipts")
      ? adminReceiptsView(session, me, people.map((p) => ({ staffId: p.staffId, name: p.name, status: p.status }))).catch((err) => {
          console.error("[receipts] could not load:", err);
          return null;
        })
      : null,
    // The Booking card: who holds the booking, the host, planners. Shows "not set up yet" before the partners migration.
    on("details") && isAdminRole(me.role)
      ? bookingCardData(session as EventSession, me.role).catch((err) => {
          console.error("[partners] booking card could not load:", err);
          return null;
        })
      : null,
  ]);
  const repeat = repeatLabel(eventNumber);
  // Business tab: on a planner held event, the Lead is billed and the host is who it is for.
  const billing = on("business") && business ? await billingFor(session as EventSession).catch(() => null) : null;
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
  // The barback: needed whenever it is on (Big Day Bar, Premium, a Full Bar wedding unless removed).
  const barback = barbackStatus(session);
  const barbackNeeded = barback.on && !hidden && !people.some((p) => p.role === "bar_back" && p.status !== "declined");
  const ed = session.event_data ?? {};
  // The title follows the planner title rule (host's name, "via" the planner) once the partners migration runs.
  const titled = eventData(session);
  // The safety net: the guest count changed with no price change applied or pending.
  const guestFlag = guestCountFlag(session);
  const sheetFlags = sheet.sheet.sections.flatMap((s) => s.lines).filter((l) => l.conflict || l.gone).length;

  // A surprise event: at the top of every tab (Day of included), first name only.
  const surprise = surpriseBannerText(session, now);
  const header = (
    <>
    {surprise && <div className="mb-2"><SurpriseBanner text={surprise} /></div>}
    {held && <div className="mb-2"><HeldChangesBar key={held.rowIds.join()} sessionId={id} summary={held} /></div>}
    <div className="px-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{adminEventTitle(titled)}</h1>
        {eventSubtitle(ed) && <p className="text-[17px] text-[#2C2420] break-words">{eventSubtitle(ed)}</p>}
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
    </>
  );

  const panels: Record<ManagerTab, () => React.ReactNode> = {
    details: () => {
      // The priced Bartenders field edits the booking: the booking's number, not the Team tab's staffing number.
      const bart = bookedBartenders(session).count;
      const fv = (f: keyof EditValues) => formValue(f, ed, session, bart);
      const editValues: EditValues = {
        event_date: fv("event_date"),
        bar_service_start: fv("bar_service_start"),
        bar_service_end: fv("bar_service_end"),
        guest_count: fv("guest_count"),
        bartenders: fv("bartenders"),
        package: fv("package"),
        event_address: fv("event_address"),
        parking_info: fv("parking_info"),
        day_of_contact_name: fv("day_of_contact_name"),
        day_of_contact_phone: fv("day_of_contact_phone"),
        special_requests: fv("special_requests"),
      };
      const venuePhotos = venue ? (
        <VenuePhotos
          sessionId={id}
          initial={venue}
          timeZone={v.timeZone}
          barSetup={bar.flatMap((e) => e.photos.map((p) => ({ id: p.id, url: p.url, who: e.staffFirstName, at: p.createdAt })))}
        />
      ) : null;
      const packages = PACKAGE_CHOICES.includes(editValues.package) || !editValues.package ? PACKAGE_CHOICES : [editValues.package, ...PACKAGE_CHOICES];
      return (
        <>
          {session.price_pending && (
            <PriceNeededCard sessionId={id} summary={pendingSummary(session.price_pending_info)} blocks={pendingBlocks(session.price_pending_info)} />
          )}
          {guestFlag && (
            <section role="alert" className="rounded-2xl border-2 border-[#B3261E] bg-[#FDECEA] px-4 py-3 space-y-1">
              <h2 className="font-heading font-bold text-[#8C1D18]">Guest count differs from the booking</h2>
              <p className="text-sm text-[#2C2420]">{guestFlag.text}</p>
            </section>
          )}
          <ClockStatus
            people={people}
            rows={clockRows}
            timeZone={v.timeZone}
            title={[adminEventTitle(ed), v.date].filter(Boolean).join(", ")}
            timeHref={timePageHref(id, eventSchedule(ed).day)}
            times={{ arrival: eventSchedule(ed).arrival, end: eventSchedule(ed).end, now }}
          />
          {addedBy && (
            <p className="px-1 text-sm text-[#6B5D52]">Added by {addedBy}</p>
          )}
          {links && (
            <ClientLinksCard conciergeUrl={links.conciergeUrl} eventUrl={links.eventUrl} openConcierge={links.openConcierge} openEvent={links.openEvent} status={clientStatusLine(links, v.timeZone)} />
          )}
          {booking && <BookingCard sessionId={id} data={booking} barback={{ ...barbackStatus(session), version: session.version }} />}
          {history && <ClientHistoryCard history={history} clientKey={history.matchedOn} />}
          {/* Discount and gratuity amounts: admins and managers only. */}
          {isAdminRole(me.role) && bookingSummary(session) && <BookingSummaryCard summary={bookingSummary(session)!} />}
          {hidden ? (
            // Hidden events are not edited: the cards are read only until it is unhidden.
            <Details v={v} locationExtra={venuePhotos} />
          ) : (
            <div className="space-y-3">
              <WhatChanged v={v} />
              <EditableDetails sessionId={id} version={session.version} cards={editCards(v, ed, session)} packages={packages} locationExtra={venuePhotos} />
              <DrinkSections v={v} />
              {v.lastUpdated && <p className="text-xs text-[#A39585] px-1">Last updated {v.lastUpdated}</p>}
            </div>
          )}
          <PackageCard packageName={v.package} booking={bookingShortOf(session)} />
          {!hidden && <EditEvent sessionId={id} version={session.version} initial={editValues} packages={packages} />}
          <HideAction sessionId={id} hidden={hidden} />
          {session.calendar_only && <CalendarOnlyCard sessionId={id} />}
        </>
      );
    },
    // The Menu pickup and Ice pickup cards, as they were on Details.
    pickups: () => {
      const choices = staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name || s.phone, role: s.role }));
      return (
        <>
          <MenuPickupPanel initial={pickup} people={choices} menu={menuFile} today={todayIn(eventSchedule(edNow).tz, now)} />
          <IcePickupPanel initial={ice} people={choices} places={places} />
        </>
      );
    },
    // Agreements have pricing: admins and managers only (agreementsFor is null for anyone else).
    agreement: () => (agreements ? <AgreementCard sessionId={id} initial={agreements} /> : <p className="px-1 text-[15px] text-[#6B5D52]">Agreements could not load.</p>),
    team: () => {
      if (!panel) return null;
      if (hidden) return <p className="text-sm text-[#6B5D52] px-1">Market: {marketLabel(panel.market)}. Hidden events cannot be posted or staffed. Unhide it on Details.</p>;
      const onEvent = new Set(people.filter((p) => p.status !== "declined").map((p) => p.staffId));
      const available = staff
        .filter((s) => s.active && !onEvent.has(s.id))
        .map((s) => ({ id: s.id, name: s.name || s.phone, role: s.role, declined: people.some((p) => p.staffId === s.id), markets: s.markets, unavailable: away.has(s.id), record: records[s.id], cert: certs[s.id], distance: distances.get(s.id) }));
      const fix = bartendersFix(session);
      return (
        <>
          <BartendersNeeded
            sessionId={id}
            data={{
              value: bartendersNeeded(session),
              booked: bookedBartenders(session).count,
              setBy: fix?.by ?? "",
              setAt: fix ? chicagoStamp(fix.at, v.timeZone) : "",
              estimateNote: estimateNote(session),
              barbackLine: barback.applies ? barback.line : "",
              barbackMissing: barbackNeeded,
              log: staffingLog(session).slice(0, 10).map((e) => ({ at: chicagoStamp(e.at, v.timeZone), by: e.by, text: e.text })),
            }}
          />
          <DeliveryStrip people={delivery} />
          <AssignPanel
            sessionId={id}
            summary={`${staffingLabel(counts)}${counts.accepted ? `, ${counts.accepted} accepted` : ""}${counts.stillNeeded ? ` · ${counts.stillNeeded} still needed` : ""}`}
            covered={counts.needed !== null && counts.stillNeeded === 0}
            people={people}
            available={available}
            timeZone={v.timeZone}
            market={panel.market}
            showProgress={false}
            tiers={tiers}
          />
          {offers && <OffersPanel sessionId={id} data={offers} />}
          <ShiftPanel sessionId={id} panel={panel} handoffs={handoffs} marketSource={marketSource} timeZone={v.timeZone} records={records} certs={certs} tiers={tiers} />
        </>
      );
    },
    order: () => (
      <>
      <DeliveryStrip people={delivery} />
      <OrderSheet
        initial={sheet}
        timeZone={v.timeZone}
        costs={supplyCosts ? { cents: supplyCosts.cents, unmatched: supplyCosts.unmatched.length, byRef: Object.fromEntries(Object.entries(supplyCosts.byRef).map(([k, c]) => [k, c ? { cents: c.cents, unitCents: c.unitCents } : null])) } : null}
      />
      </>
    ),
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
        {rateCard && <RateTeamCard sessionId={id} card={rateCard} />}
        {lowStock.length > 0 && (
          <section className="space-y-2">
            <h2 className="px-1 font-heading text-base font-bold text-[#A0412D]">Running low</h2>
            <LowStockList initial={lowStock} showEvent={false} />
          </section>
        )}
        <section className="space-y-2">
          <h2 className="px-1 font-heading text-base font-bold text-[#2C2420]">Bar setup photos</h2>
          <BarReadyCard sessionId={id} canSubmit={false} isAdmin entries={bar} timeZone={v.timeZone} reminder={accepted.length > 0 && barPhotoMissing(edNow, now, photoCount) ? "Bar service has started and no bar setup photo is in yet." : undefined} />
        </section>
        <BartenderLists people={people} lists={lists} reports={missing} timeZone={v.timeZone} />
        <MissingReports reports={missing.filter((r) => !onList.has(r.staffId))} timeZone={v.timeZone} />
        <Closeouts sessionId={id} closeouts={closeouts} waiting={started ? waiting : []} timeZone={v.timeZone} />
        <TimePunches people={people} timeZone={v.timeZone} />
        {payout && <PayoutCard sessionId={id} title={[adminEventTitle(ed), v.date].filter(Boolean).join(", ")} rows={payout.rows} totals={payout.totals} tipNote={payout.tipNote} />}
      </>
    ),
    receipts: () =>
      receipts ? (
        <Receipts sessionId={id} mode="admin" initial={receipts.receipts} ready={receipts.ready} canApprove={receipts.canApprove} people={receipts.people} timeZone={v.timeZone} />
      ) : null,
    business: () => (business ? <BusinessTab view={business} billing={billing} /> : null),
    chat: () => <ManagerChat sessionId={id} initial={messages} unread={chatUnread} timeZone={v.timeZone} muted={muted.has(id)} isAdmin gifSearch={giphyEnabled()} />,
  };

  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <ManagerTabs
        tabs={managerTabsFor(me.role)}
        initialTab={tab}
        sessionId={id}
        header={header}
        panel={panels[tab]()}
        counts={{
          details: (session.price_pending ? 1 : 0) + (guestFlag ? 1 : 0),
          // The menu is not picked up (or nobody is assigned) inside 48 hours, no approved menu inside 72 hours, and the ice not done inside 24 hours.
          pickups: (pickup.outstanding ? 1 : 0) + (menuFile.missing ? 1 : 0) + (ice.outstanding ? 1 : 0),
          team: hidden ? 0 : counts.stillNeeded + handoffs.length + (barbackNeeded ? 1 : 0),
          // Changed lines, plus each "I'm out" from staff on a supply line until an admin changes its source or dismisses it.
          order: sheetFlags + (sheet.answers?.badge ?? 0),
          client: pendingHolds.length,
          dayof: dayofCount,
          receipts: receiptsWaiting,
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
