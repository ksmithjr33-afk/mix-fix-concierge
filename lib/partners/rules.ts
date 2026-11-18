// Partner portal rules. Pure, no database, so the tests can check them.
//
// Partners are outside people (planners now, venues in phase 2). Every event
// has one booking holder, "client" (the default, every existing event) or
// "planner", an optional host, any number of planners with one Lead, and three
// pricing switches. Who sees money and who approves a price change is decided
// here, and every page and route asks these functions on the server.

export const PARTNER_TYPES = ["planner", "venue"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export type BookingHolder = "client" | "planner";
export type LinkedVia = "booked" | "staff" | "client" | "lead";

export const PARTNER_COOKIE = "mf_partner";
export const APPROVAL_HOURS = 72; // a price change nobody answers in 72 hours is not applied

export interface Partner {
  id: string;
  type: PartnerType;
  name: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  markets: string[];
  active: boolean;
  internal_notes?: string;
  last_sign_in_at?: string | null;
  created_at?: string;
}

export interface PlannerLink {
  id: string;
  session_id: string;
  partner_id: string;
  is_lead: boolean;
  linked_via: LinkedVia;
  linked_by_name: string;
  linked_at: string;
  removed_at: string | null;
  removed_by_name?: string | null;
}

/** The booking columns on a sessions row. Every one is missing before the migration, which reads as a client held event. */
export interface BookingColumns {
  booking_holder?: string | null;
  booking_holder_set_by?: string | null;
  booking_holder_set_at?: string | null;
  host_name?: string | null;
  host_phone?: string | null;
  host_email?: string | null;
  planner_label?: string | null;
  partner_key?: string | null;
  planner_can_see_pricing?: boolean | null;
  others_can_see_pricing?: boolean | null;
  host_can_see_pricing?: boolean | null;
  planner_asked?: boolean | null;
}

export interface Booking {
  holder: BookingHolder;
  setBy: string;
  setAt: string | null;
  host: { name: string; phone: string; email: string } | null;
  plannerLabel: string;
  key: string | null;
  plannerCanSeePricing: boolean;
  othersCanSeePricing: boolean;
  hostCanSeePricing: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function bookingOf(s: BookingColumns): Booking {
  const hostName = str(s.host_name);
  return {
    holder: s.booking_holder === "planner" ? "planner" : "client",
    setBy: str(s.booking_holder_set_by),
    setAt: s.booking_holder_set_at ?? null,
    host: hostName ? { name: hostName, phone: str(s.host_phone), email: str(s.host_email) } : null,
    plannerLabel: str(s.planner_label),
    key: str(s.partner_key) || null,
    plannerCanSeePricing: s.planner_can_see_pricing === true,
    othersCanSeePricing: s.others_can_see_pricing === true,
    hostCanSeePricing: s.host_can_see_pricing === true,
  };
}

/** Who is looking at an event from the partner side. */
export type EventViewer = { kind: "planner"; partnerId: string; isLead: boolean; name: string } | { kind: "host"; name: string };

export interface MoneyAccess {
  total: boolean; // the booked total
  balance: boolean; // the remaining balance
  payments: boolean; // each payment
  agreement: boolean; // the signed agreement
  approve: boolean; // may accept a price change, and gets payment and balance reminders
}

const NONE: MoneyAccess = { total: false, balance: false, payments: false, agreement: false, approve: false };

/**
 * What money this viewer sees on this event.
 * Planner held: the Lead sees everything and approves; other planners see the
 * total, payments and balance only when the Lead turned on "Other planners can
 * see pricing", and never approve.
 * Client held: planners see nothing unless "Planner can see pricing" is on,
 * and then only the total and the remaining balance. They never approve.
 * A host sees nothing unless the Lead turned on "Host can see pricing", and
 * then only the total and the remaining balance.
 */
export function moneyAccess(b: Booking, v: EventViewer): MoneyAccess {
  if (v.kind === "host") return b.hostCanSeePricing ? { ...NONE, total: true, balance: true } : NONE;
  if (b.holder === "planner") {
    if (v.isLead) return { total: true, balance: true, payments: true, agreement: true, approve: true };
    return b.othersCanSeePricing ? { ...NONE, total: true, balance: true, payments: true } : NONE;
  }
  return b.plannerCanSeePricing ? { ...NONE, total: true, balance: true } : NONE;
}

/** True when this planner holds the booking: the Lead on a planner held event. */
export function holdsBooking(b: Booking, v: EventViewer): boolean {
  return v.kind === "planner" && b.holder === "planner" && v.isLead;
}

/** The person the event is for: the host when one is named, otherwise the client (on a client held event) or the booking contact. */
export function eventForName(b: Booking, clientName: unknown): string {
  return b.host?.name || str(clientName);
}

// ----- Planning status in plain words -----

export type PlanningStatus = "Not started" | "In progress" | "Planned" | "Menu approved";

export function planningStatus(o: { status: string | null | undefined; hasAnswers: boolean; menuApproved: boolean }): PlanningStatus {
  if (o.status === "submitted") return o.menuApproved ? "Menu approved" : "Planned";
  return o.hasAnswers ? "In progress" : "Not started";
}

// ----- Who may do what -----

/** Add another planner: the client (client held), the Lead (planner held), or an admin or manager. */
export function canAddPlanner(b: Booking, actor: "client" | "staff" | EventViewer): boolean {
  if (actor === "staff") return true;
  if (actor === "client") return b.holder === "client";
  return actor.kind === "planner" && b.holder === "planner" && actor.isLead;
}

/**
 * Remove a planner: admins and managers any planner; the client any planner on
 * a client held event; the Lead any other planner on a planner held event.
 * Only an admin or manager removes or changes the Lead on a planner held event.
 */
export function canRemovePlanner(b: Booking, actor: "client" | "staff" | EventViewer, target: { partnerId: string; isLead: boolean }): boolean {
  if (actor === "staff") return true;
  if (actor === "client") return b.holder === "client";
  if (actor.kind !== "planner" || b.holder !== "planner" || !actor.isLead) return false;
  return !target.isLead && target.partnerId !== actor.partnerId;
}

/** The pricing switches: who may flip which. */
export type PricingSwitch = "planner_can_see_pricing" | "others_can_see_pricing" | "host_can_see_pricing";

export function canSetSwitch(b: Booking, actor: "client" | "admin" | "manager" | EventViewer, sw: PricingSwitch): boolean {
  if (sw === "planner_can_see_pricing") return b.holder === "client" && (actor === "client" || actor === "admin");
  // "Other planners can see pricing" and "Host can see pricing" belong to the Lead.
  return typeof actor === "object" && actor.kind === "planner" && actor.isLead && b.holder === "planner";
}

// ----- Texts (no hyphens anywhere, and never another event's details) -----

export const firstWord = (v: unknown) => str(v).split(" ")[0] ?? "";

/** "Pat from Bloom Events", or "Pat" with no company. */
export function plannerWho(p: Pick<Partner, "name" | "company">): string {
  const name = str(p.name) || "Your planner";
  return str(p.company) ? `${name} from ${str(p.company)}` : name;
}

/** Item 10: the client hears when staff link a planner to their event, with a one tap remove link. */
export function clientPlannerAddedText(p: Pick<Partner, "name" | "company">, removeLink: string): string {
  return `${plannerWho(p)} now has access to your bar planning with The Mix Fix. If that is not right, tap here to remove them. ${removeLink}`;
}

/** Item 11: every newly linked planner. */
export function plannerWelcomeText(o: { name: string; eventFor: string; eventType: string; signInLink: string }): string {
  const hi = firstWord(o.name) ? `Hi ${firstWord(o.name)}, ` : "Hi, ";
  const what = [o.eventFor ? `${firstWord(o.eventFor)}'s` : "", o.eventType || "event"].filter(Boolean).join(" ");
  return `${hi}you now have access to the bar planning for ${what} with The Mix Fix. Sign in with your phone number here: ${o.signInLink}`;
}

export function hostWelcomeText(o: { hostName: string; eventType: string; signInLink: string }): string {
  const hi = firstWord(o.hostName) ? `Hi ${firstWord(o.hostName)}, ` : "Hi, ";
  return `${hi}you can now view your ${o.eventType || "event"} bar plans with The Mix Fix. Sign in with your phone number here: ${o.signInLink}`;
}

/** Item 18: what a planner who does not hold the booking is told. */
export function sentForApprovalLine(holderFirstName: string): string {
  return `This change affects the price. We sent it to ${holderFirstName || "the booking holder"} to approve.`;
}

/** The booking holder's text about a price change waiting for them. */
export function approvalAskText(o: { askedBy: string; summary: string; priceText: string; link: string }): string {
  const summary = o.summary.length > 240 ? `${o.summary.slice(0, 237).trimEnd()}...` : o.summary;
  return `${firstWord(o.askedBy) || "Your planner"} asked for a change to your bar plans that affects the price: ${summary}. ${o.priceText} Nothing changes unless you approve. Approve or decline: ${o.link}`;
}

/** Item 21: the client (client held) or the Lead (planner held) hears when a planner submits or changes the planning. */
export function planningNoticeText(o: { who: string; submitted: boolean; summary: string; link: string }): string {
  const summary = o.summary.length > 240 ? `${o.summary.slice(0, 237).trimEnd()}...` : o.summary;
  const did = o.submitted ? "finished the bar planning" : `made a change to the bar planning${summary ? `: ${summary}` : ""}`;
  return `${firstWord(o.who) || "Your planner"} ${did}. Review it here: ${o.link}`;
}

export function leadRemovedAdminText(o: { title: string; date: string; link: string }): string {
  return `The Lead planner was removed from ${o.title} on ${o.date}. Pick a new Lead: ${o.link}`;
}

export function deactivatedAdminText(o: { partner: string; events: { title: string; date: string; role: string }[]; link: string }): string {
  const list = o.events.slice(0, 5).map((e) => `${e.title} on ${e.date} (${e.role})`).join("; ");
  const more = o.events.length > 5 ? ` and ${o.events.length - 5} more` : "";
  return `${o.partner} was deactivated and no longer has access. Events they held or led: ${list}${more}. Check each one: ${o.link}`;
}

export const LINKED_VIA_LABEL: Record<LinkedVia, string> = {
  booked: "Booked it",
  staff: "Added by our team",
  client: "Added by the client",
  lead: "Added by the Lead",
};

/** A partner name, company, email, or website from a form, trimmed to its column limit. */
export function cleanField(v: unknown, max: number): string {
  return str(v).slice(0, max);
}

export function cleanEmail(v: unknown): string {
  const s = str(v).toLowerCase().slice(0, 200);
  return !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

export function cleanWebsite(v: unknown): string {
  const s = str(v).slice(0, 300);
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
