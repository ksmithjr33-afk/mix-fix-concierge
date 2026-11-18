// Business for one event, from the database. Server only.
//
// Admins only: role admin, never managers. Every function here checks
// isFullAdmin first and returns nothing (or 403) for anyone else, so no
// manager or staff page or route can carry the booking total, costs, or
// profit even by mistake.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { isFullAdmin } from "@/lib/team/roles";
import { eventData } from "@/lib/team/markets";
import { chicagoToday, eventSchedule, isWeddingEvent } from "@/lib/team/time";
import { BREAKDOWN_MIN } from "@/lib/team/clock";
import { eventPackageName, lineRate, scheduledMinutes } from "@/lib/team/pay";
import { payoutSheet, type PayoutSheet } from "@/lib/team/payout-db";
import { costSettings, packageRates, suppliesSettings } from "@/lib/team/business-settings-db";
import { SUPPLY_PACKAGE_LABEL, type CostSettings, type SuppliesPerGuest, type SupplyPackage } from "@/lib/team/business-settings";
import { setPendingPrice } from "@/lib/price-pending-db";
import { DEFAULT_DEPOSIT, type BookedPrice } from "@/lib/price-change";
import { packageKey, staffingFor } from "@/lib/pricing";
import { bookedGuestCount } from "@/lib/booked-facts";
import { catalogRows, supplyCostFor, type SupplyCost } from "@/lib/team/supply-costs-db";
import type { CatalogRow } from "@/lib/team/supply-costs";
import { approvedReceiptsFor } from "@/lib/team/receipts-db";
import { allPayments, dollarsToCents, eventBusiness, isYmd, type EventBusiness, type FinanceRow, type OtherCost, type Payment } from "@/lib/team/business";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const ADMINS_ONLY = { ok: false as const, error: "Admins only.", status: 403 };
const DEFAULT_DEPOSIT_CENTS = Math.round(DEFAULT_DEPOSIT * 100);

export interface EventBusinessView {
  sessionId: string;
  business: EventBusiness;
  other: OtherCost[];
  manualSupplies: boolean;
  supplies: SupplyCost | null; // the Shopping list against the catalog, line by line
  pricePending: boolean;
  payrollCents: number; // estimated pay + mileage + tips + reimbursements for the crew, for the cash view
}

/** What the overview loads once for many events. */
export interface BusinessShared {
  settings: CostSettings;
  perGuest: SuppliesPerGuest;
  catalog: CatalogRow[];
}

const toCents = (d: unknown): number | null => (d === null || d === undefined || !Number.isFinite(Number(d)) ? null : Math.round(Number(d) * 100));

export async function financeRow(sessionId: string): Promise<FinanceRow | null> {
  const { data, error } = await supabase.from("event_finance").select("*").eq("session_id", sessionId).maybeSingle();
  if (error) return null;
  return (data as FinanceRow | null) ?? null;
}

export async function otherCosts(sessionId: string): Promise<OtherCost[]> {
  const { data, error } = await supabase.from("event_other_costs").select("id, label, cents, created_at").eq("session_id", sessionId).order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as OtherCost[]).map((o) => ({ id: o.id, label: o.label, cents: o.cents }));
}

interface PaymentRow {
  id: string;
  amount_cents: number;
  paid_on: string | null;
  note: string | null;
  created_by_name: string | null;
}

/** The payments list. Empty until the event_payments migration has run. */
export async function eventPayments(sessionId: string): Promise<Payment[]> {
  const { data, error } = await supabase.from("event_payments").select("id, amount_cents, paid_on, note, created_by_name, created_at").eq("session_id", sessionId).order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as PaymentRow[]).map((p) => ({ id: p.id, cents: p.amount_cents, paidOn: p.paid_on, note: p.note ?? "", recordedBy: p.created_by_name ?? "" }));
}

/** Service has ended (or, with no times, the day has passed). */
export function eventDone(session: SessionRow, now: Date = new Date()): boolean {
  const s = eventSchedule(eventData(session));
  if (s.end) return s.end.getTime() <= now.getTime();
  return !!s.day && s.day < now.toISOString().slice(0, 10);
}

/** Setup, the booked service hours, and breakdown, in minutes: for events with no service times. */
export function bookedMinutes(session: SessionRow, ed: Record<string, unknown>): number | null {
  const hours = Number(String(ed.hours_booked ?? session.hours_booked ?? "").match(/\d+(\.\d+)?/)?.[0] ?? NaN);
  if (!(hours > 0) || hours > 24) return null;
  return (isWeddingEvent(ed) ? 180 : 120) + Math.round(hours * 60) + BREAKDOWN_MIN;
}

/** The settings slot for an event's package: retired packages share "legacy packages". */
export function supplyPackage(name: unknown): SupplyPackage {
  const k = packageKey(name);
  return k === null ? "legacy" : (k as SupplyPackage);
}

/** The Business tab for one event. Null for anyone but an admin. Payroll hands in the payout sheet it already built. */
export async function eventBusinessFor(viewer: StaffMember, session: SessionRow, now: Date = new Date(), shared?: BusinessShared | null, built?: PayoutSheet | null): Promise<EventBusinessView | null> {
  if (!isFullAdmin(viewer.role)) return null;
  const [finance, other, payments, payout, settings, perGuest, supplies, rates, receipts] = await Promise.all([
    financeRow(session.id),
    otherCosts(session.id),
    eventPayments(session.id),
    built ?? payoutSheet(viewer, session),
    shared ? shared.settings : costSettings(viewer),
    shared ? shared.perGuest : suppliesSettings(viewer),
    supplyCostFor(viewer, session, undefined, shared?.catalog),
    packageRates(),
    approvedReceiptsFor(session.id),
  ]);
  const ed = eventData(session);
  const bp = (session.booked_price ?? null) as Partial<BookedPrice> | null;
  const total = toCents(bp?.total);
  const pkg = supplyPackage(ed.package ?? session.package_type);
  const rows = payout?.rows ?? [];
  const view = eventBusiness({
    today: chicagoToday(now),
    eventDay: eventSchedule(ed).day,
    done: eventDone(session, now),
    totalCents: total !== null && total > 0 ? total : null,
    gratuityCents: toCents(bp?.gratuity),
    pricePending: !!session.price_pending,
    defaultDepositCents: DEFAULT_DEPOSIT_CENTS,
    finance,
    payments,
    crew: rows.map((r) => ({ rateCents: r.rateCents, estPayCents: r.estPayCents, actualPayCents: r.actualPayCents, mileageCents: r.mileageCents })),
    bookedBartenders: bp?.bartenders ?? session.bartender_count ?? null,
    guests: bookedGuestCount(ed.guest_count) ?? bookedGuestCount(session.guest_count),
    scheduledMinutes: scheduledMinutes(ed),
    bookedMinutes: bookedMinutes(session, ed),
    defaultRateCents: lineRate(null, eventPackageName(ed, session), rates).cents,
    staffingFor,
    supplyLines: supplies ? { catalogCents: supplies.cents, costed: supplies.matched, lines: supplies.lines } : null,
    perGuestCents: perGuest![pkg],
    packageLabel: SUPPLY_PACKAGE_LABEL[pkg],
    other,
    reimbursements: rows.flatMap((r) => r.reimbursements.map((x) => ({ kind: x.kind, cents: x.cents }))),
    receipts,
    settings: settings!,
  });
  return {
    sessionId: session.id,
    business: view,
    other,
    manualSupplies: finance?.supplies_cents != null,
    supplies,
    pricePending: !!session.price_pending,
    payrollCents: rows.reduce((n, r) => n + (r.estPayCents ?? 0) + r.mileageCents + (r.tipsCents ?? 0) + r.reimbursementsCents, 0),
  };
}

/** Settings and the catalog, loaded once for a list of events. Null for anyone but an admin. */
export async function businessShared(admin: StaffMember): Promise<BusinessShared | null> {
  if (!isFullAdmin(admin.role)) return null;
  const [settings, perGuest, catalog] = await Promise.all([costSettings(admin), suppliesSettings(admin), catalogRows(admin)]);
  return { settings: settings!, perGuest: perGuest!, catalog };
}

async function insertPayment(admin: StaffMember, sessionId: string, cents: number, date: string, note: string): Promise<Result> {
  const { error } = await supabase.from("event_payments").insert({ session_id: sessionId, amount_cents: cents, paid_on: date, note, created_by: admin.id, created_by_name: admin.name });
  if (error) {
    console.error("[business] payment insert failed:", error.message);
    return { ok: false, error: "Could not save the payment. Try again.", status: 500 };
  }
  return { ok: true };
}

async function upsertFinance(admin: StaffMember, sessionId: string, patch: Partial<FinanceRow>): Promise<Result> {
  const { error } = await supabase.from("event_finance").upsert({ session_id: sessionId, ...patch, updated_by: admin.id, updated_at: new Date().toISOString() }, { onConflict: "session_id" });
  return error ? { ok: false, error: "Could not save. Try again.", status: 500 } : { ok: true };
}

/**
 * Admin entry on the Business tab:
 *   { action: "deposit", amount, date? }               blank amount goes back to the default deposit
 *   { action: "add_payment", amount, date?, note? }    date defaults to today
 *   { action: "edit_payment", id, amount, date?, note? }
 *   { action: "delete_payment", id }
 *   { action: "paid_in_full", date? }                  one payment for whatever balance remains
 *   { action: "supplies", amount }                     blank goes back to the estimate
 *   { action: "total", total, gratuity? }              only when the total is missing
 *   { action: "add_cost", label, amount } / { action: "remove_cost", id }
 */
export async function saveEventBusiness(admin: StaffMember, sessionId: string, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  if (!isFullAdmin(admin.role)) return ADMINS_ONLY;
  const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  const session = s as SessionRow | null;
  if (!session || session.status !== "submitted") return { ok: false, error: "We could not find that event.", status: 404 };
  const action = body.action;
  const today = chicagoToday(now);

  if (action === "deposit") {
    const blank = String(body.amount ?? "").trim() === "";
    const cents = blank ? null : dollarsToCents(body.amount);
    if (!blank && cents === null) return { ok: false, error: "Enter the deposit in dollars, like 150.", status: 400 };
    const date = blank ? null : String(body.date ?? "").trim() || null;
    if (date !== null && !isYmd(date)) return { ok: false, error: "Pick the date it was paid.", status: 400 };
    return upsertFinance(admin, sessionId, { deposit_paid_cents: cents, deposit_paid_on: date });
  }

  if (action === "add_payment" || action === "edit_payment") {
    const cents = dollarsToCents(body.amount);
    if (cents === null || cents <= 0) return { ok: false, error: "Enter the payment in dollars, like 500.", status: 400 };
    const date = String(body.date ?? "").trim() || today;
    if (!isYmd(date)) return { ok: false, error: "Pick the date it was paid.", status: 400 };
    const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (action === "add_payment") return insertPayment(admin, sessionId, cents, date, note);
    if (typeof body.id !== "string" || !body.id) return { ok: false, error: "Bad request", status: 400 };
    if (body.id === "legacy") return upsertFinance(admin, sessionId, { balance_paid_cents: cents, balance_paid_on: date });
    const { data, error } = await supabase
      .from("event_payments")
      .update({ amount_cents: cents, paid_on: date, note, updated_by: admin.id, updated_at: now.toISOString() })
      .eq("id", body.id)
      .eq("session_id", sessionId)
      .select("id");
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    return data && data.length ? { ok: true } : { ok: false, error: "That payment is gone. Reload the page.", status: 404 };
  }

  if (action === "delete_payment") {
    if (typeof body.id !== "string" || !body.id) return { ok: false, error: "Bad request", status: 400 };
    if (body.id === "legacy") return upsertFinance(admin, sessionId, { balance_paid_cents: null, balance_paid_on: null });
    const { error } = await supabase.from("event_payments").delete().eq("id", body.id).eq("session_id", sessionId);
    return error ? { ok: false, error: "Could not delete. Try again.", status: 500 } : { ok: true };
  }

  if (action === "paid_in_full") {
    const total = toCents((session.booked_price as Partial<BookedPrice> | null)?.total);
    if (!total) return { ok: false, error: "This event has no booked total yet.", status: 409 };
    const [finance, payments] = await Promise.all([financeRow(sessionId), eventPayments(sessionId)]);
    const paid = (finance?.deposit_paid_cents ?? DEFAULT_DEPOSIT_CENTS) + allPayments(payments, finance).reduce((n, p) => n + p.cents, 0);
    const remaining = total - paid;
    if (remaining <= 0) return { ok: false, error: "Nothing remains on this event.", status: 409 };
    const date = String(body.date ?? "").trim() || today;
    if (!isYmd(date)) return { ok: false, error: "Pick the date it was paid.", status: 400 };
    return insertPayment(admin, sessionId, remaining, date, "Paid in full");
  }

  if (action === "supplies") {
    const blank = String(body.amount ?? "").trim() === "";
    const cents = blank ? null : dollarsToCents(body.amount);
    if (!blank && cents === null) return { ok: false, error: "Enter the supplies amount in dollars.", status: 400 };
    return upsertFinance(admin, sessionId, { supplies_cents: cents });
  }

  if (action === "add_cost") {
    const label = String(body.label ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const cents = dollarsToCents(body.amount);
    if (label.length < 2) return { ok: false, error: "Name the cost, like Glass rental.", status: 400 };
    if (cents === null || cents <= 0) return { ok: false, error: "Enter the amount in dollars.", status: 400 };
    const { error } = await supabase.from("event_other_costs").insert({ session_id: sessionId, label, cents, created_by: admin.id });
    return error ? { ok: false, error: "Could not save. Try again.", status: 500 } : { ok: true };
  }

  if (action === "remove_cost") {
    if (typeof body.id !== "string") return { ok: false, error: "Bad request", status: 400 };
    const { error } = await supabase.from("event_other_costs").delete().eq("id", body.id).eq("session_id", sessionId);
    return error ? { ok: false, error: "Could not save. Try again.", status: 500 } : { ok: true };
  }

  if (action === "total") {
    const bp = (session.booked_price ?? null) as BookedPrice | null;
    const hasGratuity = bp?.gratuity !== null && bp?.gratuity !== undefined;
    const gratRaw = String(body.gratuity ?? "").trim();
    const grat = gratRaw ? dollarsToCents(gratRaw) : null;
    if (gratRaw && grat === null) return { ok: false, error: "Enter the gratuity in dollars, or leave it blank.", status: 400 };
    // Price pending: set it the normal way, which clears price pending and sends the change order.
    if (session.price_pending) {
      const r = await setPendingPrice(sessionId, body.total, admin, now);
      if (!r.ok) return r;
      if (grat !== null && !hasGratuity) await setGratuity(sessionId, grat / 100);
      return { ok: true };
    }
    if (bp?.total) return { ok: false, error: "This event already has a total. Change it from Details.", status: 409 };
    const cents = dollarsToCents(body.total, 100_000);
    if (cents === null || cents <= 0) return { ok: false, error: "Type the total in dollars, like 1850.", status: 400 };
    if (grat !== null && grat > cents) return { ok: false, error: "The gratuity is part of the total, so it cannot be more than the total.", status: 400 };
    const prior: BookedPrice = bp ?? { package_price: null, gratuity: null, total: null, bartenders: null, promo_code: null, custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: DEFAULT_DEPOSIT, source: "update" };
    const nowIso = now.toISOString();
    const { data, error } = await supabase
      .from("sessions")
      .update({
        booked_price: { ...prior, total: cents / 100, ...(grat !== null && !hasGratuity ? { gratuity: grat / 100 } : {}), source: "update", updated_at: nowIso },
        price_set_at: nowIso,
        price_set_by: admin.id,
        price_set_by_name: admin.name,
        price_set_total: cents / 100,
        updated_at: nowIso,
      })
      .eq("id", sessionId)
      .eq("version", session.version)
      .select("id");
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    if (!data || data.length === 0) return { ok: false, error: "The event changed while you were typing. Reload and try again.", status: 409 };
    return { ok: true };
  }

  return { ok: false, error: "Bad request", status: 400 };
}

async function setGratuity(sessionId: string, dollars: number): Promise<void> {
  const { data } = await supabase.from("sessions").select("booked_price").eq("id", sessionId).maybeSingle();
  const bp = ((data as { booked_price: BookedPrice | null } | null)?.booked_price ?? null) as BookedPrice | null;
  if (!bp || (bp.gratuity !== null && bp.gratuity !== undefined)) return;
  await supabase.from("sessions").update({ booked_price: { ...bp, gratuity: dollars } }).eq("id", sessionId);
}
