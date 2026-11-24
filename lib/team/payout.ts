// The payout sheet: one row per person on an event, estimate against actual.
// Pure, no database. Hours come from scheduledMinutes (the estimate) and the
// timesheet rows (actual); pay is payCents on both at the line's rate
// (lineRate). Nothing here figures hours or pay a second way. Reimbursements
// are added to the person's total in their own column; they are never wages.
// Admins and managers only.

import { hoursText, money, payCents, type MileageLine, type PayPackage, type PayReason, type RateSource, type StaffEstimate } from "@/lib/team/pay";
import type { TimesheetRow } from "@/lib/team/timesheet";
import { reimbursementsCents, type Reimbursement } from "@/lib/team/reimbursements";

/** A row 30 or more minutes over the estimate is flagged. */
export const OVER_FLAG_MIN = 30;
/** Hours for the week at or over this are flagged on the Time page. */
export const WEEK_FLAG_MIN = 40 * 60;

export type PayoutFlag = "over_estimate" | "not_clocked_in" | "not_clocked_out";
export const PAYOUT_FLAG_LABEL: Record<PayoutFlag, string> = {
  over_estimate: "30+ min over the estimate",
  not_clocked_in: "Not clocked in",
  not_clocked_out: "Not clocked out",
};

export interface PayoutPerson {
  staffId: string;
  assignmentId: string;
  name: string;
  role: string;
  estimate: StaffEstimate;
  sheet: TimesheetRow | null; // their timesheet row for this event
  reimbursements?: Reimbursement[];
}

export interface PayoutRow {
  staffId: string;
  assignmentId: string;
  name: string;
  role: string;
  rateCents: number;
  rateSource: RateSource;
  ratePkg: PayPackage | null;
  serviceFee: boolean; // a service fee event: no gratuity share, tips are 0
  reason: PayReason | null; // service fee events: why this rate (Top, New hire, Personal rate). Admins and managers only
  rateStored: boolean; // the rate stored when the hours were approved
  estMinutes: number | null;
  estPayCents: number | null;
  actualMinutes: number | null; // null until clocked in and out
  actualPayCents: number | null;
  diffMinutes: number | null; // actual less estimate
  diffCents: number | null;
  mileage: MileageLine;
  mileageMiles: number; // paid miles
  mileageCents: number;
  tipsCents: number | null; // null: not on file
  reimbursements: Reimbursement[];
  reimbursementsCents: number;
  totalCents: number; // pay (actual, else the estimate) + mileage + tips + reimbursements
  fromEstimate: boolean; // no actual hours yet, so the total uses the estimate
  approved: boolean;
  flags: PayoutFlag[];
}

export function payoutRow(p: PayoutPerson): PayoutRow {
  const e = p.estimate;
  const actualMinutes = p.sheet?.minutes ?? null;
  const actualPayCents = actualMinutes === null ? null : payCents(e.rateCents, actualMinutes);
  const diffMinutes = actualMinutes !== null && e.minutes !== null ? actualMinutes - e.minutes : null;
  const diffCents = actualPayCents !== null && e.hourlyCents !== null ? actualPayCents - e.hourlyCents : null;
  const mileageCents = e.mileage.state === "paid" ? e.mileage.cents : 0;
  const tipsCents = e.tips.state === "on_file" ? e.tips.cents : e.tips.state === "not_bartender" || e.tips.state === "service_fee" ? 0 : null;
  const flags: PayoutFlag[] = [];
  if (!p.sheet?.clockIn) flags.push("not_clocked_in");
  else if (!p.sheet.clockOut) flags.push("not_clocked_out");
  if (diffMinutes !== null && diffMinutes >= OVER_FLAG_MIN) flags.push("over_estimate");
  const pay = actualPayCents ?? e.hourlyCents ?? 0;
  const reimbursements = p.reimbursements ?? [];
  const reimbursed = reimbursementsCents(reimbursements);
  return {
    staffId: p.staffId,
    assignmentId: p.assignmentId,
    name: p.name,
    role: p.role,
    rateCents: e.rateCents,
    rateSource: e.rateSource,
    ratePkg: e.ratePkg,
    serviceFee: e.serviceFee,
    reason: e.reason ?? null,
    rateStored: !!e.rateStored,
    estMinutes: e.minutes,
    estPayCents: e.hourlyCents,
    actualMinutes,
    actualPayCents,
    diffMinutes,
    diffCents,
    mileage: e.mileage,
    mileageMiles: e.mileage.state === "paid" ? e.mileage.paidMiles : 0,
    mileageCents,
    tipsCents,
    reimbursements,
    reimbursementsCents: reimbursed,
    totalCents: pay + mileageCents + (tipsCents ?? 0) + reimbursed,
    fromEstimate: actualPayCents === null,
    approved: !!p.sheet?.approved,
    flags,
  };
}

export interface PayoutTotals {
  people: number;
  estMinutes: number;
  estPayCents: number;
  actualMinutes: number;
  actualPayCents: number;
  mileageMiles: number;
  mileageCents: number;
  tipsCents: number;
  reimbursementsCents: number;
  totalCents: number;
  flagged: number;
  open: number; // rows still waiting on a punch, so the totals lean on estimates
}

export function payoutTotals(rows: PayoutRow[]): PayoutTotals {
  const t: PayoutTotals = { people: rows.length, estMinutes: 0, estPayCents: 0, actualMinutes: 0, actualPayCents: 0, mileageMiles: 0, mileageCents: 0, tipsCents: 0, reimbursementsCents: 0, totalCents: 0, flagged: 0, open: 0 };
  for (const r of rows) {
    t.estMinutes += r.estMinutes ?? 0;
    t.estPayCents += r.estPayCents ?? 0;
    t.actualMinutes += r.actualMinutes ?? 0;
    t.actualPayCents += r.actualPayCents ?? 0;
    t.mileageMiles = Math.round((t.mileageMiles + r.mileageMiles) * 10) / 10;
    t.mileageCents += r.mileageCents;
    t.tipsCents += r.tipsCents ?? 0;
    t.reimbursementsCents += r.reimbursementsCents;
    t.totalCents += r.totalCents;
    if (r.flags.length) t.flagged += 1;
    if (r.fromEstimate) t.open += 1;
  }
  return t;
}

const signed = (n: number, f: (n: number) => string) => (n > 0 ? `+${f(n)}` : n < 0 ? `-${f(-n)}` : f(0));
export const diffHours = (m: number | null) => (m === null ? "" : signed(m, (x) => hoursText(x)));
export const diffMoney = (c: number | null) => (c === null ? "" : signed(c, money));

/** The sheet as tab separated text, for "Copy payout" (pastes into a spreadsheet). */
export function payoutText(title: string, rows: PayoutRow[], totals: PayoutTotals): string {
  const head = ["Name", "Est hours", "Est pay", "Actual hours", "Actual pay", "Difference", "Mileage miles", "Mileage pay", "Tips", "Reimbursements", "Total to pay", "Flags"];
  const line = (r: PayoutRow) => [
    r.name,
    hoursText(r.estMinutes),
    r.estPayCents === null ? "" : money(r.estPayCents),
    hoursText(r.actualMinutes),
    r.actualPayCents === null ? "" : money(r.actualPayCents),
    diffMoney(r.diffCents),
    String(r.mileageMiles),
    money(r.mileageCents),
    r.serviceFee ? "no gratuity share" : r.tipsCents === null ? "not on file" : money(r.tipsCents),
    money(r.reimbursementsCents),
    `${money(r.totalCents)}${r.fromEstimate ? " (estimate)" : ""}`,
    r.flags.map((f) => PAYOUT_FLAG_LABEL[f]).join("; "),
  ];
  const total = ["Total", hoursText(totals.estMinutes), money(totals.estPayCents), hoursText(totals.actualMinutes), money(totals.actualPayCents), "", String(totals.mileageMiles), money(totals.mileageCents), money(totals.tipsCents), money(totals.reimbursementsCents), money(totals.totalCents), ""];
  return [title, head.join("\t"), ...rows.map((r) => line(r).join("\t")), total.join("\t")].join("\n");
}

/** Staff whose hours for the rows given (a week) reach 40 or more. */
export function overWeekLimit(totals: { staffId: string; minutes: number }[]): Set<string> {
  return new Set(totals.filter((t) => t.minutes >= WEEK_FLAG_MIN).map((t) => t.staffId));
}

/**
 * A note when what the booking said each bartender's tip is (dollars) and the
 * gratuity split the payout uses (cents) differ by more than a dollar. The
 * split is never changed: it stays the gratuity divided evenly among the
 * accepted bartenders. Null when either is missing or they agree.
 */
export function tipMismatchNote(bookedTipDollars: number | null | undefined, splitCents: number | null): string | null {
  if (bookedTipDollars === null || bookedTipDollars === undefined || !Number.isFinite(Number(bookedTipDollars)) || splitCents === null) return null;
  const booked = Math.round(Number(bookedTipDollars) * 100);
  if (Math.abs(booked - splitCents) <= 100) return null;
  return `Booked tip per bartender is ${money(booked)}, but the gratuity split is ${money(splitCents)} each.`;
}
