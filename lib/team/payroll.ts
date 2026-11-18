// Payroll: the weekly payout sheet, and a hand kept record of who has been
// paid. Admins only (role admin, never managers). Pure, no database.
//
// A pay week is Monday to Sunday, paid the following Monday. The page shows
// one row per event in date order (each person on it with hours, rate, hourly
// total, gas, reimbursements, gratuity and their amount, then the event's
// total to staff, revenue, pay as a percent of revenue, and profit before
// supplies), and a Pay Out table with one row per person: what gets keyed
// into payroll. A custom date range is the secondary option.
//
// No pay math lives here. Each line is one payout sheet row (lib/team/payout.ts,
// the same row the Payout card shows), next to that person's timesheet row for
// the clock times. The rate is lineRate (lib/team/pay.ts): the person's own
// rate if one is set, otherwise the package rate. Gratuity is the booking's
// gratuity split evenly among the bartenders (tipsShare), never per person.
// Reimbursements are added to the amount in their own column, never wages.
// Totals come from payoutTotals. The 40 hour flag is overWeekLimit on the Time
// page's week totals. Overtime pay is left to the payroll provider.

import { hoursText, money, rateSourceText, type PayPackage, type RateSource } from "@/lib/team/pay";
import { overWeekLimit, payoutTotals, WEEK_FLAG_MIN, type PayoutRow } from "@/lib/team/payout";
import { csvCell, csvHours, csvTime, isYmd, staffTotals, weekRange, weekStart, type TimesheetRow } from "@/lib/team/timesheet";
import { roleLabel } from "@/lib/team/roles";
import { KIND_LABEL, pickupPrompts, type PickupKind, type Reimbursement } from "@/lib/team/reimbursements";

export const PAYROLL_PATH = "/team/admin/payroll";
export const MAX_PERIOD_DAYS = 92;
export const MAX_NOTE = 120;
export const NOT_READY_MESSAGE = "Paid records are not set up yet. Run the payroll migration first.";
export const FIX_HOURS = "Fix hours first";
/** People per event the sheet lays out side by side; more still show and still count. */
export const SHEET_PEOPLE = 4;

// ----- Pay weeks (Monday to Sunday, like the Time page), paid the next Monday -----

export type PeriodKey = "week" | "custom";

export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
  payDate: string | null; // the Monday after a pay week; null for a custom range
}

export const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** The pay week holding this day: its Monday to Sunday, paid the Monday after. */
export function weekPeriod(day: string): Period {
  const from = weekStart(day);
  return { key: "week", from, to: addDays(from, 6), payDate: addDays(from, 7) };
}

/** Last week: the week the page opens on. */
export const lastWeek = (today: string) => weekPeriod(addDays(weekStart(today), -7));

/** The week before (n = -1) or after (n = 1). */
export const shiftWeek = (p: Pick<Period, "from">, n: number) => weekPeriod(addDays(weekStart(p.from), 7 * n));

/**
 * A from and to date, checked: valid dates, start on or before end, 92 days
 * or less. Monday to the Sunday after is a pay week; anything else is custom.
 */
export function rangePeriod(from: unknown, to: unknown): Period | null {
  if (!isYmd(from) || !isYmd(to) || from > to || dayCount(from, to) > MAX_PERIOD_DAYS) return null;
  if (weekStart(from) === from && addDays(from, 6) === to) return weekPeriod(from);
  return { key: "custom", from, to, payDate: null };
}

/** From the address: ?week=<any day in it>, or ?from=&to= for a custom range. Otherwise last week. */
export function choosePeriod(params: { week?: unknown; from?: unknown; to?: unknown }, today: string): Period {
  if (params.from !== undefined || params.to !== undefined) return rangePeriod(params.from, params.to) ?? lastWeek(today);
  if (isYmd(params.week)) return weekPeriod(params.week);
  return lastWeek(today);
}

/** "Mon, Nov 16" */
export function dayLabel(ymd: string | null): string {
  if (!ymd) return "No date";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

// ----- Paid records -----

/** What was paid for a line, saved when it was marked paid. */
export interface Snapshot {
  minutes: number;
  wagesCents: number;
  mileageMiles: number;
  mileageCents: number;
  tipsCents: number | null;
  reimbursementsCents: number;
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
  name: string;
  role: string; // "bartender"
  sessionId: string;
  eventDay: string | null;
  eventTitle: string; // the admin title: "Justin Reyes · Wedding"
  timeZone: string;
  clockIn: string | null;
  clockOut: string | null;
  minutes: number | null; // actual clocked minutes, null until both punches
  estMinutes: number | null; // the scheduled estimate, shown until clocked
  rateCents: number;
  rateSource: RateSource; // own rate on the profile, or the package rate
  ratePkg: PayPackage | null;
  wagesCents: number; // the hourly total: actual, else the estimate
  mileageMiles: number;
  mileageCents: number; // gas
  tipsCents: number | null; // gratuity; null: not on file
  reimbursements: Reimbursement[];
  reimbursementsCents: number;
  totalCents: number; // the amount: hourly + gas + gratuity + reimbursements
  fromEstimate: boolean;
  payable: boolean; // actual clocked hours: the only lines that can be marked paid
  problem: LineProblem | null;
  paid: PaidRecord | null;
  changed: Changed | null;
  attention: boolean; // fix hours first, or changed after it was marked paid
  prompts: PickupKind[]; // "Picked up the ice. Add a reimbursement?"
  promptReceipts: Partial<Record<PickupKind, string>>; // a submitted receipt of that type: link to it instead
  payout: PayoutRow; // the source row, for totals
}

export interface LineEvent {
  sessionId: string;
  day: string | null;
  title: string;
  timeZone: string;
}

/** One payout row as a payroll line. Every number is the payout row's. */
export function lineFrom(
  p: PayoutRow,
  sheet: TimesheetRow | null,
  ev: LineEvent,
  paid: PaidRecord | null,
  did: { ice: boolean; menu: boolean } = { ice: false, menu: false },
  submitted: Partial<Record<PickupKind, string>> = {}
): PayrollLine {
  const prompts = pickupPrompts(did, p.reimbursements);
  const tips = p.tipsCents ?? 0;
  const problem: LineProblem | null = !sheet?.clockIn ? "no_clock_in" : !sheet.clockOut ? "no_clock_out" : null;
  const payable = !p.fromEstimate && p.actualMinutes !== null && problem === null;
  const line: PayrollLine = {
    assignmentId: p.assignmentId,
    staffId: p.staffId,
    name: p.name,
    role: p.role,
    sessionId: ev.sessionId,
    eventDay: ev.day,
    eventTitle: ev.title,
    timeZone: ev.timeZone,
    clockIn: sheet?.clockIn?.at ?? null,
    clockOut: sheet?.clockOut?.at ?? null,
    minutes: p.actualMinutes,
    estMinutes: p.estMinutes,
    rateCents: p.rateCents,
    rateSource: p.rateSource,
    ratePkg: p.ratePkg,
    wagesCents: p.totalCents - p.mileageCents - tips - p.reimbursementsCents,
    mileageMiles: p.mileageMiles,
    mileageCents: p.mileageCents,
    tipsCents: p.tipsCents,
    reimbursements: p.reimbursements,
    reimbursementsCents: p.reimbursementsCents,
    totalCents: p.totalCents,
    fromEstimate: p.fromEstimate,
    payable,
    problem,
    paid,
    changed: null,
    attention: false,
    prompts,
    promptReceipts: Object.fromEntries(prompts.filter((k) => submitted[k]).map((k) => [k, submitted[k]!])),
    payout: p,
  };
  line.changed = paid ? changedAfterPaid(paid.snapshot, line) : null;
  line.attention = !payable || line.changed !== null;
  return line;
}

type Numbers = Pick<PayrollLine, "minutes" | "wagesCents" | "mileageMiles" | "mileageCents" | "tipsCents" | "reimbursementsCents" | "totalCents">;

/** What gets saved when a line is marked paid. Only for a payable line. */
export function snapshotOf(l: Numbers): Snapshot {
  return { minutes: l.minutes ?? 0, wagesCents: l.wagesCents, mileageMiles: l.mileageMiles, mileageCents: l.mileageCents, tipsCents: l.tipsCents, reimbursementsCents: l.reimbursementsCents, totalCents: l.totalCents };
}

/** Null when the live numbers still match what was paid; otherwise paid, current, and the difference. */
export function changedAfterPaid(s: Snapshot, live: Numbers & Pick<PayrollLine, "payable">): Changed | null {
  const same =
    live.payable &&
    s.minutes === live.minutes &&
    s.wagesCents === live.wagesCents &&
    Number(s.mileageMiles) === Number(live.mileageMiles) &&
    s.mileageCents === live.mileageCents &&
    (s.tipsCents ?? null) === (live.tipsCents ?? null) &&
    (s.reimbursementsCents ?? 0) === live.reimbursementsCents &&
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

/** "Full Bar rate", "own rate": which rule set the line's rate. */
export const lineRateText = (l: Pick<PayrollLine, "rateSource" | "ratePkg">) => rateSourceText({ source: l.rateSource, pkg: l.ratePkg });

/** The hours to show: clocked, else the estimate (marked). */
export function lineHours(l: Pick<PayrollLine, "minutes" | "estMinutes">): { minutes: number | null; estimate: boolean } {
  return l.minutes !== null ? { minutes: l.minutes, estimate: false } : { minutes: l.estMinutes, estimate: true };
}

// ----- People, the 40 hour flag -----

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
  events: number;
  minutes: number;
  wagesCents: number;
  mileageCents: number;
  reimbursementsCents: number;
  tipsCents: number;
  totalCents: number;
  paidCents: number; // what was paid, from the snapshots
  unpaidCents: number; // the live total of lines not yet paid
}

export interface PayrollPerson {
  staffId: string;
  name: string;
  role: string; // "Bartender"
  lines: PayrollLine[];
  totals: PersonTotals;
  over40: WeekFlag[];
  payableUnpaid: number; // lines "Mark all paid" would mark
}

export function personTotals(lines: PayrollLine[]): PersonTotals {
  const t = payoutTotals(lines.map((l) => l.payout));
  const paid = lines.filter((l) => l.paid);
  return {
    events: new Set(lines.map((l) => l.sessionId)).size,
    minutes: t.actualMinutes,
    wagesCents: t.totalCents - t.mileageCents - t.tipsCents - t.reimbursementsCents,
    mileageCents: t.mileageCents,
    reimbursementsCents: t.reimbursementsCents,
    tipsCents: t.tipsCents,
    totalCents: t.totalCents,
    paidCents: paid.reduce((s, l) => s + l.paid!.snapshot.totalCents, 0),
    unpaidCents: payoutTotals(lines.filter((l) => !l.paid).map((l) => l.payout)).totalCents,
  };
}

// ----- Events: one row each on the sheet -----

/** What the sheet needs about an event besides its lines. */
export interface EventInfo {
  sessionId: string;
  day: string | null;
  title: string; // the admin title
  packageName: string;
  venue: string;
  timeZone: string;
  revenueCents: number | null; // the booked total, gratuity inside it
  suppliesCents: number | null; // the Business tab's supplies estimate; null when not set
}

export interface SheetEvent extends EventInfo {
  lines: PayrollLine[]; // bartenders first, then by name
  toStaffCents: number; // total to bartenders: every amount on the event
  gratuityCents: number | null; // the gratuity paid out; null when not on file
  payPct: number | null; // total to bartenders as a percent of revenue, one decimal
  profitBeforeSuppliesCents: number | null; // revenue less total to bartenders
  grossProfitCents: number | null; // less the supplies estimate too
  attention: number;
}

const pct = (part: number, whole: number | null) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

export function sheetEvent(info: EventInfo, lines: PayrollLine[]): SheetEvent {
  const sorted = [...lines].sort((a, b) => Number(b.role === "bartender") - Number(a.role === "bartender") || a.name.localeCompare(b.name) || a.staffId.localeCompare(b.staffId));
  const t = payoutTotals(sorted.map((l) => l.payout));
  const tipsOnFile = sorted.some((l) => l.tipsCents !== null && l.role === "bartender");
  const profit = info.revenueCents === null ? null : info.revenueCents - t.totalCents;
  return {
    ...info,
    lines: sorted,
    toStaffCents: t.totalCents,
    gratuityCents: tipsOnFile ? t.tipsCents : null,
    payPct: pct(t.totalCents, info.revenueCents),
    profitBeforeSuppliesCents: profit,
    grossProfitCents: profit === null || info.suppliesCents === null ? null : profit - info.suppliesCents,
    attention: sorted.filter((l) => l.attention).length,
  };
}

/** "12.5%" */
export const pctText = (n: number | null) => (n === null ? "" : `${n.toFixed(1)}%`);

// ----- The whole view -----

export interface PayrollSummary {
  owedCents: number; // total to bartenders
  paidCents: number;
  unpaidCents: number;
  people: number;
  events: number;
  attention: number; // lines
  payableUnpaid: number; // lines "Mark the week paid" would mark
  revenueCents: number;
}

export interface PayrollView {
  period: Period;
  ready: boolean; // false until the payroll migration runs: everything shows unpaid and nothing can be marked
  reimbursementsReady: boolean; // false until the reimbursements migration runs
  events: SheetEvent[];
  people: PayrollPerson[];
  summary: PayrollSummary;
}

/** One row per event by date, and one Pay Out row per person by name. */
export function buildPayroll(period: Period, lines: PayrollLine[], weekRows: TimesheetRow[], ready: boolean, infos: EventInfo[] = [], reimbursementsReady = true): PayrollView {
  const flags = weekFlags(weekRows);
  const by = new Map<string, PayrollLine[]>();
  for (const l of lines) by.set(l.staffId, [...(by.get(l.staffId) ?? []), l]);
  const people = [...by].map(([staffId, list]): PayrollPerson => {
    const sorted = [...list].sort((a, b) => (a.eventDay ?? "9999").localeCompare(b.eventDay ?? "9999") || a.eventTitle.localeCompare(b.eventTitle));
    // Only weeks that touch the period.
    const over40 = (flags.get(staffId) ?? []).filter((w) => w.week <= period.to && weekRange(w.week).to >= period.from);
    return { staffId, name: sorted[0].name, role: roleLabel(sorted[0].role), lines: sorted, totals: personTotals(sorted), over40, payableUnpaid: sorted.filter((l) => l.payable && !l.paid).length };
  });
  people.sort((a, b) => a.name.localeCompare(b.name) || a.staffId.localeCompare(b.staffId));

  const infoBy = new Map(infos.map((i) => [i.sessionId, i]));
  const bySession = new Map<string, PayrollLine[]>();
  for (const l of lines) bySession.set(l.sessionId, [...(bySession.get(l.sessionId) ?? []), l]);
  const events = [...bySession].map(([sessionId, list]) => {
    const f = list[0];
    const info = infoBy.get(sessionId) ?? { sessionId, day: f.eventDay, title: f.eventTitle, packageName: "", venue: "", timeZone: f.timeZone, revenueCents: null, suppliesCents: null };
    return sheetEvent(info, list);
  });
  events.sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999") || a.title.localeCompare(b.title) || a.sessionId.localeCompare(b.sessionId));

  const summary: PayrollSummary = {
    owedCents: people.reduce((s, p) => s + p.totals.totalCents, 0),
    paidCents: people.reduce((s, p) => s + p.totals.paidCents, 0),
    unpaidCents: people.reduce((s, p) => s + p.totals.unpaidCents, 0),
    people: people.length,
    events: events.length,
    attention: lines.filter((l) => l.attention).length,
    payableUnpaid: lines.filter((l) => l.payable && !l.paid).length,
    revenueCents: events.reduce((s, e) => s + (e.revenueCents ?? 0), 0),
  };
  return { period, ready, reimbursementsReady, events, people, summary };
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

/** Events with at least one line under the filter. The whole event still shows, so its totals read right. */
export function filterEvents(events: SheetEvent[], f: PayrollFilter): SheetEvent[] {
  return events.filter((e) => e.lines.some((l) => lineShown(l, f)));
}

/** People with at least one line under the filter, each with only those lines. Totals stay the whole period. */
export function filterPeople(people: PayrollPerson[], f: PayrollFilter): PayrollPerson[] {
  return people.map((p) => ({ ...p, lines: p.lines.filter((l) => lineShown(l, f)) })).filter((p) => p.lines.length > 0);
}

/** "40.67 h in the week of Nov 9, 0.67 h over 40" */
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
  "Rate from",
  "Event date",
  "Event",
  "Clock in",
  "Clock out",
  "Hours",
  "Wages",
  "Mileage miles",
  "Mileage pay",
  "Tips",
  "Reimbursements",
  "Line total",
  "Paid",
  "Pay date",
  "Marked by",
  "Note",
] as const;

export const PEOPLE_CSV_COLUMNS = ["Person", "Role", "Events", "Hours", "Wages", "Mileage pay", "Reimbursements", "Tips", "Total", "Paid", "Unpaid"] as const;

/** The payout sheet's own columns, in its order, to paste into the Google Sheet. */
export const SHEET_CSV_COLUMNS = [
  "Event Date",
  "Event Name",
  "Revenue Per Deal",
  "Venue / Location",
  "Package",
  "Gas",
  "Gas (2nd Bart)",
  "Gas (3rd Bart)",
  "Reimbursements",
  "Reimbursements (2nd Bart)",
  "Reimbursements (3rd Bart)",
  "Hours",
  "Hours 2nd Bar",
  "Hours 3rd Bar",
  "Hourly",
  "Hourly 2 Bartndr",
  "Hourly 3 Bartndr",
  "Total Hrly $",
  "Total Hrly $ 2nd Bart.",
  "Total Hrly $ 3rd Bart.",
  "CC Grat.",
  "Bartender 1 Amount",
  "Bartender",
  "Bartender 2 Amount",
  "2nd Bartender",
  "Bartender 3 Amount",
  "3rd Bartender",
  "Total to Bartenders",
  "Bartender Pay % of Revenue",
  "Profit before supplies",
  "Estimated Supplies Cost",
  "Estimated Gross Profit",
  "Notes",
] as const;

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",");
const csvDoc = (rows: string[]) => rows.join("\r\n") + "\r\n";

/** One row per line. A line without clocked hours says so in the Paid column. */
export function linesCsv(view: Pick<PayrollView, "people">): string {
  const out = [csvLine([...LINE_CSV_COLUMNS])];
  for (const p of view.people) {
    for (const l of p.lines) {
      out.push(
        csvLine([
          p.name,
          p.role,
          dollars(l.rateCents),
          lineRateText(l),
          l.eventDay ?? "",
          l.eventTitle,
          csvTime(l.clockIn, l.timeZone),
          csvTime(l.clockOut, l.timeZone),
          csvHours(l.minutes),
          dollars(l.wagesCents),
          String(l.mileageMiles),
          dollars(l.mileageCents),
          dollars(l.tipsCents),
          dollars(l.reimbursementsCents),
          dollars(l.totalCents),
          l.paid ? "Yes" : l.payable ? "No" : `No, ${FIX_HOURS.toLowerCase()}`,
          l.paid?.paidOn ?? "",
          l.paid?.markedByName ?? "",
          l.paid?.note ?? "",
        ])
      );
    }
  }
  return csvDoc(out);
}

/** One row per person: the Pay Out table. */
export function peopleCsv(view: Pick<PayrollView, "people">): string {
  const out = [csvLine([...PEOPLE_CSV_COLUMNS])];
  for (const p of view.people) {
    const t = p.totals;
    out.push(csvLine([p.name, p.role, t.events, csvHours(t.minutes), dollars(t.wagesCents), dollars(t.mileageCents), dollars(t.reimbursementsCents), dollars(t.tipsCents), dollars(t.totalCents), dollars(t.paidCents), dollars(t.unpaidCents)]));
  }
  return csvDoc(out);
}

const ORDINAL = ["", "2nd", "3rd", "4th", "5th", "6th"];

/** The notes cell: estimated hours, own rates, anyone past the third, anything to fix. */
function sheetNotes(e: SheetEvent): string {
  const notes: string[] = [];
  for (const l of e.lines.filter((x) => x.fromEstimate)) notes.push(`${l.name}: estimated hours, ${l.problem ? PROBLEM_TEXT[l.problem].toLowerCase() : "not clocked"}`);
  for (const l of e.lines.filter((x) => x.rateSource === "own")) notes.push(`${l.name}: own rate ${money(l.rateCents)}/hr`);
  e.lines.slice(3).forEach((l, i) => notes.push(`${ORDINAL[i + 3] ?? `${i + 4}th`} ${l.name}: ${money(l.totalCents)} (gas ${money(l.mileageCents)}, reimbursed ${money(l.reimbursementsCents)}, hourly ${money(l.wagesCents)} at ${money(l.rateCents)}/hr, ${hoursText(lineHours(l).minutes)} h)`));
  for (const l of e.lines.filter((x) => x.changed)) notes.push(`${l.name}: changed after paid. ${changedText(l.changed!)}`);
  for (const l of e.lines) for (const r of l.reimbursements.filter((x) => x.note)) notes.push(`${l.name} ${KIND_LABEL[r.kind]}: ${r.note}`);
  return notes.join("; ");
}

/**
 * One row per event in the payout sheet's own column order, to paste into the
 * Google Sheet. Three people side by side like the sheet; a fourth is in the
 * notes and in the total. Hours are clocked hours, else the estimate (noted).
 */
export function payoutSheetCsv(view: Pick<PayrollView, "events">): string {
  const out = [csvLine([...SHEET_CSV_COLUMNS])];
  for (const e of view.events) {
    const three = [0, 1, 2].map((i) => e.lines[i] ?? null);
    const each = <T,>(f: (l: PayrollLine) => T) => three.map((l) => (l ? f(l) : ""));
    out.push(
      csvLine([
        e.day ?? "",
        e.title,
        dollars(e.revenueCents),
        e.venue,
        e.packageName,
        ...each((l) => dollars(l.mileageCents)),
        ...each((l) => dollars(l.reimbursementsCents)),
        ...each((l) => csvHours(lineHours(l).minutes)),
        ...each((l) => dollars(l.rateCents)),
        ...each((l) => dollars(l.wagesCents)),
        dollars(e.gratuityCents),
        ...three.flatMap((l) => (l ? [dollars(l.totalCents), l.name] : ["", ""])),
        dollars(e.toStaffCents),
        pctText(e.payPct),
        dollars(e.profitBeforeSuppliesCents),
        dollars(e.suppliesCents),
        dollars(e.grossProfitCents),
        sheetNotes(e),
      ])
    );
  }
  return csvDoc(out);
}
