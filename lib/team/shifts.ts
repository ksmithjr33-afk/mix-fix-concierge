// Open shifts, shift requests, and shift handoffs: what a bartender may see
// about a posted shift, who may request or hand off, and every text. Pure, no
// database.
//
// A posted shift is built from an allowlist: date, arrival and service times,
// city, event type, guest count, package, and bartenders needed. Never the
// client's name, the event name, the street address, contact details, or
// pricing.

import { cityFrom } from "@/lib/team/event-list";
import { bartendersNeeded, firstName, scrub, type SessionLike, type StaffMember } from "@/lib/team/event-view";
import { eventData, marketLabel, staffMarketsOf, type Market } from "@/lib/team/markets";
import { eventDayStart, eventSchedule, formatClock, longDate, shortDate } from "@/lib/team/time";

export const SHORT_ALERT_DAYS = 5; // admins hear once when a posted shift is still short 5 days out
export const URGENT_HOURS = 48; // a handoff inside 48 hours of the event is marked URGENT
export const MIN_REASON = 3;

export type PostKind = "open" | "cover";
export type PostStatus = "posted" | "filled" | "unposted";
export type RequestStatus = "requested" | "withdrawn" | "approved" | "not_chosen" | "closed";
export type HandoffMode = "teammate" | "market";
export type HandoffStatus = "asked" | "teammate_accepted" | "open" | "approved" | "teammate_declined" | "admin_declined" | "cancelled";

export const ACTIVE_HANDOFF: HandoffStatus[] = ["asked", "teammate_accepted", "open"];

export interface PostRow {
  id: string;
  session_id: string;
  market: Market;
  kind: PostKind;
  handoff_id: string | null;
  status: PostStatus;
  posted_at: string;
}

export interface HandoffRow {
  id: string;
  session_id: string;
  from_staff_id: string;
  mode: HandoffMode;
  to_staff_id: string | null;
  reason: string;
  status: HandoffStatus;
  urgent: boolean;
  created_at: string;
}

/** What a bartender sees about a posted shift. */
export interface ShiftSummary {
  postId: string;
  sessionId: string;
  kind: PostKind;
  cover: boolean; // "Cover needed": someone is handing this shift off
  day: string | null;
  date: string; // "Saturday, December 12, 2026"
  shortDate: string; // "Sat, Dec 12"
  arrival: string;
  serviceStart: string;
  serviceEnd: string;
  city: string;
  market: string;
  eventType: string;
  guestCount: string;
  package: string;
  bartenders: number | null;
  spotsOpen: number;
  timeZone: string;
  window: { from: string | null; to: string | null }; // arrival to service end, ISO, for overlap checks
}

function guestCount(ed: Record<string, unknown>, session: SessionLike): string {
  const n = parseInt(String(ed.guest_count ?? session.guest_count ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

/** Arrival (or service start, or the start of the day) to service end (or the end of the day). */
export function workWindow(ed: Record<string, unknown>): { from: Date | null; to: Date | null } {
  const s = eventSchedule(ed);
  const dayStart = eventDayStart(ed);
  const from = s.arrival ?? s.start ?? dayStart;
  const to = s.end ?? (dayStart ? new Date(dayStart.getTime() + 24 * 3_600_000) : null);
  return { from, to };
}

export function shiftSummary(session: SessionLike, post: Pick<PostRow, "id" | "kind" | "market">, spotsOpen: number): ShiftSummary {
  const ed = eventData(session);
  const s = eventSchedule(ed);
  const w = workWindow(ed);
  return {
    postId: post.id,
    sessionId: session.id,
    kind: post.kind,
    cover: post.kind === "cover",
    day: s.day,
    date: longDate(s.day) || "Date to be confirmed",
    shortDate: shortDate(s.day),
    arrival: s.arrivalMin === null ? "" : formatClock(s.arrivalMin),
    serviceStart: s.startMin === null ? "" : formatClock(s.startMin),
    serviceEnd: s.endMin === null ? "" : formatClock(s.endMin),
    city: cityFrom(ed.event_address) || marketLabel(post.market),
    market: marketLabel(post.market),
    eventType: scrub(ed.event_type) || "Event",
    guestCount: guestCount(ed, session),
    package: scrub(ed.package) || scrub(session.package_type),
    bartenders: bartendersNeeded(session),
    spotsOpen,
    timeZone: s.tz,
    window: { from: w.from?.toISOString() ?? null, to: w.to?.toISOString() ?? null },
  };
}

/** True when two work windows overlap. */
export function overlaps(a: { from: string | null; to: string | null }, b: { from: string | null; to: string | null }): boolean {
  if (!a.from || !a.to || !b.from || !b.to) return false;
  return new Date(a.from).getTime() < new Date(b.to).getTime() && new Date(b.from).getTime() < new Date(a.to).getTime();
}

/** A bartender sees a posted shift only when it is posted to one of their markets. */
export function canSeePost(staff: StaffMember & { markets?: unknown }, post: Pick<PostRow, "market" | "status">): boolean {
  if (!staff.active || post.status !== "posted") return false;
  if (staff.role === "admin") return true;
  return staffMarketsOf(staff).includes(post.market);
}

/** Why an event cannot be posted, or null when it can. */
export function postError(o: { hidden: boolean; market: Market | null; spotsOpen: number; alreadyPosted: boolean; past: boolean }): string | null {
  if (o.hidden) return "This event is hidden. Unhide it before posting a shift.";
  if (o.past) return "This event is in the past.";
  if (!o.market) return "Set the event's market first.";
  if (o.alreadyPosted) return "This shift is already posted.";
  if (o.spotsOpen <= 0) return "This event has no open spots.";
  return null;
}

/** The shift is still short 5 days before the event, so admins get one text. */
export function shortAlertDue(ed: Record<string, unknown>, now: Date, spotsOpen: number): boolean {
  if (spotsOpen <= 0) return false;
  const start = eventSchedule(ed).start ?? eventDayStart(ed);
  if (!start) return false;
  const lead = start.getTime() - now.getTime();
  return lead > 0 && lead <= SHORT_ALERT_DAYS * 86_400_000;
}

/** A handoff inside 48 hours of the event (service start, or the start of the event day). */
export function isUrgent(ed: Record<string, unknown>, now: Date): boolean {
  const start = eventSchedule(ed).start ?? eventDayStart(ed);
  return !!start && start.getTime() - now.getTime() <= URGENT_HOURS * 3_600_000;
}

/** Whether a bartender may start a handoff for this event, or why not. */
export function handoffError(o: {
  status: string | null;
  hasPunches: boolean;
  activeHandoff: boolean;
  reason: string;
  mode: unknown;
  past: boolean;
}): string | null {
  if (o.status !== "accepted") return "Only an event you accepted can be given up.";
  if (o.hasPunches) return "You have clocked in for this event, so it cannot be given up. Text us at 469 754 8512.";
  if (o.past) return "This event is in the past.";
  if (o.activeHandoff) return "You already asked to give up this shift.";
  if (o.mode !== "teammate" && o.mode !== "market") return "Choose who should take it.";
  if (o.reason.trim().length < MIN_REASON) return "Give a reason.";
  return null;
}

/** A named teammate must be active, in the event's market, and not already on the event. */
export function teammateError(o: { teammate: (StaffMember & { markets?: unknown }) | null; market: Market | null; onEvent: boolean; self: boolean }): string | null {
  if (o.self) return "Choose someone else.";
  if (!o.teammate || !o.teammate.active) return "That person is not on the active team.";
  if (!o.market) return "This event has no market yet. Open it to the market or text us at 469 754 8512.";
  if (!staffMarketsOf(o.teammate).includes(o.market)) return `${firstName(o.teammate.name) || "They"} does not work the ${marketLabel(o.market)} market.`;
  if (o.onEvent) return `${firstName(o.teammate.name) || "They"} is already on this event.`;
  return null;
}

// ----- Texts -----

function times(s: Pick<ShiftSummary, "arrival" | "serviceStart" | "serviceEnd">): { arrive: string; service: string } {
  return {
    arrive: s.arrival || "time to be confirmed",
    service: s.serviceStart && s.serviceEnd ? `${s.serviceStart} to ${s.serviceEnd}` : s.serviceStart || "time to be confirmed",
  };
}

export function postText(s: ShiftSummary, link: string): string {
  const t = times(s);
  const lead = s.cover ? "Mix Fix shift, cover needed" : "New Mix Fix shift";
  return `${lead}: ${s.shortDate}, ${s.city}, arrive ${t.arrive}, service ${t.service}. Details and request: ${link}`;
}

export function gotShiftText(o: { date: string; link: string }): string {
  return `You got the shift on ${o.date}. Event page: ${o.link}`;
}

export function filledText(o: { date: string }): string {
  return `The Mix Fix shift on ${o.date} has been filled. Thanks for asking. No action needed.`;
}

export function noLongerNeededText(o: { date: string }): string {
  return `The Mix Fix shift on ${o.date} is no longer open. Thanks for asking. No action needed.`;
}

export function firstRequestText(o: { name: string; title: string; date: string; link: string }): string {
  return `${firstName(o.name) || "A bartender"} requested the open shift for ${o.title} on ${o.date}. Choose here: ${o.link}`;
}

export function shortShiftText(o: { title: string; date: string; short: number; requests: number; link: string }): string {
  return `${o.title} on ${o.date} is still short ${o.short} ${o.short === 1 ? "bartender" : "bartenders"}, ${o.requests} ${o.requests === 1 ? "request" : "requests"} so far. ${o.link}`;
}

export function handoffAskText(o: { teammate: string; from: string; date: string; arrival: string; link: string }): string {
  return `Hi ${firstName(o.teammate) || "there"}, ${firstName(o.from) || "a teammate"} asked you to take their Mix Fix shift on ${o.date}, arrive ${o.arrival || "time to be confirmed"}. Accept or decline: ${o.link}`;
}

export function handoffAdminText(o: { urgent: boolean; mode: HandoffMode; from: string; teammate?: string; title: string; date: string; reason: string; link: string }): string {
  const head = o.urgent ? "URGENT: " : "";
  const what =
    o.mode === "teammate"
      ? `${firstName(o.teammate) || "A teammate"} agreed to take ${firstName(o.from) || "a bartender"}'s shift for ${o.title} on ${o.date}. Approve or decline`
      : `${firstName(o.from) || "A bartender"} wants to give up ${o.title} on ${o.date}. It is open to the market for requests. Choose a replacement`;
  return `${head}${what}: ${o.link} Reason: "${o.reason}"`;
}

export function teammateDeclinedText(o: { from: string; teammate: string; date: string }): string {
  return `Hi ${firstName(o.from) || "there"}, ${firstName(o.teammate) || "your teammate"} can't take your Mix Fix shift on ${o.date}. You are still on the shift.`;
}

export function releasedText(o: { from: string; date: string }): string {
  return `Hi ${firstName(o.from) || "there"}, your handoff was approved. You are released from the Mix Fix shift on ${o.date}.`;
}

export function stillOnShiftText(o: { from: string; date: string }): string {
  return `Hi ${firstName(o.from) || "there"}, your request to give up the Mix Fix shift on ${o.date} was not approved. You are still on the shift.`;
}

export function handoffCancelledText(o: { teammate: string; from: string; date: string }): string {
  return `Hi ${firstName(o.teammate) || "there"}, ${firstName(o.from) || "your teammate"} no longer needs you to take the Mix Fix shift on ${o.date}. No action needed.`;
}
