// Staff Scorecard: the math and the rules. Pure, no database.
//
// Admins and managers only, and never about themselves (lib/team/scorecard-db.ts
// enforces both on the server). Staff never see any of this: no staff page,
// text or export imports this file.
//
// A rating is one person on one event: seven marks, each 1 to 5 or blank.
// A blank is left out of every average. Any mark of 3 or lower needs a note.
// Tiers are worked out over the last N rated events (N in settings, 10 to start).

export const SCORECARD_PATH = "/team/admin/scorecard";
export const SETTINGS_KEY = "scorecard_tiers";
export const NOT_READY = "The Scorecard is not set up yet. Run the scorecard migration first.";
export const TO_RATE_DAYS = 14;
export const LATE_HOURS = 48;
export const CALL_DAYS = 14;
export const NOTE_MAX = 2000;
export const FEEDBACK_MAX = 2000;
export const REVIEW_MAX = 4000;

export const MARKS = [
  { key: "client", label: "Client", help: "The client's rating of the bartender." },
  { key: "admin", label: "Admin", help: "Manual followed, on time, uniform, clean setup." },
  { key: "efficiency", label: "Efficiency", help: "Speed and consistency at peak." },
  { key: "shopping", label: "Shopping list", help: "Matched the menu and guest count, no run outs, no big overbuy." },
  { key: "leftovers", label: "Leftovers and inventory", help: "Leftover report on time and accurate." },
  { key: "comms", label: "Comms with admin", help: "Response time and raising issues early." },
  { key: "confidence", label: "Confidence", help: "Self rated on the check in call." },
] as const;
export type MarkKey = (typeof MARKS)[number]["key"];
export const MARK_KEYS: MarkKey[] = MARKS.map((m) => m.key);
export type Marks = Record<MarkKey, number | null>;
export const NOTE_AT_OR_BELOW = 3;

export const blankMarks = (): Marks => Object.fromEntries(MARK_KEYS.map((k) => [k, null])) as Marks;
export const allFives = (): Marks => Object.fromEntries(MARK_KEYS.map((k) => [k, 5])) as Marks;

/** The marks given, blanks left out. */
export const givenMarks = (m: Partial<Marks>): number[] => MARK_KEYS.map((k) => m[k]).filter((v): v is number => typeof v === "number");

/** The average of the marks given, or null when every mark is blank. Blanks never count. */
export function markAverage(m: Partial<Marks>): number | null {
  const g = givenMarks(m);
  return g.length ? g.reduce((a, b) => a + b, 0) / g.length : null;
}

export function lowestMark(m: Partial<Marks>): number | null {
  const g = givenMarks(m);
  return g.length ? Math.min(...g) : null;
}

/** "4.67", or "" when there is nothing to show. */
export const avgText = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(2) : "");

// ----- Validating a rating -----

export interface RatingInput {
  marks: Marks;
  markNotes: Partial<Record<MarkKey, string>>;
  clientFeedback: string;
  adminNotes: string;
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

function readMark(v: unknown): number | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : "bad";
}

/** The marks and notes, or the first problem. A mark of 3 or lower needs a note; blanks are fine. */
export function validateRating(raw: Record<string, unknown>): { ok: true; value: RatingInput } | { ok: false; error: string } {
  const rawMarks = (raw.marks && typeof raw.marks === "object" ? raw.marks : {}) as Record<string, unknown>;
  const rawNotes = (raw.markNotes && typeof raw.markNotes === "object" ? raw.markNotes : {}) as Record<string, unknown>;
  const marks = blankMarks();
  const markNotes: Partial<Record<MarkKey, string>> = {};
  for (const m of MARKS) {
    const v = readMark(rawMarks[m.key]);
    if (v === "bad") return { ok: false, error: `${m.label} must be 1 to 5, or left blank.` };
    marks[m.key] = v;
    const note = clean(rawNotes[m.key], NOTE_MAX);
    if (v !== null && v <= NOTE_AT_OR_BELOW) {
      if (!note) return { ok: false, error: `Add a note for ${m.label}: a mark of ${NOTE_AT_OR_BELOW} or lower needs one.` };
      markNotes[m.key] = note;
    }
  }
  if (givenMarks(marks).length === 0) return { ok: false, error: "Give at least one mark." };
  return { ok: true, value: { marks, markNotes, clientFeedback: clean(raw.clientFeedback, FEEDBACK_MAX), adminNotes: clean(raw.adminNotes, FEEDBACK_MAX) } };
}

// ----- Tiers -----

export type Tier = "ace" | "solid" | "coach" | "new";
export const TIER_LABEL: Record<Tier, string> = { ace: "Ace", solid: "Solid", coach: "Coach", new: "New" };
export const TIER_ORDER: Record<Tier, number> = { ace: 0, solid: 1, coach: 2, new: 3 };
export const TIERS: Tier[] = ["ace", "solid", "coach", "new"];

export interface TierSettings {
  window: number; // rated events the tier looks at (10)
  aceAvg: number; // 4.8
  aceMin: number; // no mark below this (4)
  solidAvg: number; // 4.5
  coachLow: number; // a mark at or below this... (2)
  coachRecent: number; // ...in the last N rated events means Coach (3)
  newUnder: number; // fewer rated events than this is New (3)
}

export const TIER_DEFAULTS: TierSettings = { window: 10, aceAvg: 4.8, aceMin: 4, solidAvg: 4.5, coachLow: 2, coachRecent: 3, newUnder: 3 };

const LIMITS: Record<keyof TierSettings, { min: number; max: number; int: boolean; label: string }> = {
  window: { min: 1, max: 50, int: true, label: "Window" },
  aceAvg: { min: 1, max: 5, int: false, label: "Ace average" },
  aceMin: { min: 1, max: 5, int: true, label: "Ace lowest mark" },
  solidAvg: { min: 1, max: 5, int: false, label: "Solid average" },
  coachLow: { min: 1, max: 5, int: true, label: "Coach low mark" },
  coachRecent: { min: 1, max: 50, int: true, label: "Coach recent events" },
  newUnder: { min: 1, max: 50, int: true, label: "New under" },
};

export function readTierSettings(v: unknown): TierSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...TIER_DEFAULTS };
  for (const k of Object.keys(LIMITS) as (keyof TierSettings)[]) {
    const n = Number(o[k]);
    const l = LIMITS[k];
    if (Number.isFinite(n) && n >= l.min && n <= l.max && (!l.int || Number.isInteger(n))) out[k] = n;
  }
  return out;
}

export function validateTierSettings(raw: Record<string, unknown>): { ok: true; value: TierSettings } | { ok: false; error: string } {
  const out = { ...TIER_DEFAULTS };
  for (const k of Object.keys(LIMITS) as (keyof TierSettings)[]) {
    const l = LIMITS[k];
    const n = Number(raw[k]);
    if (raw[k] === "" || raw[k] === undefined || !Number.isFinite(n) || n < l.min || n > l.max || (l.int && !Number.isInteger(n))) {
      return { ok: false, error: `${l.label} must be ${l.int ? "a whole number " : ""}from ${l.min} to ${l.max}.` };
    }
    out[k] = n;
  }
  if (out.solidAvg > out.aceAvg) return { ok: false, error: "The Solid average cannot be above the Ace average." };
  return { ok: true, value: out };
}

/** One rated event for the tier math, newest first in the list. */
export interface RatedEvent {
  sessionId: string;
  day: string | null;
  marks: Marks;
}

export interface TierResult {
  tier: Tier;
  rated: number; // rated events, all time
  lastAvg: number | null; // over the window
  allAvg: number | null;
  lowest: number | null; // lowest mark in the window
  trend: number[]; // event averages in the window, oldest first
  markAvgs: Record<MarkKey, number | null>; // each mark averaged over every rated event
  reason: string; // why this tier, for a tooltip
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// Averages compared with a small tolerance so 4.8 typed in settings is not missed by floating point.
const atLeast = (n: number | null, t: number) => n !== null && n >= t - 1e-9;

/**
 * The tier from rated events, newest first. Events with every mark blank do
 * not count as rated. The window average is the average of each event's own
 * average (its blanks left out).
 *   New:   fewer than newUnder rated events
 *   Coach: any mark at or below coachLow in the last coachRecent rated events
 *   Ace:   window average at least aceAvg and no mark below aceMin in the window
 *   Solid: window average at least solidAvg
 *   Coach: anything else (average below solidAvg)
 */
export function tierFor(newestFirst: RatedEvent[], s: TierSettings = TIER_DEFAULTS): TierResult {
  const rated = newestFirst.filter((e) => givenMarks(e.marks).length > 0);
  const win = rated.slice(0, s.window);
  const avgs = win.map((e) => markAverage(e.marks)!);
  const lastAvg = mean(avgs);
  const allAvg = mean(rated.map((e) => markAverage(e.marks)!));
  const winMarks = win.flatMap((e) => givenMarks(e.marks));
  const lowest = winMarks.length ? Math.min(...winMarks) : null;
  const markAvgs = Object.fromEntries(MARK_KEYS.map((k) => [k, mean(rated.map((e) => e.marks[k]).filter((v): v is number => typeof v === "number"))])) as Record<MarkKey, number | null>;
  const base = { rated: rated.length, lastAvg, allAvg, lowest, trend: [...avgs].reverse(), markAvgs };
  if (rated.length < s.newUnder) return { ...base, tier: "new", reason: `Fewer than ${s.newUnder} rated events` };
  const recentLow = rated.slice(0, s.coachRecent).some((e) => givenMarks(e.marks).some((m) => m <= s.coachLow));
  if (recentLow) return { ...base, tier: "coach", reason: `A mark of ${s.coachLow} or lower in the last ${s.coachRecent} rated events` };
  if (atLeast(lastAvg, s.aceAvg) && lowest !== null && lowest >= s.aceMin) return { ...base, tier: "ace", reason: `Average ${s.aceAvg} or higher and no mark below ${s.aceMin}` };
  if (atLeast(lastAvg, s.solidAvg)) return { ...base, tier: "solid", reason: `Average ${s.solidAvg} or higher` };
  return { ...base, tier: "coach", reason: `Average below ${s.solidAvg}` };
}

// ----- Rank within a market -----

export interface Rankable {
  staffId: string;
  name: string;
  markets: string[];
  tier: Tier;
  lastAvg: number | null;
  rated: number;
}

/** Rank per market: by tier, then window average, then events rated. New is listed but never ranked. */
export function ranksByMarket(rows: Rankable[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const markets = [...new Set(rows.flatMap((r) => r.markets))];
  for (const m of markets) {
    const inMarket = rows
      .filter((r) => r.markets.includes(m) && r.tier !== "new")
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (b.lastAvg ?? 0) - (a.lastAvg ?? 0) || b.rated - a.rated || a.name.localeCompare(b.name));
    out.set(m, new Map(inMarket.map((r, i) => [r.staffId, i + 1])));
  }
  return out;
}

// ----- The To rate list -----

export interface WorkedLine {
  sessionId: string;
  staffId: string;
  end: Date; // when service ended
}

export interface ToRateEvent {
  sessionId: string;
  end: Date;
  staffIds: string[]; // worked it, not yet rated
  late: boolean; // over 48 hours since service ended
}

/** Events over in the last 14 days with people not yet rated, oldest first. */
export function toRateList(lines: WorkedLine[], rated: Set<string>, now: Date): ToRateEvent[] {
  const from = now.getTime() - TO_RATE_DAYS * 86_400_000;
  const by = new Map<string, ToRateEvent>();
  for (const l of lines) {
    const t = l.end.getTime();
    if (t > now.getTime() || t < from || rated.has(`${l.sessionId}|${l.staffId}`)) continue;
    const e = by.get(l.sessionId) ?? { sessionId: l.sessionId, end: l.end, staffIds: [], late: now.getTime() - t > LATE_HOURS * 3_600_000 };
    if (!e.staffIds.includes(l.staffId)) e.staffIds.push(l.staffId);
    by.set(l.sessionId, e);
  }
  return [...by.values()].sort((a, b) => a.end.getTime() - b.end.getTime());
}

// ----- Check in calls and Locked by Tuesday -----

export const OUTCOMES = ["good", "okay", "bad"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome, string> = { good: "Good", okay: "Okay", bad: "Bad" };

const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dow = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday, 2 Tuesday
};

/** The Tuesday before the event day (never the day itself: an event on a Tuesday locks the week before). */
export function tuesdayBefore(day: string): string {
  const back = (dow(day) - 2 + 7) % 7 || 7;
  return addDays(day, -back);
}

/** Not locked and the Tuesday before has come (today or past). */
export function lockOverdue(day: string | null, locked: boolean, today: string): boolean {
  return !!day && !locked && today >= tuesdayBefore(day);
}

/** A call not done for an event in the coming week (today through 6 days out). */
export function callOverdue(day: string | null, done: boolean, today: string): boolean {
  return !!day && !done && day >= today && day <= addDays(today, 6);
}

export function validateCall(raw: Record<string, unknown>): { ok: true; value: { done: boolean; outcome: Outcome | null; confidence: number | null; notes: string } } | { ok: false; error: string } {
  const outcome = raw.outcome === "" || raw.outcome === null || raw.outcome === undefined ? null : raw.outcome;
  if (outcome !== null && !OUTCOMES.includes(outcome as Outcome)) return { ok: false, error: "Pick Good, Okay or Bad." };
  const c = readMark(raw.confidence);
  if (c === "bad") return { ok: false, error: "Confidence must be 1 to 5, or left blank." };
  return { ok: true, value: { done: raw.done === true, outcome: outcome as Outcome | null, confidence: c, notes: clean(raw.notes, NOTE_MAX) } };
}

// ----- Reviews -----

export const REVIEW_KINDS = ["praise", "coaching", "incident", "general"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const REVIEW_LABEL: Record<ReviewKind, string> = { praise: "Praise", coaching: "Coaching", incident: "Incident", general: "General" };

export function validateReview(raw: Record<string, unknown>, today: string): { ok: true; value: { kind: ReviewKind; date: string; body: string } } | { ok: false; error: string } {
  if (!REVIEW_KINDS.includes(raw.kind as ReviewKind)) return { ok: false, error: "Pick Praise, Coaching, Incident or General." };
  const date = String(raw.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > addDays(today, 1)) return { ok: false, error: "Pick a date, today or earlier." };
  const body = clean(raw.body, REVIEW_MAX);
  if (!body) return { ok: false, error: "Write the review." };
  return { ok: true, value: { kind: raw.kind as ReviewKind, date, body } };
}

// ----- Suggestions from the facts (never saved without the reviewer confirming) -----

export interface Suggestion {
  value: number;
  why: string;
}

/**
 * Leftovers and inventory from the closeout report: 5 when in within 2 hours
 * of service end with the supplies counted, 4 in on time without counts, 3 in
 * within a day, 2 later than that, 1 when there is none.
 */
export function leftoverSuggestion(closeout: { at: Date; counted: boolean } | null, end: Date | null): Suggestion {
  if (!closeout) return { value: 1, why: "No closeout report." };
  const hours = end ? (closeout.at.getTime() - end.getTime()) / 3_600_000 : 0;
  if (hours <= 2) return closeout.counted ? { value: 5, why: "Closeout in on time with the supplies counted." } : { value: 4, why: "Closeout in on time, supplies not counted." };
  if (hours <= 24) return { value: 3, why: `Closeout in ${Math.round(hours)} hours after service ended.` };
  return { value: 2, why: `Closeout in ${Math.round(hours / 24)} days after service ended.` };
}

/** Confidence from the check in call, when one was logged with a confidence. */
export function confidenceSuggestion(call: { confidence: number | null } | null): Suggestion | null {
  return call && typeof call.confidence === "number" ? { value: call.confidence, why: "From the check in call." } : null;
}

/** "12 minutes late", "5 minutes early", "on time". */
export function arrivalText(arrival: Date | null, clockIn: Date | null): string {
  if (!clockIn) return "No clock in";
  if (!arrival) return "Clocked in, no arrival time set";
  const min = Math.round((clockIn.getTime() - arrival.getTime()) / 60_000);
  if (min === 0) return "On time";
  const n = Math.abs(min);
  return `${n} ${n === 1 ? "minute" : "minutes"} ${min > 0 ? "late" : "early"}`;
}

// ----- CSV -----

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells: unknown[]) => cells.map(cell).join(",");

export const RATINGS_COLUMNS = [
  "Event Date",
  "Event",
  "Package",
  "Client",
  "Bartender",
  "Monday Call Done",
  "Locked by Tuesday",
  "Manual Signed",
  "Client",
  "Admin",
  "Efficiency",
  "Shopping List",
  "Leftovers & Inventory",
  "Comms w/ Admin",
  "Confidence",
  "Average",
  "Lowest Mark",
  "Tier",
  "Client Feedback",
  "Admin Notes",
  "Leftover Report In",
];

export interface RatingCsvRow {
  day: string | null;
  event: string;
  pkg: string;
  client: string;
  person: string;
  callDone: boolean | null;
  locked: boolean | null;
  manualSigned: boolean;
  marks: Marks;
  tier: Tier;
  clientFeedback: string;
  adminNotes: string;
  leftoverIn: boolean;
}

const yn = (v: boolean | null) => (v === null ? "" : v ? "Yes" : "No");

export function ratingsCsv(rows: RatingCsvRow[]): string {
  return [
    csvLine(RATINGS_COLUMNS),
    ...rows.map((r) =>
      csvLine([
        r.day ?? "",
        r.event,
        r.pkg,
        r.client,
        r.person,
        yn(r.callDone),
        yn(r.locked),
        yn(r.manualSigned),
        ...MARK_KEYS.map((k) => r.marks[k] ?? ""),
        avgText(markAverage(r.marks)),
        lowestMark(r.marks) ?? "",
        TIER_LABEL[r.tier],
        r.clientFeedback,
        r.adminNotes,
        yn(r.leftoverIn),
      ]),
    ),
  ].join("\r\n");
}

export const ROSTER_COLUMNS = [
  "Name",
  "Market",
  "Events Worked",
  "Events Rated",
  "Last 10 Average",
  "All Time Average",
  "Lowest Mark (Last 10)",
  "Tier",
  "Rank",
  "Last Event",
  "Late Arrivals (90 days)",
  "Missing Clock Outs (90 days)",
  "Declined (90 days)",
  "Handed Off (90 days)",
  "Missing Closeouts (90 days)",
  "Onboarding",
  "Certification",
  "Payroll Setup Done",
];

export interface RosterRow {
  staffId: string;
  name: string;
  role: string;
  markets: string[];
  marketLabel: string;
  worked: number;
  result: TierResult;
  rank: number | null; // in the primary (first) market
  ranks: Record<string, number>; // market to rank
  lastEvent: string | null;
  facts: { late: number; noClockOut: number; declined: number; handedOff: number; noCloseout: number };
  onboarding: { done: number; total: number };
  cert: string; // "TABC approved to 2027-03-01", or ""
  payrollDone: boolean;
}

export function rosterCsv(rows: RosterRow[]): string {
  return [
    csvLine(ROSTER_COLUMNS),
    ...rows.map((r) =>
      csvLine([
        r.name,
        r.marketLabel,
        r.worked,
        r.result.rated,
        avgText(r.result.lastAvg),
        avgText(r.result.allAvg),
        r.result.lowest ?? "",
        TIER_LABEL[r.result.tier],
        r.rank ?? "",
        r.lastEvent ?? "",
        r.facts.late,
        r.facts.noClockOut,
        r.facts.declined,
        r.facts.handedOff,
        r.facts.noCloseout,
        `${r.onboarding.done} of ${r.onboarding.total}`,
        r.cert,
        yn(r.payrollDone),
      ]),
    ),
  ].join("\r\n");
}
