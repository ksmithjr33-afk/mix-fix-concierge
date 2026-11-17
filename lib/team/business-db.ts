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
import { eventSchedule } from "@/lib/team/time";
import { payoutSheet } from "@/lib/team/payout-db";
import { costSettings } from "@/lib/team/business-settings-db";
import { setPendingPrice } from "@/lib/price-pending-db";
import { DEFAULT_DEPOSIT, type BookedPrice } from "@/lib/price-change";
import { supplyCostFor, type SupplyCost } from "@/lib/team/supply-costs-db";
import { dollarsToCents, eventBusiness, isYmd, type EventBusiness, type FinanceRow, type OtherCost } from "@/lib/team/business";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const ADMINS_ONLY = { ok: false as const, error: "Admins only.", status: 403 };

export interface EventBusinessView {
  sessionId: string;
  business: EventBusiness;
  other: OtherCost[];
  manualSupplies: boolean;
  supplies: SupplyCost | null; // the catalog estimate, line by line
  bookedDepositCents: number | null;
  pricePending: boolean;
  payrollCents: number; // estimated pay + mileage + tips for the crew, for the cash view
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

/** Service has ended (or, with no times, the day has passed). */
export function eventDone(session: SessionRow, now: Date = new Date()): boolean {
  const s = eventSchedule(eventData(session));
  if (s.end) return s.end.getTime() <= now.getTime();
  return !!s.day && s.day < now.toISOString().slice(0, 10);
}

/** The Business tab for one event. Null for anyone but an admin. */
export async function eventBusinessFor(viewer: StaffMember, session: SessionRow, now: Date = new Date()): Promise<EventBusinessView | null> {
  if (!isFullAdmin(viewer.role)) return null;
  const [finance, other, payout, settings, supplies] = await Promise.all([financeRow(session.id), otherCosts(session.id), payoutSheet(viewer, session), costSettings(viewer), supplyCostFor(viewer, session)]);
  const bp = (session.booked_price ?? null) as Partial<BookedPrice> | null;
  const total = toCents(bp?.total);
  const view = eventBusiness({
    eventDay: eventSchedule(eventData(session)).day,
    done: eventDone(session, now),
    totalCents: total !== null && total > 0 ? total : null,
    gratuityCents: toCents(bp?.gratuity),
    bookedDepositCents: toCents(bp?.deposit_paid),
    pricePending: !!session.price_pending,
    finance,
    payout: payout && payout.rows.length ? payout.totals : null,
    crewExpected: bp?.bartenders ?? null,
    suppliesEstimateCents: supplies?.cents ?? null,
    suppliesUnmatched: supplies?.unmatched.length ?? 0,
    other,
    settings: settings!,
  });
  return {
    sessionId: session.id,
    business: view,
    other,
    manualSupplies: finance?.supplies_cents != null,
    supplies,
    bookedDepositCents: toCents(bp?.deposit_paid),
    pricePending: !!session.price_pending,
    payrollCents: payout?.rows.reduce((n, r) => n + (r.estPayCents ?? 0) + r.mileageCents + (r.tipsCents ?? 0), 0) ?? 0,
  };
}

async function upsertFinance(admin: StaffMember, sessionId: string, patch: Partial<FinanceRow>): Promise<Result> {
  const { error } = await supabase.from("event_finance").upsert({ session_id: sessionId, ...patch, updated_by: admin.id, updated_at: new Date().toISOString() }, { onConflict: "session_id" });
  return error ? { ok: false, error: "Could not save. Try again.", status: 500 } : { ok: true };
}

/**
 * Admin entry on the Business tab:
 *   { action: "deposit" | "balance", amount, date }  blank amount clears it
 *   { action: "supplies", amount }                   blank goes back to the catalog estimate
 *   { action: "total", total, gratuity? }            only when the total is missing
 *   { action: "add_cost", label, amount } / { action: "remove_cost", id }
 */
export async function saveEventBusiness(admin: StaffMember, sessionId: string, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  if (!isFullAdmin(admin.role)) return ADMINS_ONLY;
  const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  const session = s as SessionRow | null;
  if (!session || session.status !== "submitted") return { ok: false, error: "We could not find that event.", status: 404 };
  const action = body.action;

  if (action === "deposit" || action === "balance") {
    const blank = String(body.amount ?? "").trim() === "";
    const cents = blank ? null : dollarsToCents(body.amount);
    if (!blank && cents === null) return { ok: false, error: "Enter the amount in dollars, like 150.", status: 400 };
    const date = blank ? null : String(body.date ?? "").trim() || now.toISOString().slice(0, 10);
    if (date !== null && !isYmd(date)) return { ok: false, error: "Pick the date it was paid.", status: 400 };
    return upsertFinance(admin, sessionId, action === "deposit" ? { deposit_paid_cents: cents, deposit_paid_on: date } : { balance_paid_cents: cents, balance_paid_on: date });
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
