// Ranked shift offers: the rules. Pure, no database.
//
// An event's open spots are offered to people one at a time, in an order an
// admin set: by group, then by place in the group, with a head start between
// places. Taking an offer is a request: it holds one spot until an admin or
// manager approves it (they are on the event) or passes (the spot opens and
// offers carry on). Nobody is placed from an offer without approval. When a group's window ends with
// the spot still open, the next group starts the same way. While two or more
// spots are open, the first two groups go out together from the start.
//
// Only daytime counts toward the head start and the window: 9:00 AM to 8:00
// PM in the event's market. Offers only go out in daytime, so quiet hours
// (9:00 PM to 8:00 AM) are always respected.
//
// PRIVACY: staff never see a group, a place, the order, or who was offered
// before them. Nothing a staff member sees or receives (offerText and the
// other texts here, the offer page) says anything about order. A decline or
// no response is recorded for admins and never changes anyone's place.

import { addDays } from "@/lib/team/availability";
import { todayIn, zonedInstant } from "@/lib/team/time";
import { MARKETS, type Market } from "@/lib/team/markets";

export const SETTINGS_KEY = "ranked_offers";
export const DAY_START_HOUR = 9; // daytime starts 9:00 AM
export const DAY_END_HOUR = 20; // and ends 8:00 PM, in the event's market
export const NOBODY_ALERT_DAYS = 5; // admins and managers hear once when a spot is still open 5 days out

export const MODES = ["off", "suggest", "automatic"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_LABEL: Record<Mode, string> = { off: "Off", suggest: "Suggest", automatic: "Automatic" };

export interface Reviewed {
  by: string; // name
  at: string; // ISO
}

export interface OfferSettings {
  headStartMin: number; // daytime minutes between places
  windowMin: number; // daytime minutes per group
  holdOverGuests: number; // over this many guests is noted on the request
  startDaysBefore: number; // Automatic starts offers this many days before the event
  modes: Record<Market, Mode>;
  reviewed: Partial<Record<Market, Reviewed>>; // "Order reviewed", needed before Automatic
}

export const OFFER_DEFAULTS: OfferSettings = {
  headStartMin: 30,
  windowMin: 180,
  holdOverGuests: 150,
  startDaysBefore: 30,
  modes: Object.fromEntries(MARKETS.map((m) => [m, "suggest"])) as Record<Market, Mode>,
  reviewed: {},
};

const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const isMode = (v: unknown): v is Mode => typeof v === "string" && (MODES as readonly string[]).includes(v);

/** Settings as saved, with defaults for anything missing or broken. Automatic without "Order reviewed" reads as Suggest. */
export function readOfferSettings(v: unknown): OfferSettings {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const reviewedRaw = o.reviewed && typeof o.reviewed === "object" ? (o.reviewed as Record<string, unknown>) : {};
  const reviewed: Partial<Record<Market, Reviewed>> = {};
  for (const m of MARKETS) {
    const r = reviewedRaw[m] as Record<string, unknown> | undefined;
    if (r && typeof r.by === "string" && typeof r.at === "string") reviewed[m] = { by: r.by, at: r.at };
  }
  const modesRaw = o.modes && typeof o.modes === "object" ? (o.modes as Record<string, unknown>) : {};
  const modes = Object.fromEntries(
    MARKETS.map((m) => {
      const mode = isMode(modesRaw[m]) ? modesRaw[m] : "suggest";
      return [m, mode === "automatic" && !reviewed[m] ? "suggest" : mode];
    })
  ) as Record<Market, Mode>;
  return {
    headStartMin: int(o.headStartMin, 0, 600) ?? OFFER_DEFAULTS.headStartMin,
    windowMin: int(o.windowMin, 15, 1440) ?? OFFER_DEFAULTS.windowMin,
    holdOverGuests: int(o.holdOverGuests, 1, 5000) ?? OFFER_DEFAULTS.holdOverGuests,
    startDaysBefore: int(o.startDaysBefore, 1, 365) ?? OFFER_DEFAULTS.startDaysBefore,
    modes,
    reviewed,
  };
}

/**
 * The settings form, checked against what is saved. A market can only be
 * switched to Automatic once an admin tapped "Order reviewed" for it.
 */
export function validateOfferSettings(raw: Record<string, unknown>, current: OfferSettings): { ok: true; value: OfferSettings } | { ok: false; error: string } {
  const headStartMin = int(raw.headStartMin, 0, 600);
  if (headStartMin === null) return { ok: false, error: "Head start: 0 to 600 daytime minutes." };
  const windowMin = int(raw.windowMin, 15, 1440);
  if (windowMin === null) return { ok: false, error: "Window per tier: 15 to 1440 daytime minutes." };
  const startDaysBefore = int(raw.startDaysBefore, 1, 365);
  if (startDaysBefore === null) return { ok: false, error: "Start offers: 1 to 365 days before the event." };
  const modesRaw = raw.modes && typeof raw.modes === "object" ? (raw.modes as Record<string, unknown>) : {};
  const modes = { ...current.modes };
  for (const m of MARKETS) {
    if (modesRaw[m] === undefined) continue;
    if (!isMode(modesRaw[m])) return { ok: false, error: "Pick Off, Suggest or Automatic." };
    if (modesRaw[m] === "automatic" && !current.reviewed[m]) return { ok: false, error: `Review the ${MARKET_NAMES[m]} order and tap "Order reviewed" before switching it to Automatic.` };
    modes[m] = modesRaw[m] as Mode;
  }
  return { ok: true, value: { ...current, headStartMin, windowMin, startDaysBefore, modes } };
}

const MARKET_NAMES: Record<Market, string> = { dallas: "Dallas", austin: "Austin", houston: "Houston", los_angeles: "Los Angeles" };

// ----- The daytime clock -----

function localMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

const START = DAY_START_HOUR * 60;
const END = DAY_END_HOUR * 60;

/** 9:00 AM up to (not including) 8:00 PM in the market's time zone. */
export function inDaytime(at: Date, tz: string): boolean {
  const m = localMinutes(at, tz);
  return m >= START && m < END;
}

/** `at` when it is daytime, otherwise the next 9:00 AM in the market. */
export function nextDaytime(at: Date, tz: string): Date {
  const m = localMinutes(at, tz);
  const day = todayIn(tz, at);
  if (m < START) return zonedInstant(day, START, tz);
  if (m >= END) return zonedInstant(addDays(day, 1), START, tz);
  return at;
}

/** `minutes` of daytime after `at`. Evenings, nights and early mornings do not count. */
export function addDaytime(at: Date, minutes: number, tz: string): Date {
  let t = nextDaytime(at, tz);
  let left = Math.max(0, minutes) * 60_000;
  for (let i = 0; i < 800; i++) {
    const day = todayIn(tz, t);
    const end = zonedInstant(day, END, tz).getTime();
    const room = end - t.getTime();
    if (left < room) return new Date(t.getTime() + left);
    left -= room;
    t = zonedInstant(addDays(day, 1), START, tz);
  }
  return t;
}

/** Daytime minutes between two instants (0 when b is before a). */
export function daytimeBetween(a: Date, b: Date, tz: string): number {
  if (b <= a) return 0;
  let total = 0;
  let t = nextDaytime(a, tz);
  for (let i = 0; i < 800 && t < b; i++) {
    const day = todayIn(tz, t);
    const end = new Date(Math.min(zonedInstant(day, END, tz).getTime(), b.getTime()));
    if (end > t) total += end.getTime() - t.getTime();
    t = zonedInstant(addDays(day, 1), START, tz);
  }
  return Math.round(total / 60_000);
}

// ----- Who is eligible -----

export const OFFER_GROUPS = [0, 1, 2] as const;
export type Group = (typeof OFFER_GROUPS)[number];
export const GROUP_LABEL: Record<Group, string> = { 0: "Top", 1: "Core", 2: "Developing" };

/** Bartenders always; an admin or manager only when switched on with "Include in bartender offers". */
export function includedInOffers(p: { role: string; in_offers?: boolean | null }): boolean {
  if (p.role === "bartender") return true;
  return (p.role === "admin" || p.role === "manager") && p.in_offers === true;
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 0 Sunday .. 6 Saturday for a YYYY-MM-DD day. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** Weekdays as saved: unique whole numbers 0 to 6, sorted. */
export function cleanWeekdays(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out = new Set<number>();
  for (const d of v) {
    const n = typeof d === "number" ? d : Number(d);
    if (!Number.isInteger(n) || n < 0 || n > 6) return null;
    out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function offOnWeekday(offWeekdays: unknown, day: string | null): boolean {
  if (!day || !Array.isArray(offWeekdays)) return false;
  return offWeekdays.map(Number).includes(weekdayOf(day));
}

/**
 * Guest fit. One bartender: the guest count against their solo number.
 * More than one: guests divided by bartenders. No solo number set means no limit.
 */
export function guestFit(guests: number | null, bartenders: number | null, solo: number | null): { ok: boolean; perBartender: number | null } {
  if (solo === null || guests === null) return { ok: true, perBartender: null };
  const n = bartenders && bartenders > 1 ? bartenders : 1;
  const per = Math.ceil(guests / n);
  return { ok: per <= solo, perBartender: n > 1 ? per : null };
}

export interface Candidate {
  id: string;
  name: string;
  role: string;
  active: boolean;
  in_offers?: boolean | null;
  markets: string[];
  off_weekdays?: unknown;
  weddings: boolean;
  solo: number | null;
}

export interface EventFit {
  market: string;
  day: string | null;
  wedding: boolean;
  guests: number | null;
  bartenders: number | null;
}

export interface Busy {
  unavailable: Set<string>; // marked the date off
  onEvent: Set<string>; // already on this event (offered or accepted)
  overlapping: Set<string>; // on another event at the same time
  certIssue: Record<string, string>; // only while certifications are enforced
}

/** Why someone is skipped for this event, or null when they are eligible. */
export function skipReason(c: Candidate, ev: EventFit, busy: Busy): string | null {
  if (!c.active) return "Not active";
  if (!includedInOffers(c)) return "Not in bartender offers";
  if (!c.markets.includes(ev.market)) return "Not in this market";
  if (busy.onEvent.has(c.id)) return "Already on this event";
  if (busy.unavailable.has(c.id)) return "Off that day";
  if (offOnWeekday(c.off_weekdays, ev.day)) return `Never works ${WEEKDAY_NAMES[weekdayOf(ev.day!)]}s`;
  if (busy.overlapping.has(c.id)) return "On another event at that time";
  if (busy.certIssue[c.id]) return busy.certIssue[c.id];
  if (ev.wedding && !c.weddings) return "Not set for weddings";
  const fit = guestFit(ev.guests, ev.bartenders, c.solo);
  if (!fit.ok) return fit.perBartender !== null ? `${fit.perBartender} guests per bartender, solo number ${c.solo}` : `${ev.guests} guests, solo number ${c.solo}`;
  return null;
}

// ----- The order and when each offer goes out -----

export interface Ranked {
  staffId: string;
  grp: Group;
  rank: number; // place inside the group, 1 first
}

export interface Planned extends Ranked {
  dueAt: Date; // with one spot open
  dueWideAt: Date | null; // while two or more spots are open
}

function stagger(groups: Ranked[][], start: Date, s: Pick<OfferSettings, "headStartMin" | "windowMin">, tz: string): Map<string, Date> {
  const out = new Map<string, Date>();
  let groupStart = nextDaytime(start, tz);
  for (const g of groups) {
    if (g.length === 0) continue;
    g.forEach((p, i) => out.set(p.staffId, addDaytime(groupStart, i * s.headStartMin, tz)));
    // The next group starts when this group's window ends, and never before the
    // last person here had their head start.
    groupStart = addDaytime(groupStart, Math.max(s.windowMin, g.length * s.headStartMin), tz);
  }
  return out;
}

/**
 * When each person's offer goes out. With one spot: Top in order, then Core
 * when Top's window ends, then Developing. With two or more spots the other
 * spots open one tier wider from the start: Top and Core go out together in
 * order, then Developing when that window ends.
 */
export function planTimes(order: Ranked[], start: Date, spots: number, s: Pick<OfferSettings, "headStartMin" | "windowMin">, tz: string): Planned[] {
  const sorted = [...order].sort((a, b) => a.grp - b.grp || a.rank - b.rank);
  const by = (g: Group) => sorted.filter((p) => p.grp === g);
  const narrow = stagger([by(0), by(1), by(2)], start, s, tz);
  const wide = spots >= 2 ? stagger([[...by(0), ...by(1)], by(2)], start, s, tz) : null;
  return sorted.map((p) => {
    const dueAt = narrow.get(p.staffId)!;
    const w = wide?.get(p.staffId) ?? null;
    return { ...p, dueAt, dueWideAt: w && w < dueAt ? w : null };
  });
}

/** When an offer is due now: the wider time counts only while two or more spots are open. */
export function effectiveDue(step: { due_at: string; due_wide_at?: string | null }, openSpots: number): Date {
  const narrow = new Date(step.due_at);
  if (openSpots >= 2 && step.due_wide_at) {
    const wide = new Date(step.due_wide_at);
    return wide < narrow ? wide : narrow;
  }
  return narrow;
}

/** May an offer go out right now: due, and daytime in the market (so never in quiet hours). */
export function sendNow(step: { status: string; due_at: string; due_wide_at?: string | null }, openSpots: number, now: Date, tz: string): boolean {
  return step.status === "planned" && openSpots > 0 && effectiveDue(step, openSpots) <= now && inDaytime(now, tz);
}

/** The next planned offer and its time, for the Team tab. */
export function nextUp<T extends { status: string; due_at: string; due_wide_at?: string | null }>(steps: T[], openSpots: number, tz: string, now: Date): { step: T; at: Date } | null {
  let best: { step: T; at: Date } | null = null;
  for (const s of steps) {
    if (s.status !== "planned") continue;
    const due = effectiveDue(s, openSpots);
    const at = due < now ? nextDaytime(now, tz) : due;
    if (!best || at < best.at) best = { step: s, at };
  }
  return best;
}

/** After a pause, every offer not yet sent moves later by the daytime the pause took. */
export function shiftForPause(due: string, pausedDaytimeMin: number, tz: string): string {
  return addDaytime(new Date(due), pausedDaytimeMin, tz).toISOString();
}

// ----- When someone requests the shift -----

/** Approve or pass texts admins once more after 2 daytime hours unanswered. */
export const REQUEST_REMIND_MIN = 120;
/** A request waiting more than 4 daytime hours shows in red. */
export const REQUEST_RED_MIN = 240;

export interface AcceptFacts {
  wedding: boolean;
  guests: number | null;
  holdOverGuests: number;
  bartenders: number | null; // on the event
  spots: number; // in this run
  claims: { developing: boolean }[]; // spots already taken in this run (hand assigned counts as approved)
  teamApproved: boolean; // someone outside Developing was on the event before the offers
  developing: boolean; // the person accepting
}

/**
 * Every request waits for approval. These are noted on it so admins know why
 * to look closer: a wedding, an event over the guest limit, and, on an event
 * with two or more bartenders, a request that would leave every spot to
 * Developing bartenders. Admins and managers only.
 */
export function requestNotes(f: AcceptFacts): string[] {
  const notes: string[] = [];
  if (f.wedding) notes.push("Wedding");
  if (f.guests !== null && f.guests > f.holdOverGuests) notes.push(`Over ${f.holdOverGuests} guests`);
  const lastSpot = f.claims.length + 1 >= f.spots;
  if ((f.bartenders ?? 1) >= 2 && lastSpot && f.developing && !f.teamApproved && f.claims.every((c) => c.developing)) notes.push("Every spot would be Developing");
  return notes;
}

/** Spots still open in a run. */
export function openSpots(run: { spots: number }, claims: number): number {
  return Math.max(0, run.spots - claims);
}

// ----- When nobody takes it -----

/**
 * The one "nobody took it" text: every person in the order has been offered
 * (or skipped) and a spot is still open, or the event is within 5 days with a
 * spot open. Null when no alert is due.
 */
export function nobodyReason(o: { open: number; planned: number; daysOut: number | null; alerted: boolean }): string | null {
  if (o.alerted || o.open <= 0) return null;
  if (o.planned === 0) return "Everyone eligible has been offered";
  if (o.daysOut !== null && o.daysOut <= NOBODY_ALERT_DAYS) return `The event is ${o.daysOut <= 0 ? "today" : o.daysOut === 1 ? "tomorrow" : `${o.daysOut} days out`}`;
  return null;
}

// ----- Texts. Nothing about order, groups, places, or who else was offered. -----

export function offerText(o: { shortDate: string; city: string; arrive: string; service: string; link: string }): string {
  return `Mix Fix shift offer: ${o.shortDate}, ${o.city}, arrive ${o.arrive}, service ${o.service}. Request it or pass: ${o.link}`;
}

/** What someone sees right after requesting a shift. */
export const REQUEST_SENT = "Request sent. We will confirm with you.";

/** The one text when an admin or manager passes on a request. Never who else asked, or why. */
export const REQUEST_PASSED_TEXT = "This shift has been filled. Thank you for requesting it.";

/** To admins and managers with alerts on, when a request comes in. */
export function requestText(o: { name: string; title: string; date: string; notes: string[]; link: string }): string {
  return `Shift request: ${o.name} requested ${o.title} on ${o.date}.${o.notes.length ? ` Look closer: ${o.notes.join(", ")}.` : ""} Approve or pass: ${o.link}`;
}

/** Once more, after 2 daytime hours with no answer. */
export function requestReminderText(o: { name: string; title: string; date: string; link: string }): string {
  return `Still waiting: ${o.name} requested ${o.title} on ${o.date} and nobody has approved or passed yet. Offers for that spot are paused until you answer: ${o.link}`;
}

export function offerFilledText(o: { date: string }): string {
  return `The Mix Fix shift on ${o.date} has been filled. No action needed.`;
}

export function offerClosedText(o: { date: string }): string {
  return `The Mix Fix shift offer for ${o.date} is closed. No action needed.`;
}

export function nobodyText(o: { title: string; date: string; market: string; open: number; needed: number; reason: string; link: string }): string {
  const spots = `${o.open} of ${o.needed} bartender ${o.needed === 1 ? "spot" : "spots"}`;
  return `Shift offers: nobody has taken ${o.title} on ${o.date} (${o.market}). Still open: ${spots}. ${o.reason}. ${o.link}`;
}

/** Text a staff member could ever get or see about an offer must never mention any of this. */
export const ORDER_WORDS = /\b(tier|rank|ranked|order|place|position|top|core|developing|next|first|before|after you|ahead|queue|list)\b/i;

// ----- Admin labels -----

export type StepStatus = "planned" | "sent" | "accepted" | "held" | "released" | "declined" | "no_response" | "skipped" | "closed";
export const STEP_LABEL: Record<StepStatus, string> = {
  planned: "Planned",
  sent: "Offered, no reply yet",
  accepted: "Approved",
  held: "Requested, waiting for approval",
  released: "Passed",
  declined: "Declined",
  no_response: "No response",
  skipped: "Skipped",
  closed: "Not offered",
};

export function daysUntil(day: string | null, tz: string, now: Date): number | null {
  if (!day) return null;
  const today = todayIn(tz, now);
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}
