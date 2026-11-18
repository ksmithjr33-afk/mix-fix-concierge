// Payroll: everything an admin needs to run payroll for a pay period, and a
// hand kept record of who has been paid. Admins only (role admin, never
// managers). Pure, no database.
//
// No pay math lives here. Each line is one payout sheet row (lib/team/payout.ts,
// the same row the Payout card and the payroll CSV show), next to that
// person's timesheet row for the clock times. Totals come from payoutTotals.
// The 40 hour flag is overWeekLimit on the Time page's week totals. Overtime
// pay is left to the payroll provider.

import { hoursText, money } from "@/lib/team/pay";
import { overWeekLimit, payoutTotals, WEEK_FLAG_MIN, type PayoutRow } from "@/lib/team/payout";
import { csvCell, csvHours, csvTime, isYmd, staffTotals, weekRange, weekStart, type TimesheetRow } from "@/lib/team/timesheet";
import { roleLabel } from "@/lib/team/roles";

export const PAYROLL_PATH = "/team/admin/payroll";
export const PERIOD_COOKIE = "payroll_period";
export const MAX_PERIOD_DAYS = 92;
export const MAX_NOTE = 120;
export const NOT_READY_MESSAGE = "Paid records are not set up yet. Run the payroll migration first.";
export const FIX_HOURS = "Fix hours first";

// ----- Pay periods (Monday to Sunday weeks, like the Time page) -----

export const PERIOD_KEYS = ["this_week", "last_week", "last_two_weeks", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const PERIOD_LABEL: Record<PeriodKey, string> = { this_week: "This week", last_week: "Last week", last_two_weeks: "Last two weeks", custom: "Custom" };

export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
}

const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/**
 * The dates for a choice, with today's date in Chicago. Last two weeks is the
 * two full weeks before this one. A custom range needs valid dates, start on
 * or before end, and no more than 92 days; otherwise it falls back to last week.
 */
export function periodFor(key: unknown, today: string, from?: unknown, to?: unknown): Period {
  const thisWeek = weekRange(today);
  if (key === "this_week") return { key, from: thisWeek.from, to: thisWeek.to };
  if (key === "last_two_weeks") return { key, from: addDays(thisWeek.from, -14), to: addDays(thisWeek.from, -1) };
  if (key === "custom" && isYmd(from) && isYmd(to) && from <= to && dayCount(from, to) <= MAX_PERIOD_DAYS) return { key, from, to };
  return { key: "last_week", from: thisWeek.prev, to: addDays(thisWeek.from, -1) };
}

/** The cookie value that remembers a choice: "last_week", or "custom:2026-11-01:2026-11-15". */
export function periodCookie(p: Period): string {
  return p.key === "custom" ? `custom:${p.from}:${p.to}` : p.key;
}

/** Read the remembered choice back. Anything unreadable is last week. */
export function periodFromCookie(raw: string | undefined | null, today: string): Period {
  const [key, from, to] = String(raw ?? "").split(":");
  return periodFor(key, today, from, to);
}

/** The period from the address, else the remembered choice, else last week. */
export function choosePeriod(params: { period?: unknown; from?: unknown; to?: unknown }, cookie: string | undefined | null, today: string): Period {
  if (typeof params.period === "string" && (PERIOD_KEYS as readonly string[]).includes(params.period)) return periodFor(params.period, today, params.from, params.to);
  return periodFromCookie(cookie, today);
}

// ----- Paid records -----

/** What was paid for a line, saved when it was marked paid. */
export interface Snapshot {
  minutes: number;
  wagesCents: number;
  mileageMiles: number;
  mileageCents: number;
  tipsCents: number | null;
  totalCents: number;
}

export interface PaidRecord {
  assignmentId: string;
  paidOn: string; // YYYY-MM-DD, the pay date
  note: string;
  markedByName: string;
  markedAt: string;
  snapshot: Snapshot;
}

export interface Changed {
  paidCents: number;
  currentCents: number;
  diffCents: number; // current less paid
}

// ----- Lines -----

export type LineProblem = "no_clock_in" | "no_clock_out";
export const PROBLEM_TEXT: Record<LineProblem, string> = { no_clock_in: "No clock in", no_clock_out: "No clock out" };

export interface PayrollLine {
  assignmentId: string;
  staffId: string;
  sessionId: string;
  eventDay: string | null;
  eventTitle: string; // the admin title: "Justin Reyes · Wedding"
  timeZone: string;
  clockIn: string | null;
  clockOut: string | null;
  minutes: number | null; // actual clocked minutes, null until both punches
  wagesCents: number; // the payout card's pay: actual, else the estimate
  mileageMiles: number;
  mileageCents: number;
  tipsCents: number | null; // null: not on file
  totalCents: number;
  fromEstimate: boolean;
  payable: boolean; // actual clocked hours: the only lines that can be marked paid
  problem: LineProblem | null;
  paid: PaidRecord | null;
  changed: Changed | null;
  attention: boolean; // fix hours first, or changed after it was marked paid
  payout: PayoutRow; // the source row, for totals
}

/** One payout row as a payroll line. Every number is the payout row's. */
export function lineFrom(p: PayoutRow, sheet: TimesheetRow | null, ev: { sessionId: string; day: string | null; title: string; timeZone: string }, paid: PaidRecord | null): PayrollLine {
  const tips = p.tipsCents ?? 0;
  const problem: LineProblem | null = !sheet?.clockIn ? "no_clock_in" : !sheet.clockOut ? "no_clock_out" : null;
  const payable = !p.fromEstimate && p.actualMinutes !== null && problem === null;
  const line: PayrollLine = {
    assignmentId: p.assignmentId,
    staffId: p.staffId,
    sessionId: ev.sessionId,
    eventDay: ev.day,
    eventTitle: ev.title,
    timeZone: ev.timeZone,
    clockIn: sheet?.clockIn?.at ?? null,
    clockOut: sheet?.clockOut?.at ?? null,
    minutes: p.actualMinutes,
    wagesCents: p.totalCents - p.mileageCents - tips,
    mileageMiles: p.mileageMiles,
    mileageCents: p.mileageCents,
    tipsCents: p.tipsCents,
    totalCents: p.totalCents,
    fromEstimate: p.fromEstimate,
    payable,
    problem,
    paid,
    changed: null,
    attention: false,
    payout: p,
  };
  line.changed = paid ? changedAfterPaid(paid.snapshot, line) : null;
  line.attention = !payable || line.changed !== null;
  return line;
}

/** What gets saved when a line is marked paid. Only for a payable line. */
export function snapshotOf(l: Pick<PayrollLine, "minutes" | "wagesCents" | "mileageMiles" | "mileageCents" | "tipsCents" | "totalCents">): Snapshot {
  return { minutes: l.minutes ?? 0, wagesCents: l.wagesCents, mileageMiles: l.mileageMiles, mileageCents: l.mileageCents, tipsCents: l.tipsCents, totalCents: l.totalCents };
}

/** Null when the live numbers still match what was paid; otherwise paid, current, and the difference. */
export function changedAfterPaid(s: Snapshot, live: Pick<PayrollLine, "minutes" | "wagesCents" | "mileageMiles" | "mileageCents" | "tipsCents" | "totalCents" | "payable">): Changed | null {
  const same =
    live.payable &&
    s.minutes === live.minutes &&
    s.wagesCents === live.wagesCents &&
    Number(s.mileageMiles) === Number(live.mileageMiles) &&
    s.mileageCents === live.mileageCents &&
    (s.tipsCents ?? null) === (live.tipsCents ?? null) &&
    s.totalCents === live.totalCents;
  return same ? null : { paidCents: s.totalCents, currentCents: live.totalCents, diffCents: live.totalCents - s.totalCents };
}

/** "Paid $210.00, now $230.00, $20.00 more." No minus signs on screen. */
export function changedText(c: Changed): string {
  const diff = c.diffCents === 0 ? "the same total" : `${money(Math.abs(c.diffCents))} ${c.diffCents > 0 ? "more" : "less"}`;
  return `Paid ${money(c.paidCents)}, now ${money(c.currentCents)}, ${diff}.`;
}

export type Check = { ok: true } | { ok: false; error: string; status: number };

/** A line can be marked paid once, and only with actual clocked hours. */
export function checkMarkable(l: Pick<PayrollLine, "payable" | "problem" | "paid">): Check {
  if (l.paid) return { ok: false, error: "This line is already marked paid.", status: 409 };
  if (!l.payable) return { ok: false, error: `${FIX_HOURS}. ${l.problem ? `${PROBLEM_TEXT[l.problem]} yet.` : "This line has no clocked hours yet."}`, status: 400 };
  return { ok: true };
}

/** The pay date (blank is today) and note typed when marking paid. */
export function validateMark(raw: { paidOn?: unknown; note?: unknown }, today: string): { ok: true; paidOn: string; note: string } | { ok: false; error: string } {
  const d = String(raw.paidOn ?? "").trim();
  const paidOn = d || today;
  if (!isYmd(paidOn)) return { ok: false, error: "Enter a valid pay date." };
  const note = String(raw.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > MAX_NOTE) return { ok: false, error: `Keep the note to ${MAX_NOTE} characters.` };
  return { ok: true, paidOn, note };
}

// ----- People, the 40 hour flag, the summary -----

export interface WeekFlag {
  week: string; // the Monday
  minutes: number;
  overMinutes: number;
}

/**
 * Weeks at or over 40 hours per person, from the timesheet rows of whole
 * weeks: the same week totals and the same flag as the Time page.
 */
export function weekFlags(rows: TimesheetRow[]): Map<string, WeekFlag[]> {
  const byWeek = new Map<string, TimesheetRow[]>();
  for (const r of rows) {
    if (!r.eventDay) continue;
    const w = weekStart(r.eventDay);
    byWeek.set(w, [...(byWeek.get(w) ?? []), r]);
  }
  const out = new Map<string, WeekFlag[]>();
  for (const [week, list] of [...byWeek].sort((a, b) => a[0].localeCompare(b[0]))) {
    const totals = staffTotals(list);
    const over = overWeekLimit(totals);
    for (const t of totals) {
      if (!over.has(t.staffId)) continue;
      out.set(t.staffId, [...(out.get(t.staffId) ?? []), { week, minutes: t.minutes, overMinutes: t.minutes - WEEK_FLAG_MIN }]);
    }
  }
  return out;
}

export interface PersonTotals {
  minutes: number;
  wagesCents: number;
  mileageCents: number;
  tipsCents: number;
  totalCents: number;
  paidCents: number; // what was paid, from the snapshots
  unpaidCents: number; // the live total of lines not yet paid
}

export interface PayrollPerson {
  staffId: string;
  name: string;
  role: string; // "Bartender"
  rateCents: number;
  lines: PayrollLine[];
  totals: PersonTotals;
  over40: WeekFlag[];
  payableUnpaid: number; // lines "Mark all paid" would mark
}

export function personTotals(lines: PayrollLine[]): PersonTotals {
  const t = payoutTotals(lines.map((l) => l.payout));
  const paid = lines.filter((l) => l.paid);
  return {
    minutes: t.actualMinutes,
    wagesCents: t.totalCents - t.mileageCents - t.tipsCents,
    mileageCents: t.mileageCents,
    tipsCents: t.tipsCents,
    totalCents: t.totalCents,
    paidCents: paid.reduce((s, l) => s + l.paid!.snapshot.totalCents, 0),
    unpaidCents: payoutTotals(lines.filter((l) => !l.paid).map((l) => l.payout)).totalCents,
  };
}

export interface PayrollSummary {
  owedCents: number;
  paidCents: number;
  unpaidCents: number;
  people: number;
  attention: number; // lines
}

export interface PayrollView {
  period: Period;
  ready: boolean; // false until the migration runs: everything shows unpaid and nothing can be marked
  people: PayrollPerson[];
  summary: PayrollSummary;
}

/** One card per person, by name, with their lines by date. */
export function buildPayroll(period: Period, lines: PayrollLine[], weekRows: TimesheetRow[], ready: boolean): PayrollView {
  const flags = weekFlags(weekRows);
  const by = new Map<string, PayrollLine[]>();
  for (const l of lines) by.set(l.staffId, [...(by.get(l.staffId) ?? []), l]);
  const people = [...by].map(([staffId, list]): PayrollPerson => {
    const sorted = [...list].sort((a, b) => (a.eventDay ?? "9999").localeCompare(b.eventDay ?? "9999") || a.eventTitle.localeCompare(b.eventTitle));
    const first = sorted[0].payout;
    // Only weeks that touch the period.
    const over40 = (flags.get(staffId) ?? []).filter((w) => w.week <= period.to && weekRange(w.week).to >= period.from);
    return { staffId, name: first.name, role: roleLabel(first.role), rateCents: first.rateCents, lines: sorted, totals: personTotals(sorted), over40, payableUnpaid: sorted.filter((l) => l.payable && !l.paid).length };
  });
  people.sort((a, b) => a.name.localeCompare(b.name) || a.staffId.localeCompare(b.staffId));
  const summary: PayrollSummary = {
    owedCents: people.reduce((s, p) => s + p.totals.totalCents, 0),
    paidCents: people.reduce((s, p) => s + p.totals.paidCents, 0),
    unpaidCents: people.reduce((s, p) => s + p.totals.unpaidCents, 0),
    people: people.length,
    attention: lines.filter((l) => l.attention).length,
  };
  return { period, ready, people, summary };
}

export const FILTERS = ["all", "unpaid", "paid", "attention"] as const;
export type PayrollFilter = (typeof FILTERS)[number];
export const FILTER_LABEL: Record<PayrollFilter, string> = { all: "All", unpaid: "Unpaid only", paid: "Paid only", attention: "Needs attention" };

export function lineShown(l: PayrollLine, f: PayrollFilter): boolean {
  if (f === "unpaid") return !l.paid;
  if (f === "paid") return !!l.paid;
  if (f === "attention") return l.attention;
  return true;
}

/** People with at least one line under the filter, each with only those lines. Totals stay the whole period. */
export function filterPeople(people: PayrollPerson[], f: PayrollFilter): PayrollPerson[] {
  return people.map((p) => ({ ...p, lines: p.lines.filter((l) => lineShown(l, f)) })).filter((p) => p.lines.length > 0);
}

/** "2.50 h over 40, week of Nov 9" */
export function overText(w: WeekFlag): string {
  const [y, m, d] = w.week.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  return `${hoursText(w.minutes)} h in the week of ${day}, ${hoursText(w.overMinutes)} h over 40`;
}

// ----- CSV -----

export const LINE_CSV_COLUMNS = [
  "Person",
  "Role",
  "Rate",
  "Event date",
  "Event",
  "Clock in",
  "Clock out",
  "Hours",
  "Wages",
  "Mileage miles",
  "Mileage pay",
  "Tips",
  "Line total",
  "Paid",
  "Pay date",
  "Marked by",
  "Note",
] as const;

export const PEOPLE_CSV_COLUMNS = ["Person", "Role", "Rate", "Hours", "Wages", "Mileage pay", "Tips", "Total", "Paid", "Unpaid"] as const;

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",");

/** One row per line. A line without clocked hours says so in the Paid column. */
export function linesCsv(view: Pick<PayrollView, "people">): string {
  const out = [csvLine([...LINE_CSV_COLUMNS])];
  for (const p of view.people) {
    for (const l of p.lines) {
      out.push(
        csvLine([
          p.name,
          p.role,
          dollars(p.rateCents),
          l.eventDay ?? "",
          l.eventTitle,
          csvTime(l.clockIn, l.timeZone),
          csvTime(l.clockOut, l.timeZone),
          csvHours(l.minutes),
          dollars(l.wagesCents),
          String(l.mileageMiles),
          dollars(l.mileageCents),
          dollars(l.tipsCents),
          dollars(l.totalCents),
          l.paid ? "Yes" : l.payable ? "No" : `No, ${FIX_HOURS.toLowerCase()}`,
          l.paid?.paidOn ?? "",
          l.paid?.markedByName ?? "",
          l.paid?.note ?? "",
        ])
      );
    }
  }
  return out.join("\r\n") + "\r\n";
}

/** One row per person: the card totals. */
export function peopleCsv(view: Pick<PayrollView, "people">): string {
  const out = [csvLine([...PEOPLE_CSV_COLUMNS])];
  for (const p of view.people) {
    const t = p.totals;
    out.push(csvLine([p.name, p.role, dollars(p.rateCents), csvHours(t.minutes), dollars(t.wagesCents), dollars(t.mileageCents), dollars(t.tipsCents), dollars(t.totalCents), dollars(t.paidCents), dollars(t.unpaidCents)]));
  }
  return out.join("\r\n") + "\r\n";
}
