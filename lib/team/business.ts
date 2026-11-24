// Business: revenue, payments, costs, profit for one event. Pure, no database.
// Admins only (role admin, never managers): see business-db.ts.
//
// Every event shows a filled in estimate the moment it reaches the portal.
// Revenue is the booked total, gratuity inside it. Profit is the booked total
// less costs, never what has been collected, so payments never block it.
//
// Costs:
//   labor     actual clocked pay after the event, the accepted crew's estimate
//             before (each at their line rate), and before anyone accepts, the
//             booked bartenders (or the staffing the guest count needs) at the
//             package rate for the scheduled minutes (setup, service, breakdown)
//   burden    the settings percent of labor
//   mileage   after the event only; left out of the estimate until then
//   tips      the gratuity, all of it to the bartenders
//   supplies  entered by hand, else approved Supplies receipts (whoever
//             paid, "from receipts"), else the Shopping list against the cost
//             catalog, with the per guest estimate filling in what has no cost
//   card      percent plus the fixed fee for each charge
//   reimbursed  reimbursements to staff (ice, menu printing, other), entered on
//             Payroll; never labor, so no payroll burden on them
//             A Supplies receipt paid by staff is reimbursed on Payroll but
//             its reimbursement is left out here: it is already in supplies.
//   company   approved receipts other than Supplies paid by Company
//   other     lines an admin adds, less any already counted as a reimbursement
// Every approved receipt dollar counts exactly once.
//
// Service fee model events: revenue shows the service fee inside the total
// (no gratuity), tips paid out are $0, the per guest supply estimate is the
// service fee figure for the package (hand entry, receipts and the Shopping
// list still win), and mileage is the recorded mileage when there is any,
// otherwise the $30 gas estimate, never both. Burden and card fees stay.
// Only two things hold profit back: no booked total, or a blank per guest
// supply estimate when one is needed.
//
// The app stores no card information. A payment is an amount, a date, and an
// optional free text note.

import type { CostSettings } from "@/lib/team/business-settings";
import { otherCostsCovered, REIMBURSED_LABEL, type ReimbursementKind } from "@/lib/team/reimbursements";
import { COMPANY_COST_LABEL, receiptCosts, SUPPLIES_FROM_RECEIPTS, type ApprovedReceipt } from "@/lib/team/receipts";

export const DEPOSIT_DUE_DAYS = 14; // the balance is due 14 days before the event
export const CARD_CHARGES = 2; // deposit and balance
/** Service hours assumed when an event has neither times nor booked hours. */
export const ASSUMED_SERVICE_HOURS = 4;
export const SETTINGS_HREF = "/team/admin/business#settings";

export interface FinanceRow {
  session_id: string;
  deposit_paid_cents: number | null; // an admin's edit; null means the default deposit
  deposit_paid_on: string | null; // YYYY-MM-DD
  balance_paid_cents: number | null; // before the payments list; the migration moves it into event_payments
  balance_paid_on: string | null;
  supplies_cents: number | null; // entered by hand for this event; wins over everything else
}

export interface Payment {
  id: string; // "legacy" for a balance recorded before the payments list
  cents: number;
  paidOn: string | null; // YYYY-MM-DD
  note: string;
  recordedBy: string;
}

export interface OtherCost {
  id: string;
  label: string;
  cents: number;
}

/** One accepted person, from the payout sheet. */
export interface CrewPay {
  rateCents: number;
  estPayCents: number | null;
  actualPayCents: number | null; // null until clocked in and out
  mileageCents: number;
  mileageRecorded?: boolean; // their mileage line is worked out (stored or adjusted)
}

/** The gas estimate on a service fee event with no recorded mileage. */
export const GAS_ESTIMATE_CENTS = 30_00;

export interface SupplyLines {
  catalogCents: number; // the costed lines, added up
  costed: number;
  lines: number; // "we buy" lines on the Shopping list
}

export interface BusinessInputs {
  today: string; // YYYY-MM-DD, for "Balance overdue"
  eventDay: string | null;
  done: boolean; // service has ended
  totalCents: number | null; // the booked total
  gratuityCents: number | null; // inside the total
  serviceFee?: { feeCents: number | null; rate: number | null } | null; // service fee model events only
  pricePending: boolean;
  defaultDepositCents: number;
  finance: FinanceRow | null;
  payments: Payment[];
  crew: CrewPay[]; // accepted crew; empty when nobody accepted
  // Labor before anyone accepts:
  bookedBartenders: number | null;
  guests: number | null;
  scheduledMinutes: number | null; // setup, service, breakdown, from the event times
  bookedMinutes: number | null; // the same from the booked hours, when the times are missing
  defaultRateCents: number; // the event's package rate (lineRate with no own rate)
  staffingFor: (guests: number) => number;
  // Supplies:
  supplyLines: SupplyLines | null; // null: no Shopping list or no catalog
  perGuestCents: number | null; // the package's per guest estimate; null when blank
  packageLabel: string; // "Full Bar", "legacy packages": named in the settings link
  other: OtherCost[];
  reimbursements?: { kind: ReimbursementKind; cents: number }[]; // everyone's on this event
  receipts?: ApprovedReceipt[]; // approved receipts on this event
  settings: CostSettings;
}

export type PaidStatus = "paid_in_full" | "partly_paid" | "overdue" | "deposit_paid";

export type CostKey = "labor" | "burden" | "mileage" | "tips" | "supplies" | "card" | "reimbursed" | "company" | "other";
export const COST_LABEL: Record<CostKey, string> = {
  labor: "Labor",
  burden: "Payroll burden",
  mileage: "Mileage pay",
  tips: "Tips paid out",
  supplies: "Supplies",
  card: "Card processing",
  reimbursed: REIMBURSED_LABEL,
  company: COMPANY_COST_LABEL,
  other: "Other costs",
};
export const COST_KEYS: CostKey[] = ["labor", "burden", "mileage", "tips", "supplies", "card", "reimbursed", "company", "other"];

export type LaborSource = "booking" | "crew" | "actual";
export const LABOR_LABEL: Record<LaborSource, string> = { booking: "estimate from booking", crew: "estimate from crew", actual: "actual" };

export type SuppliesMethod = "manual" | "receipts" | "catalog" | "partial" | "per_guest" | "missing";
export const SUPPLIES_METHOD_LABEL: Record<SuppliesMethod, string> = {
  manual: "entered by hand",
  receipts: SUPPLIES_FROM_RECEIPTS,
  catalog: "from the shopping list",
  partial: "partly costed",
  per_guest: "estimate per guest",
  missing: "per guest estimate not set",
};

export interface CostLine {
  key: CostKey;
  label: string;
  cents: number | null; // null: not counted (mileage before the event, supplies with no estimate)
  note: string;
  href?: string; // where to fix it
}

export interface Missing {
  key: "total" | "per_guest";
  text: string;
  href: string;
}

export interface EventBusiness {
  mode: "Estimated" | "Actual"; // Actual once the event is over and labor is clocked
  revenue: {
    totalCents: number | null;
    gratuityCents: number | null;
    noGratuity: boolean; // $0 or none on file
    serviceFee: boolean; // a service fee model event: no gratuity, the fee is inside the total
    serviceFeeCents: number | null;
    serviceFeeRate: number | null; // 0.2 or 0.1
    depositPaidCents: number;
    depositPaidOn: string | null;
    depositEdited: boolean;
    payments: Payment[];
    paymentsCents: number;
    collectedCents: number; // deposit plus payments
    balanceCents: number | null; // remaining balance, never below zero; null with no total
    overpaidCents: number;
    balanceDue: string | null; // YYYY-MM-DD, 14 days before the event
    paid: PaidStatus;
    status: string; // "Partly paid, $890.00 remaining"
  };
  labor: LaborSource;
  supplies: SuppliesMethod;
  costs: CostLine[];
  costCents: number; // the costs counted, added up
  missing: Missing[];
  complete: boolean;
  profitCents: number | null; // null only with a missing item
  marginPct: number | null;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const balanceDueDate = (eventDay: string | null) => (eventDay ? addDays(eventDay, -DEPOSIT_DUE_DAYS) : null);

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Card processing on the total: percent plus the fixed fee for each charge. */
export function cardFee(totalCents: number, s: CostSettings): number {
  return Math.round((totalCents * s.cardPct) / 100) + s.cardFixedCents * CARD_CHARGES;
}

/** Payments with a balance recorded before the payments list folded in, so old data is never lost. */
export function allPayments(payments: Payment[], f: FinanceRow | null): Payment[] {
  const legacy: Payment[] = f?.balance_paid_cents ? [{ id: "legacy", cents: f.balance_paid_cents, paidOn: f.balance_paid_on, note: "Balance paid (recorded before the payments list)", recordedBy: "" }] : [];
  return [...legacy, ...payments].sort((a, b) => (a.paidOn ?? "").localeCompare(b.paidOn ?? ""));
}

/** Remaining balance, overpayment, and status. */
export function paymentStatus(totalCents: number | null, depositCents: number, paymentsCents: number, balanceDue: string | null, today: string) {
  const collected = depositCents + paymentsCents;
  const balance = totalCents === null ? null : Math.max(0, totalCents - collected);
  const overpaid = totalCents === null ? 0 : Math.max(0, collected - totalCents);
  let paid: PaidStatus;
  if (balance === 0) paid = "paid_in_full";
  else if (balanceDue && today > balanceDue) paid = "overdue";
  else if (paymentsCents > 0) paid = "partly_paid";
  else paid = "deposit_paid";
  const status = paid === "paid_in_full" ? "Paid in full" : paid === "overdue" ? "Balance overdue" : paid === "partly_paid" ? `Partly paid, ${balance === null ? "balance" : usd(balance)} remaining` : "Deposit paid, balance due";
  return { collected, balance, overpaid, paid, status };
}

/** Labor and where it came from. */
export function laborEstimate(i: Pick<BusinessInputs, "done" | "crew" | "bookedBartenders" | "guests" | "scheduledMinutes" | "bookedMinutes" | "defaultRateCents" | "staffingFor">): { cents: number; source: LaborSource; note: string } {
  const minutes = i.scheduledMinutes ?? i.bookedMinutes;
  const minutesFor = (rate: number) => Math.round((rate * (minutes ?? 0)) / 60);
  if (i.crew.length > 0) {
    if (i.done) {
      const open = i.crew.filter((c) => c.actualPayCents === null).length;
      const cents = i.crew.reduce((n, c) => n + (c.actualPayCents ?? c.estPayCents ?? minutesFor(c.rateCents)), 0);
      return { cents, source: "actual", note: open ? `${LABOR_LABEL.actual}, ${open} of ${i.crew.length} not clocked out, estimate used for them` : `${LABOR_LABEL.actual}, clocked hours` };
    }
    const cents = i.crew.reduce((n, c) => n + (c.estPayCents ?? minutesFor(c.rateCents)), 0);
    return { cents, source: "crew", note: `${LABOR_LABEL.crew}, ${i.crew.length} ${i.crew.length === 1 ? "person" : "people"} at their rates` };
  }
  const fromGuests = !i.bookedBartenders && i.guests ? i.staffingFor(i.guests) : null;
  const people = i.bookedBartenders || fromGuests || 1;
  const hours = minutes === null ? ASSUMED_SERVICE_HOURS * 60 : minutes;
  const cents = Math.round((people * i.defaultRateCents * hours) / 60);
  const who = i.bookedBartenders ? `${people} booked` : fromGuests ? `${people} for ${i.guests} guests` : "1 assumed";
  const time = minutes === null ? `${ASSUMED_SERVICE_HOURS} hours assumed, no service hours on file` : `${Math.round((minutes / 60) * 100) / 100} hours`;
  return { cents, source: "booking", note: `${LABOR_LABEL.booking}, ${who} × ${time} × ${usd(i.defaultRateCents)}/hr package rate` };
}

/**
 * Supplies and how they were worked out. Cents null only when the per guest
 * estimate is needed and blank. A hand entered amount wins; then approved
 * Supplies receipts replace the estimate.
 */
export function suppliesEstimate(
  manualCents: number | null,
  lines: SupplyLines | null,
  perGuestCents: number | null,
  guests: number | null,
  fromReceipts: { cents: number; count: number } | null = null
): { cents: number | null; method: SuppliesMethod; note: string } {
  if (manualCents !== null) {
    const extra = fromReceipts?.count ? `; ${usd(fromReceipts.cents)} in supplies receipts not added again` : "";
    return { cents: manualCents, method: "manual", note: `${SUPPLIES_METHOD_LABEL.manual}${extra}` };
  }
  if (fromReceipts && fromReceipts.count > 0) {
    return { cents: fromReceipts.cents, method: "receipts", note: `${SUPPLIES_METHOD_LABEL.receipts}, ${fromReceipts.count} ${fromReceipts.count === 1 ? "receipt" : "receipts"}` };
  }
  if (lines && lines.lines > 0 && lines.costed === lines.lines) return { cents: lines.catalogCents, method: "catalog", note: SUPPLIES_METHOD_LABEL.catalog };
  const perGuest = perGuestCents === null ? null : perGuestCents * (guests ?? 0);
  if (lines && lines.lines > 0 && lines.costed > 0) {
    const note = `${lines.costed} of ${lines.lines} items costed, rest estimated`;
    if (perGuest === null) return { cents: null, method: "missing", note };
    return { cents: lines.catalogCents + Math.round((perGuest * (lines.lines - lines.costed)) / lines.lines), method: "partial", note };
  }
  if (perGuest === null) return { cents: null, method: "missing", note: "" };
  return { cents: perGuest, method: "per_guest", note: guests ? `${SUPPLIES_METHOD_LABEL.per_guest}, ${guests} × ${usd(perGuestCents!)}` : `${SUPPLIES_METHOD_LABEL.per_guest}, no guest count on file` };
}

export function eventBusiness(i: BusinessInputs): EventBusiness {
  const missing: Missing[] = [];
  const f = i.finance;
  const total = i.totalCents;
  if (total === null) missing.push({ key: "total", text: i.pricePending ? "No booked total (price pending)" : "No booked total", href: "#total" });

  // Payments: the deposit is paid unless an admin says otherwise.
  const depositCents = f?.deposit_paid_cents ?? i.defaultDepositCents;
  const payments = allPayments(i.payments, f);
  const paymentsCents = payments.reduce((n, p) => n + p.cents, 0);
  const balanceDue = balanceDueDate(i.eventDay);
  const pay = paymentStatus(total, depositCents, paymentsCents, balanceDue, i.today);

  const labor = laborEstimate(i);
  const sf = !!i.serviceFee;
  const tips = sf ? 0 : (i.gratuityCents ?? 0);
  const recordedMileage = i.crew.some((c) => c.mileageRecorded);
  const mileageLine: CostLine = sf
    ? recordedMileage
      ? { key: "mileage", label: COST_LABEL.mileage, cents: i.crew.reduce((n, c) => n + c.mileageCents, 0), note: "recorded mileage pay, no gas estimate" }
      : { key: "mileage", label: COST_LABEL.mileage, cents: GAS_ESTIMATE_CENTS, note: `gas estimate ${usd(GAS_ESTIMATE_CENTS)}, no mileage recorded` }
    : { key: "mileage", label: COST_LABEL.mileage, cents: i.done ? i.crew.reduce((n, c) => n + c.mileageCents, 0) : null, note: i.done ? "stored mileage pay" : "after the event" };
  // Supplies reimbursements only ever come from Supplies receipts, which are counted in supplies.
  const allReimbursed = i.reimbursements ?? [];
  const reimbursements = allReimbursed.filter((r) => r.kind !== "supplies");
  const fromSupplyReceipts = allReimbursed.length - reimbursements.length;
  const covered = otherCostsCovered(i.other, reimbursements);
  const receipts = receiptCosts(i.receipts ?? []);
  const supplies = suppliesEstimate(f?.supplies_cents ?? null, i.supplyLines, i.perGuestCents, i.guests, { cents: receipts.suppliesCents, count: receipts.suppliesCount });
  const settingsText = `Set a per guest estimate for ${i.packageLabel} in Business settings`;
  if (supplies.cents === null) missing.push({ key: "per_guest", text: settingsText, href: SETTINGS_HREF });

  const costs: CostLine[] = [
    { key: "labor", label: COST_LABEL.labor, cents: labor.cents, note: labor.note },
    { key: "burden", label: COST_LABEL.burden, cents: Math.round((labor.cents * i.settings.burdenPct) / 100), note: `${i.settings.burdenPct}% of labor` },
    mileageLine,
    { key: "tips", label: COST_LABEL.tips, cents: tips, note: sf ? "none, a service fee event has no gratuity" : "the gratuity, all of it to the bartenders" },
    supplies.cents === null
      ? { key: "supplies", label: COST_LABEL.supplies, cents: null, note: `${supplies.note ? `${supplies.note}; ` : ""}set a per guest estimate in Business settings`, href: SETTINGS_HREF }
      : { key: "supplies", label: COST_LABEL.supplies, cents: supplies.cents, note: supplies.note },
    { key: "card", label: COST_LABEL.card, cents: total === null ? null : cardFee(total, i.settings), note: `${i.settings.cardPct}% + ${usd(i.settings.cardFixedCents)} a charge, confirm your rate` },
    reimbursedLine(reimbursements, fromSupplyReceipts),
    { key: "company", label: COST_LABEL.company, cents: receipts.companyCents, note: receipts.companyCount ? `${receipts.companyCount} ${receipts.companyCount === 1 ? "receipt" : "receipts"}` : "none" },
    otherLine(i.other, covered),
  ];

  const costCents = costs.reduce((n, c) => n + (c.cents ?? 0), 0);
  const complete = missing.length === 0;
  const profitCents = complete && total !== null ? total - costCents : null;
  return {
    mode: i.done && labor.source === "actual" ? "Actual" : "Estimated",
    revenue: {
      totalCents: total,
      gratuityCents: sf ? null : i.gratuityCents,
      noGratuity: !sf && !i.gratuityCents,
      serviceFee: sf,
      serviceFeeCents: sf ? (i.serviceFee?.feeCents ?? null) : null,
      serviceFeeRate: sf ? (i.serviceFee?.rate ?? null) : null,
      depositPaidCents: depositCents,
      depositPaidOn: f?.deposit_paid_on ?? null,
      depositEdited: f?.deposit_paid_cents != null,
      payments,
      paymentsCents,
      collectedCents: pay.collected,
      balanceCents: pay.balance,
      overpaidCents: pay.overpaid,
      balanceDue,
      paid: pay.paid,
      status: pay.status,
    },
    labor: labor.source,
    supplies: supplies.method,
    costs,
    costCents,
    missing,
    complete,
    profitCents,
    marginPct: profitCents !== null && total ? Math.round((profitCents / total) * 1000) / 10 : null,
  };
}

function reimbursedLine(list: { cents: number }[], suppliesLeftOut = 0): CostLine {
  const cents = list.reduce((n, r) => n + r.cents, 0);
  const base = list.length ? `${list.length} ${list.length === 1 ? "line" : "lines"}, entered on Payroll` : "none";
  const note = suppliesLeftOut ? `${base}; ${suppliesLeftOut} supplies ${suppliesLeftOut === 1 ? "receipt" : "receipts"} counted under Supplies instead` : base;
  return { key: "reimbursed", label: COST_LABEL.reimbursed, cents, note };
}

/** Other costs, leaving out any already counted in Reimbursed to staff. */
function otherLine(other: OtherCost[], covered: Set<string>): CostLine {
  const counted = other.filter((o) => !covered.has(o.id));
  const base = counted.length ? `${counted.length} ${counted.length === 1 ? "line" : "lines"}` : "none";
  const note = covered.size ? `${base}; ${covered.size} already in ${REIMBURSED_LABEL.toLowerCase()}, not counted twice` : base;
  return { key: "other", label: COST_LABEL.other, cents: counted.reduce((n, o) => n + o.cents, 0), note };
}

/** "Estimated profit" before, "Profit" after the event with actual labor; the same for costs. */
export const profitTitle = (b: Pick<EventBusiness, "mode">) => (b.mode === "Actual" ? "Profit" : "Estimated profit");
export const costsTitle = (b: Pick<EventBusiness, "mode">) => (b.mode === "Actual" ? "Costs" : "Estimated costs");

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
