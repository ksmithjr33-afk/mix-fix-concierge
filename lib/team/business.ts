// Business: revenue, costs, profit for one event. Pure, no database.
// Admins only (role admin, never managers): see business-db.ts.
//
// Revenue is the booked total, with the gratuity inside it. Costs are labor
// (actual clocked pay once the event is done, the estimate before), payroll
// burden on labor, mileage, tips paid out, supplies, card processing, and
// other costs an admin adds. Labor, mileage and tips come from the payout
// sheet, which comes from the pay estimate and the timesheet: nothing here
// figures hours or pay. Any missing input is named, and the profit line is
// Incomplete instead of a number that looks final.

import type { CostSettings } from "@/lib/team/business-settings";
import type { PayoutTotals } from "@/lib/team/payout";

export const DEPOSIT_DUE_DAYS = 14; // the balance is due 14 days before the event
export const CARD_CHARGES = 2; // deposit and balance

export interface FinanceRow {
  session_id: string;
  deposit_paid_cents: number | null;
  deposit_paid_on: string | null; // YYYY-MM-DD
  balance_paid_cents: number | null;
  balance_paid_on: string | null;
  supplies_cents: number | null; // a manual amount for this event; wins over the catalog estimate
}

export interface OtherCost {
  id: string;
  label: string;
  cents: number;
}

export interface BusinessInputs {
  eventDay: string | null; // YYYY-MM-DD
  done: boolean; // service has ended
  totalCents: number | null; // the booked total
  gratuityCents: number | null; // inside the total; null when not on file
  bookedDepositCents: number | null; // the deposit the booking asked for
  pricePending: boolean;
  finance: FinanceRow | null;
  payout: PayoutTotals | null; // null when nobody accepted
  crewExpected: number | null; // bartenders booked, to say staffing is missing
  suppliesEstimateCents: number | null; // from the cost catalog (matched Shopping list lines)
  suppliesUnmatched: number; // Shopping list lines with no cost yet
  other: OtherCost[];
  settings: CostSettings;
}

export type PaidStatus = "paid_in_full" | "deposit_paid" | "unpaid" | "not_on_file";
export const PAID_LABEL: Record<PaidStatus, string> = {
  paid_in_full: "Paid in full",
  deposit_paid: "Deposit paid, balance open",
  unpaid: "Nothing paid yet",
  not_on_file: "Payment status not on file",
};

export type CostKey = "labor" | "burden" | "mileage" | "tips" | "supplies" | "card" | "other";
export const COST_LABEL: Record<CostKey, string> = {
  labor: "Labor",
  burden: "Payroll burden",
  mileage: "Mileage pay",
  tips: "Tips paid out",
  supplies: "Supplies",
  card: "Card processing",
  other: "Other costs",
};
export const COST_KEYS: CostKey[] = ["labor", "burden", "mileage", "tips", "supplies", "card", "other"];

export interface CostLine {
  key: CostKey;
  label: string;
  cents: number | null; // null: not on file
  note: string; // "actual clocked pay", "estimate", "15% of labor", "confirm your rate"
}

export interface EventBusiness {
  mode: "Estimated" | "Actual";
  revenue: {
    totalCents: number | null;
    gratuityCents: number | null;
    depositPaidCents: number | null;
    depositPaidOn: string | null;
    balancePaidCents: number | null;
    balancePaidOn: string | null;
    balanceCents: number | null; // still owed
    balanceDue: string | null; // YYYY-MM-DD, 14 days before the event
    paid: PaidStatus;
  };
  costs: CostLine[];
  costCents: number; // the costs on file, added up
  missing: string[]; // "Supplies not on file", in plain words
  complete: boolean;
  profitCents: number | null; // null while incomplete
  marginPct: number | null;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const balanceDueDate = (eventDay: string | null) => (eventDay ? addDays(eventDay, -DEPOSIT_DUE_DAYS) : null);

export function paidStatus(totalCents: number | null, f: FinanceRow | null): PaidStatus {
  const dep = f?.deposit_paid_cents ?? null;
  const bal = f?.balance_paid_cents ?? null;
  if (dep === null && bal === null) return "not_on_file";
  const paid = (dep ?? 0) + (bal ?? 0);
  if (totalCents !== null && paid >= totalCents) return "paid_in_full";
  if (bal !== null && totalCents === null) return "paid_in_full";
  if ((dep ?? 0) > 0) return "deposit_paid";
  return "unpaid";
}

/** Card processing on the total: percent plus the fixed fee for each charge. */
export function cardFee(totalCents: number, s: CostSettings): number {
  return Math.round((totalCents * s.cardPct) / 100) + s.cardFixedCents * CARD_CHARGES;
}

export function eventBusiness(i: BusinessInputs): EventBusiness {
  const missing: string[] = [];
  const f = i.finance;
  const total = i.totalCents;
  if (total === null) missing.push(i.pricePending ? "Total not on file (price pending)" : "Total not on file");
  if (i.gratuityCents === null) missing.push("Gratuity not on file");

  const paid = paidStatus(total, f);
  if (paid === "not_on_file") missing.push("Payment status not on file");
  const paidSoFar = (f?.deposit_paid_cents ?? 0) + (f?.balance_paid_cents ?? 0);

  // Labor: actual clocked pay once done, the estimate before.
  const p = i.payout;
  const costs: CostLine[] = [];
  let labor: number | null = null;
  if (!p || p.people === 0) {
    missing.push(i.crewExpected ? "No staff accepted yet" : "No staff on the event yet");
  } else if (i.done) {
    labor = p.actualPayCents;
    if (p.open > 0) {
      missing.push(`Hours not clocked out for ${p.open} of ${p.people}`);
      labor = null;
    }
  } else {
    labor = p.estPayCents;
  }
  costs.push({ key: "labor", label: COST_LABEL.labor, cents: labor, note: i.done ? "actual clocked pay" : "estimate" });
  costs.push({ key: "burden", label: COST_LABEL.burden, cents: labor === null ? null : Math.round((labor * i.settings.burdenPct) / 100), note: `${i.settings.burdenPct}% of labor` });
  costs.push({ key: "mileage", label: COST_LABEL.mileage, cents: p ? p.mileageCents : null, note: "stored miles, driving where available" });
  costs.push({ key: "tips", label: COST_LABEL.tips, cents: i.gratuityCents, note: "the gratuity, all of it to the bartenders" });

  const manual = f?.supplies_cents ?? null;
  const supplies = manual ?? i.suppliesEstimateCents;
  if (supplies === null) missing.push("Supplies not on file");
  costs.push({
    key: "supplies",
    label: COST_LABEL.supplies,
    cents: supplies,
    note: manual !== null ? "entered for this event" : i.suppliesEstimateCents !== null ? `from the cost catalog${i.suppliesUnmatched ? `, ${i.suppliesUnmatched} lines with no cost yet` : ""}` : "",
  });
  costs.push({ key: "card", label: COST_LABEL.card, cents: total === null ? null : cardFee(total, i.settings), note: `${i.settings.cardPct}% + $${(i.settings.cardFixedCents / 100).toFixed(2)} a charge, confirm your rate` });
  const otherCents = i.other.reduce((n, o) => n + o.cents, 0);
  costs.push({ key: "other", label: COST_LABEL.other, cents: otherCents, note: i.other.length ? `${i.other.length} ${i.other.length === 1 ? "line" : "lines"}` : "none" });

  const costCents = costs.reduce((n, c) => n + (c.cents ?? 0), 0);
  const complete = missing.length === 0;
  const profitCents = complete && total !== null ? total - costCents : null;
  return {
    mode: i.done ? "Actual" : "Estimated",
    revenue: {
      totalCents: total,
      gratuityCents: i.gratuityCents,
      depositPaidCents: f?.deposit_paid_cents ?? null,
      depositPaidOn: f?.deposit_paid_on ?? null,
      balancePaidCents: f?.balance_paid_cents ?? null,
      balancePaidOn: f?.balance_paid_on ?? null,
      balanceCents: total === null ? null : Math.max(0, total - paidSoFar),
      balanceDue: balanceDueDate(i.eventDay),
      paid,
    },
    costs,
    costCents,
    missing,
    complete,
    profitCents,
    marginPct: profitCents !== null && total ? Math.round((profitCents / total) * 1000) / 10 : null,
  };
}

/** Dollars typed by an admin ("1,850.00", "$24"), as cents. Null when blank or not a number. */
export function dollarsToCents(raw: unknown, max = 1_000_000): number | null {
  const s = String(raw ?? "").trim().replace(/[$,\s]/g, "");
  if (!s || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100);
  return c <= max * 100 ? c : null;
}

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = new Date(`${v}T00:00:00Z`);
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v;
}
