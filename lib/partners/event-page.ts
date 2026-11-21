// What a planner or host sees, built on the server from what they may see and
// nothing more (items 13 to 19). Never in here: staff pay, internal notes, the
// team chat, the Scorecard, receipts, staff phone numbers or last names, the
// client's link id, or a removed planner's name. Money only as moneyAccess
// allows. Server only.

import { supabase } from "@/lib/supabase";
import { computeDeadlines } from "@/lib/event-diff";
import { buildStaffEventView, firstName, type StaffEventView } from "@/lib/team/event-view";
import { eventData, eventTimeZone } from "@/lib/team/markets";
import { eventSchedule, formatClock, longDate, todayIn } from "@/lib/team/time";
import { cityFrom } from "@/lib/team/event-list";
import { packageShortFor } from "@/lib/packages-info";
import { bookingShortOf } from "@/lib/package-extras";
import { clientList } from "@/lib/client-list";
import { currentMenu, clientMenuLink } from "@/lib/team/approved-menu-db";
import { venuePhotosFor, type VenuePhoto } from "@/lib/team/venue-photos-db";
import { typeLabel } from "@/lib/team/approved-menu";
import { eventPayments } from "@/lib/team/business-db";
import { shortLink } from "@/lib/team/direct-upload";
import { AGREEMENT_BUCKET, AGREEMENT_LINK_SECONDS, type AgreementRow } from "@/lib/team/agreements";
import { hideMoney, type TaggedMessage } from "@/lib/partners/chat";
import { UPDATE_OPENER } from "@/lib/update-mode-shared";
import { approvalsFor, type ApprovalRow } from "@/lib/partners/approvals";
import { billingLines, bookingOf, eventForName, holdsBooking, moneyAccess, planningStatus, type EventViewer, type MoneyAccess, type PlanningStatus } from "@/lib/partners/rules";
import { clientPhone, eventsFor, plannersOn, surpriseOn, type EventAccess } from "@/lib/partners/db";
import type { Principal } from "@/lib/partners/auth";

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" ? String(v) : "");
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ----- Dashboard -----

export interface DashboardRow {
  key: string;
  eventFor: string;
  eventType: string;
  date: string;
  day: string | null;
  city: string;
  package: string;
  holdsBooking: boolean;
  status: PlanningStatus;
  past: boolean;
}

async function hasAnswers(sessionId: string): Promise<boolean> {
  const { data } = await supabase.from("conversation_logs").select("messages").eq("session_id", sessionId).maybeSingle();
  const msgs = (data as { messages?: unknown[] } | null)?.messages;
  // The booking context and the opening hello are not answers: anything past the first reply is.
  return Array.isArray(msgs) && msgs.filter((m) => (m as { role?: string }).role === "user").length > 2;
}

/** Item 13: every linked event, upcoming first (soonest first), then past (most recent first). */
export async function dashboardRows(principal: Principal, now: Date = new Date()): Promise<DashboardRow[]> {
  const events = await eventsFor(principal);
  const rows: DashboardRow[] = [];
  for (const { session: s, isLead } of events) {
    if (!s.partner_key) continue;
    const ed = eventData(s);
    const b = bookingOf(s);
    const day = eventSchedule(ed).day;
    const menu = s.status === "submitted" ? !!(await currentMenu(s.id)) : false;
    rows.push({
      key: s.partner_key,
      eventFor: eventForName(b, ed.client_name),
      eventType: str(ed.event_type) || "Event",
      date: longDate(day),
      day,
      city: cityFrom(ed.event_address),
      package: str(ed.package) || str(s.package_type),
      holdsBooking: principal.kind === "partner" && b.holder === "planner" && isLead,
      status: planningStatus({ status: s.status, hasAnswers: s.status === "submitted" ? true : await hasAnswers(s.id), menuApproved: menu }),
      past: !!day && day < todayIn(eventTimeZone(s), now),
    });
  }
  const upcoming = rows.filter((r) => !r.past).sort((a, b) => String(a.day ?? "9999").localeCompare(String(b.day ?? "9999")));
  const past = rows.filter((r) => r.past).sort((a, b) => String(b.day).localeCompare(String(a.day)));
  return [...upcoming, ...past];
}

// ----- One event -----

export interface PartnerEventView {
  key: string;
  viewer: EventViewer;
  readOnly: boolean; // hosts
  holdsBooking: boolean;
  holder: "client" | "planner";
  eventFor: { name: string; phone: string; email: string };
  eventType: string;
  eventName: string;
  date: string;
  serviceTimes: string;
  arrival: string;
  breakdown: string;
  venueType: string;
  address: string;
  mapsUrl: string | null;
  package: string;
  packageLine: string; // the short package section: one line, at most five bullets, what the client provides
  packageBullets: string[];
  packageProvides: string;
  guestCount: string;
  drinks: StaffEventView["drinks"];
  setMenu: boolean;
  menuCard: boolean; // Dive Bar: the drinks are the classics on the menu card
  menu: { typeLabel: string; isPdf: boolean } | null;
  shoppingList: ReturnType<typeof clientList> | null;
  photos: { url: string; caption: string }[];
  dayOfContact: { name: string; phone: string };
  deadlines: { lastDrinkChange: string; withinSixDays: boolean; daysUntil: number | null };
  planners: { id: string; name: string; company: string; isLead: boolean; you: boolean }[];
  bartenders: string[]; // first names, accepted only
  stillNeeded: string[];
  status: PlanningStatus;
  submitted: boolean;
  money: MoneyAccess;
  pricing: { total: string; balance: string; payments: { amount: string; on: string }[]; agreements: { id: string; label: string; typeLabel: string }[] } | null;
  switches: { others: boolean; host: boolean; planner: boolean };
  approvals: { id: string; summary: string; priceText: string; askedBy: string; status: ApprovalRow["status"]; createdAt: string }[];
  hostOnEvent: boolean;
  billing: { billedTo: string; eventFor: string } | null; // planner held: the Lead is billed, the host is who it is for
  surprise: boolean; // planners see the "Surprise event" label
}

function stillNeeded(ed: Record<string, unknown>, submitted: boolean, drinkCount: number, needsDrinks: boolean): string[] {
  const out: string[] = [];
  if (!submitted) out.push("Finish the planning chat");
  if (!str(ed.bar_service_start)) out.push("Bar service start time");
  if (!str(ed.event_address)) out.push("Event address");
  if (!str(ed.day_of_contact_name) || !str(ed.day_of_contact_phone)) out.push("Day of contact name and phone");
  if (!str(ed.parking_info)) out.push("Parking details for our team");
  if (needsDrinks && submitted && drinkCount === 0) out.push("Signature drinks");
  return out;
}

async function acceptedBartenders(sessionId: string): Promise<string[]> {
  const { data, error } = await supabase.from("event_assignments").select("staff_id, status").eq("session_id", sessionId).eq("status", "accepted");
  if (error || !data || data.length === 0) return [];
  const ids = (data as { staff_id: string }[]).map((a) => a.staff_id);
  const { data: staff } = await supabase.from("staff").select("id, name").in("id", ids);
  // First names only: never a phone number or a last name.
  return ((staff as { name: string }[] | null) ?? []).map((s) => firstName(s.name)).filter(Boolean);
}

/** Payments come from the Business module, the only place that reads them. */
async function paymentsCents(sessionId: string): Promise<{ amount_cents: number; paid_on: string | null }[]> {
  return (await eventPayments(sessionId).catch(() => [])).map((p) => ({ amount_cents: p.cents, paid_on: p.paidOn }));
}

async function currentAgreements(sessionId: string): Promise<AgreementRow[]> {
  const { data, error } = await supabase.from("event_agreements").select("*").eq("session_id", sessionId).eq("status", "current");
  return error || !data ? [] : (data as AgreementRow[]);
}

export async function partnerEventView(a: EventAccess, now: Date = new Date()): Promise<PartnerEventView> {
  const s = a.session;
  const ed = eventData(s);
  const sched = eventSchedule(ed);
  const v = buildStaffEventView(s, { now });
  const money = moneyAccess(a.booking, a.viewer);
  const submitted = s.status === "submitted" && !!s.event_data;
  const [planners, bartenders, menuRow, approvals] = await Promise.all([
    plannersOn(s.id), // live links only: a removed planner's name never shows
    acceptedBartenders(s.id),
    submitted ? currentMenu(s.id) : Promise.resolve(null),
    a.viewer.kind === "planner" && holdsBooking(a.booking, a.viewer) ? approvalsFor(s.id, now) : Promise.resolve([] as ApprovalRow[]),
  ]);
  const photosView = submitted ? await venuePhotosFor(s, { id: "partner", role: "bartender", active: true }, { status: "accepted" }).catch(() => null) : null;
  const photos = [...(photosView?.own ?? []), ...(photosView?.past ?? [])].filter((p: VenuePhoto) => p.url).map((p) => ({ url: p.url!, caption: p.caption }));
  const short = packageShortFor(v.package, bookingShortOf(s));
  const deadlines = computeDeadlines(ed.event_date ?? s.event_date, now, eventTimeZone(s));
  const host = a.booking.host;
  const eventFor = host
    ? { name: host.name, phone: host.phone, email: host.email }
    : { name: str(ed.client_name) || str(s.name), phone: clientPhone(s), email: str(ed.email) || str(ed.client_email) || str(s.email) };

  let pricing: PartnerEventView["pricing"] = null;
  if (money.total || money.balance) {
    const total = Number(s.booked_price?.total ?? NaN);
    const pays = money.payments || money.balance ? await paymentsCents(s.id) : [];
    // Only recorded payments: never guessed from the deposit. With none recorded there is no balance to show.
    const paid = pays.reduce((n, p) => n + p.amount_cents, 0) / 100;
    pricing = {
      total: money.total && Number.isFinite(total) ? dollars(total) : "",
      balance: money.balance && Number.isFinite(total) && pays.length > 0 ? dollars(Math.max(0, total - paid)) : "",
      payments: money.payments ? pays.map((p) => ({ amount: dollars(p.amount_cents / 100), on: longDate(p.paid_on) })) : [],
      agreements: money.agreement ? (await currentAgreements(s.id)).map((r) => ({ id: r.id, label: r.label || "Agreement", typeLabel: typeLabel(r.file_type) })) : [],
    };
  }

  const drinksAllowed = !/beer\s*(and|&)\s*wine|dive/i.test(v.package);
  const isLead = a.viewer.kind === "planner" && a.viewer.isLead;
  return {
    key: a.session.partner_key ?? "",
    viewer: a.viewer,
    readOnly: a.viewer.kind === "host",
    holdsBooking: holdsBooking(a.booking, a.viewer),
    holder: a.booking.holder,
    eventFor,
    eventType: v.eventType,
    eventName: v.eventName,
    date: v.date,
    serviceTimes: v.serviceStart && v.serviceEnd ? `${v.serviceStart} to ${v.serviceEnd}` : v.serviceStart,
    arrival: v.arrival,
    breakdown: sched.endMin !== null ? formatClock(sched.endMin + 60) : "",
    venueType: v.venueType,
    address: v.address,
    mapsUrl: v.mapsUrl,
    package: v.package,
    packageLine: short ? short.line : "",
    packageBullets: short ? short.bullets : [],
    packageProvides: short ? short.provides : "",
    guestCount: v.guestCount,
    drinks: v.drinks,
    setMenu: v.setMenu,
    menuCard: v.menuCard,
    menu: menuRow ? { typeLabel: typeLabel(menuRow.file_type), isPdf: menuRow.file_type === "application/pdf" } : null,
    shoppingList: submitted ? clientList(s.event_data ?? {}) : null,
    photos,
    dayOfContact: { name: str(ed.day_of_contact_name), phone: str(ed.day_of_contact_phone) },
    deadlines: { lastDrinkChange: longDate(deadlines.lastDrinkChangeDay), withinSixDays: deadlines.withinSixDays, daysUntil: deadlines.daysUntil },
    planners: planners.map((p) => ({ id: p.partner.id, name: p.partner.name || "Planner", company: p.partner.company, isLead: p.isLead, you: a.viewer.kind === "planner" && p.partner.id === a.viewer.partnerId })),
    bartenders,
    stillNeeded: stillNeeded(ed, submitted, v.drinks.length, drinksAllowed),
    status: planningStatus({ status: s.status, hasAnswers: submitted || (await hasAnswers(s.id)), menuApproved: !!menuRow }),
    submitted,
    money,
    pricing,
    switches: {
      others: isLead && a.booking.holder === "planner" ? a.booking.othersCanSeePricing : false,
      host: isLead && a.booking.holder === "planner" ? a.booking.hostCanSeePricing : false,
      planner: a.booking.plannerCanSeePricing,
    },
    approvals: approvals.map((x) => ({ id: x.id, summary: x.summary, priceText: x.price_text, askedBy: x.asked_by_name, status: x.status, createdAt: x.created_at })),
    hostOnEvent: !!host,
    billing: a.viewer.kind === "planner" ? billingLines(a.booking, planners.find((p) => p.isLead)?.partner ?? null) : null,
    surprise: a.viewer.kind === "planner" && surpriseOn(s, now),
  };
}

/** The approved menu file for a partner: a 10 minute signed link, after the access check. */
export async function partnerMenuLink(a: EventAccess, download: boolean): Promise<string | null> {
  return clientMenuLink(a.session.id, download);
}

/** An agreement file for the Lead on a planner held event only. */
export async function partnerAgreementLink(a: EventAccess, fileId: string, download: boolean): Promise<string | null> {
  if (!moneyAccess(a.booking, a.viewer).agreement) return null;
  const row = (await currentAgreements(a.session.id)).find((r) => r.id === fileId);
  if (!row) return null;
  return shortLink(AGREEMENT_BUCKET, row.file_path, AGREEMENT_LINK_SECONDS, download ? row.file_name || "Agreement" : undefined);
}

// ----- Chats -----

/** The intake transcript for a planner, money hidden unless they see it. */
export async function intakeMessages(sessionId: string): Promise<TaggedMessage[]> {
  const { data } = await supabase.from("conversation_logs").select("messages").eq("session_id", sessionId).maybeSingle();
  const msgs = (data as { messages?: TaggedMessage[] } | null)?.messages;
  return Array.isArray(msgs) ? msgs : [];
}

export async function partnerChatMessages(sessionId: string, partnerId: string): Promise<TaggedMessage[]> {
  const { data, error } = await supabase.from("partner_chats").select("messages").eq("session_id", sessionId).eq("partner_id", partnerId).maybeSingle();
  if (error) return [];
  const msgs = (data as { messages?: TaggedMessage[] } | null)?.messages;
  return Array.isArray(msgs) ? msgs : [];
}

export async function savePartnerChat(sessionId: string, partnerId: string, all: TaggedMessage[]): Promise<void> {
  // The hidden update mode opener is added back on every turn, never stored.
  const messages = all[0]?.content === UPDATE_OPENER ? all.slice(1) : all;
  const { error } = await supabase
    .from("partner_chats")
    .upsert({ session_id: sessionId, partner_id: partnerId, messages, updated_at: new Date().toISOString() }, { onConflict: "session_id,partner_id" });
  if (error) console.error(`[partners] chat save for ${sessionId} failed:`, error.message);
}

/**
 * What the page shows: the hidden booking context left out, money hidden when
 * the viewer does not see it, and each answer labeled You, Client, or a planner
 * still on the event. A removed planner's answers read "A planner", never their name.
 */
export function visibleMessages(
  msgs: TaggedMessage[],
  money: MoneyAccess,
  me: string | null,
  livePlanners: Map<string, string>
): { role: string; content: string; menus?: unknown; byName?: string }[] {
  const label = (m: TaggedMessage) => {
    if (m.by?.kind !== "planner") return "Client";
    if (m.by.partnerId && m.by.partnerId === me) return "You";
    return (m.by.partnerId && livePlanners.get(m.by.partnerId)) || "A planner";
  };
  return msgs
    .filter((m) => !(m.role === "user" && (m.content.startsWith("CONTEXT") || m.content === OPENER_MARK)))
    .map((m) => ({ role: m.role, content: money.total ? m.content : hideMoney(m.content), menus: m.menus, byName: m.role === "user" ? label(m) : undefined }));
}

export const OPENER_MARK = "[update mode opened by a planner]";
