// Business overview: totals, breakdowns, data completeness, and the cash view
// across many events. Pure, no database. Admins only (business-overview-db.ts).
//
// Every number here is added up from each event's own Business figures
// (lib/team/business.ts), so the tab, this page, and the CSV never disagree.
// An event is incomplete only with no booked total or a blank per guest supply
// estimate; those are left out of the profit totals and counted separately.

import { addDays, COST_KEYS, COST_LABEL, LABOR_LABEL, SUPPLIES_METHOD_LABEL, type CostKey, type EventBusiness, type Missing } from "@/lib/team/business";
import { csvCell } from "@/lib/team/timesheet";

export type RangePreset = "this_month" | "last_month" | "next_30" | "custom";
export const RANGE_LABEL: Record<RangePreset, string> = { this_month: "This month", last_month: "Last month", next_30: "Next 30 days", custom: "Custom" };

const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The date range for a preset (or a custom from..to), inclusive. Bad custom dates fall back to this month. */
export function rangeFor(preset: unknown, today: string, from?: unknown, to?: unknown): { preset: RangePreset; from: string; to: string } {
  const ym = today.slice(0, 7);
  if (preset === "last_month") {
    const [y, m] = ym.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    return { preset, from: `${prev}-01`, to: monthEnd(prev) };
  }
  if (preset === "next_30") return { preset, from: today, to: addDays(today, 29) };
  if (preset === "custom" && isYmd(from) && isYmd(to) && from <= to && Date.parse(to) - Date.parse(from) <= 731 * 86_400_000) return { preset, from, to };
  return { preset: "this_month", from: `${ym}-01`, to: monthEnd(ym) };
}

export interface OverviewEvent {
  sessionId: string;
  title: string;
  day: string | null;
  package: string;
  market: string;
  leadSource: string | null; // not stored today: always null
  business: EventBusiness;
  payrollCents: number; // estimated pay + mileage + tips for the crew (the payout sheet total)
}

export interface Totals {
  events: number;
  revenueCents: number;
  costs: Record<CostKey, number>;
  costCents: number;
  profitCents: number;
  marginPct: number | null;
  profitPerEventCents: number | null;
  averageTicketCents: number | null;
}

function emptyTotals(): Totals {
  return { events: 0, revenueCents: 0, costs: Object.fromEntries(COST_KEYS.map((k) => [k, 0])) as Record<CostKey, number>, costCents: 0, profitCents: 0, marginPct: null, profitPerEventCents: null, averageTicketCents: null };
}

function add(t: Totals, e: OverviewEvent) {
  t.events += 1;
  t.revenueCents += e.business.revenue.totalCents ?? 0;
  for (const c of e.business.costs) t.costs[c.key] += c.cents ?? 0;
  t.costCents += e.business.costCents;
  t.profitCents += e.business.profitCents ?? 0;
}

function finish(t: Totals): Totals {
  return {
    ...t,
    marginPct: t.revenueCents ? Math.round((t.profitCents / t.revenueCents) * 1000) / 10 : null,
    profitPerEventCents: t.events ? Math.round(t.profitCents / t.events) : null,
    averageTicketCents: t.events ? Math.round(t.revenueCents / t.events) : null,
  };
}

/** Complete events only. */
export function totalsOf(events: OverviewEvent[]): Totals {
  const t = emptyTotals();
  for (const e of events) if (e.business.complete) add(t, e);
  return finish(t);
}

export function breakdown(events: OverviewEvent[], key: (e: OverviewEvent) => string): { key: string; totals: Totals; incomplete: number }[] {
  const groups = new Map<string, OverviewEvent[]>();
  for (const e of events) {
    const k = key(e) || "Not set";
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups]
    .map(([k, list]) => ({ key: k, totals: totalsOf(list), incomplete: list.filter((e) => !e.business.complete).length }))
    .sort((a, b) => b.totals.revenueCents - a.totals.revenueCents || a.key.localeCompare(b.key));
}

export interface Completeness {
  withTotal: number;
  events: number;
  complete: number;
  incomplete: number;
  incompleteRevenueCents: number; // totals on file for events left out of profit
  gaps: { sessionId: string; title: string; day: string | null; missing: Missing[] }[]; // no booked total, or a blank per guest estimate
}

export function completeness(events: OverviewEvent[]): Completeness {
  const gaps = events
    .map((e) => ({ sessionId: e.sessionId, title: e.title, day: e.day, missing: e.business.missing }))
    .filter((g) => g.missing.length > 0)
    .sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));
  const incomplete = events.filter((e) => !e.business.complete);
  return {
    withTotal: events.filter((e) => e.business.revenue.totalCents !== null).length,
    events: events.length,
    complete: events.length - incomplete.length,
    incomplete: incomplete.length,
    incompleteRevenueCents: incomplete.reduce((n, e) => n + (e.business.revenue.totalCents ?? 0), 0),
    gaps,
  };
}

// ----- Cash -----

export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface CashWeek {
  week: string; // Monday
  balancesDueCents: number; // balances still owed with a due date this week
  unknownBalances: number; // events due this week with no total on file
  payrollCents: number; // estimated payroll for events this week
  events: number;
}

export interface CashView {
  weeks: CashWeek[];
  next30: { balancesDueCents: number; payrollCents: number; unknownBalances: number };
  next60: { balancesDueCents: number; payrollCents: number; unknownBalances: number };
  overdue: { sessionId: string; title: string; day: string; balanceCents: number | null; status: string }[]; // inside 14 days of the event, balance unpaid; status is the readable one
}

/**
 * Balances due in the next 30 and 60 days by week, against estimated payroll
 * for the same weeks, and unpaid balances already inside 14 days of the event.
 * `events` should cover today to 74 days out (a balance due in 60 days is for
 * an event 74 days out).
 */
export function cashView(events: OverviewEvent[], today: string): CashView {
  const end30 = addDays(today, 29);
  const end60 = addDays(today, 59);
  const weeks = new Map<string, CashWeek>();
  const week = (ymd: string) => {
    const w = mondayOf(ymd);
    if (!weeks.has(w)) weeks.set(w, { week: w, balancesDueCents: 0, unknownBalances: 0, payrollCents: 0, events: 0 });
    return weeks.get(w)!;
  };
  for (let d = mondayOf(today); d <= end60; d = addDays(d, 7)) week(d);
  const sum = { next30: { balancesDueCents: 0, payrollCents: 0, unknownBalances: 0 }, next60: { balancesDueCents: 0, payrollCents: 0, unknownBalances: 0 } };
  const overdue: CashView["overdue"] = [];
  for (const e of events) {
    const r = e.business.revenue;
    const due = r.balanceDue;
    const owed = r.paid !== "paid_in_full";
    if (due && due >= today && due <= end60 && owed) {
      const w = week(due);
      if (r.balanceCents === null) w.unknownBalances += 1;
      else w.balancesDueCents += r.balanceCents;
      for (const [k, end] of [["next30", end30], ["next60", end60]] as const) {
        if (due > end) continue;
        if (r.balanceCents === null) sum[k].unknownBalances += 1;
        else sum[k].balancesDueCents += r.balanceCents;
      }
    }
    if (e.day && e.day >= today && e.day <= end60) {
      const w = week(e.day);
      w.payrollCents += e.payrollCents;
      w.events += 1;
      for (const [k, end] of [["next30", end30], ["next60", end60]] as const) if (e.day <= end) sum[k].payrollCents += e.payrollCents;
    }
    // Already inside 14 days of the event (the balance was due), and not paid.
    if (e.day && due && due < today && e.day >= today && owed && (r.balanceCents === null || r.balanceCents > 0)) {
      overdue.push({ sessionId: e.sessionId, title: e.title, day: e.day, balanceCents: r.balanceCents, status: r.status });
    }
  }
  return {
    weeks: [...weeks.values()].filter((w) => w.week <= end60).sort((a, b) => a.week.localeCompare(b.week)),
    ...sum,
    overdue: overdue.sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// ----- CSV -----

export const EVENT_CSV_COLUMNS = [
  "Event date",
  "Event",
  "Package",
  "Market",
  "Profit status",
  "Missing",
  "Total",
  "Gratuity",
  "Deposit paid",
  "Payments",
  "Collected",
  "Remaining balance",
  "Overpaid",
  "Balance due date",
  "Payment status",
  "Labor basis",
  "Supplies method",
  ...COST_KEYS.map((k) => COST_LABEL[k]),
  "Costs",
  "Profit",
  "Margin %",
];

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

export function eventsCsv(events: OverviewEvent[]): string {
  const lines = [EVENT_CSV_COLUMNS.map(csvCell).join(",")];
  for (const e of [...events].sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""))) {
    const b = e.business;
    const r = b.revenue;
    lines.push(
      [
        e.day ?? "",
        e.title,
        e.package,
        e.market,
        b.complete ? `${b.mode}` : "Incomplete",
        b.missing.map((m) => m.text).join("; "),
        dollars(r.totalCents),
        dollars(r.gratuityCents),
        dollars(r.depositPaidCents),
        dollars(r.paymentsCents),
        dollars(r.collectedCents),
        dollars(r.balanceCents),
        r.overpaidCents ? dollars(r.overpaidCents) : "",
        r.balanceDue ?? "",
        r.status,
        LABOR_LABEL[b.labor],
        SUPPLIES_METHOD_LABEL[b.supplies],
        ...COST_KEYS.map((k) => dollars(b.costs.find((c) => c.key === k)?.cents ?? null)),
        dollars(b.costCents),
        dollars(b.profitCents),
        b.marginPct === null ? "" : String(b.marginPct),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
