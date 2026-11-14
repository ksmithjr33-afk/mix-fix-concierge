// Price pending, the database side (lib/price-pending.ts). Server only.
//
// textPricePending: the admins' one text when a change is saved without a price.
// setPendingPrice:  an admin types the new total on the manager view. It clears
//                   price pending, records who set it, moves the booked total,
//                   and sends the normal change order update to GHL
//                   (pending_change_new_total, the difference, payment_preference).
// pricePendingList: every event waiting for a price, for the Staffing page.

import { supabase } from "@/lib/supabase";
import { getSession, type EventUpdateRow, type SessionRow } from "@/lib/event-updates";
import { changeBlocks } from "@/lib/event-diff";
import { DEFAULT_DEPOSIT, money, priceText, type BookedPrice, type PriceChange } from "@/lib/price-change";
import { pendingAdminText, pendingSummary, type PricePendingInfo } from "@/lib/price-pending";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { alertAdmins } from "@/lib/team/events";
import { sendStaffText } from "@/lib/team/sms";
import { eventSchedule, shortDate } from "@/lib/team/time";
import { eventData } from "@/lib/team/markets";
import { siteOrigin } from "@/lib/team/clock-db";
import { managerHref } from "@/lib/team/manager-tabs";

/** Text every admin who gets alerts, right away. Returns how many texts went. Never throws. */
export async function textPricePending(session: SessionRow, info: PricePendingInfo): Promise<number> {
  try {
    const ed = eventData(session);
    const message = pendingAdminText({
      client: String(ed.client_name ?? session.name ?? ""),
      date: shortDate(eventSchedule(ed).day),
      info,
      link: `${siteOrigin()}${managerHref(session.id)}`,
    });
    const admins = await alertAdmins();
    const sent = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
    const n = sent.filter(Boolean).length;
    if (n === 0) console.error(`[price-pending] session ${session.id}: no admin text went out. The change is saved and price pending.`);
    return n;
  } catch (err) {
    console.error(`[price-pending] session ${session.id} admin text failed:`, err instanceof Error ? err.message : String(err));
    return 0;
  }
}

/** A price the client mentions after the change was saved, added to the summary. Never throws. */
export async function recordClientQuoted(session: SessionRow, quoted: string): Promise<void> {
  const info = session.price_pending_info;
  if (!session.price_pending || !info || info.client_quoted === quoted) return;
  const { error } = await supabase.from("sessions").update({ price_pending_info: { ...info, client_quoted: quoted } }).eq("id", session.id).eq("price_pending", true);
  if (error) console.error(`[price-pending] session ${session.id} quoted price not recorded:`, error.message);
}

export type SetPriceResult = { ok: true; total: number; amount: number | null } | { ok: false; error: string; status: number };

/** An admin sets the new total for an event waiting for a price. */
export async function setPendingPrice(
  sessionId: string,
  rawTotal: unknown,
  admin: { id: string; name: string; role: string },
  now: Date = new Date()
): Promise<SetPriceResult> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const total = typeof rawTotal === "number" ? rawTotal : parseFloat(String(rawTotal ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(total) || total <= 0 || total > 100_000) return { ok: false, error: "Type the new total in dollars, like 1850.", status: 400 };
  const newTotal = Math.round(total * 100) / 100;

  const session = await getSession(sessionId);
  if (!session || session.status !== "submitted") return { ok: false, error: "We could not find that event.", status: 404 };
  if (!session.price_pending || !session.price_pending_info) return { ok: false, error: "This event has no price waiting.", status: 409 };
  const info = session.price_pending_info;
  const changes = info.items.flatMap((i) => i.changes);
  const prior: BookedPrice = session.booked_price ?? {
    package_price: null, gratuity: null, total: null, bartenders: null, promo_code: null,
    custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: DEFAULT_DEPOSIT, source: "computed",
  };
  const oldTotal = info.old_total ?? prior.total ?? null;
  const amount = oldTotal !== null ? Math.round((newTotal - oldTotal) * 100) / 100 : null;
  const nowIso = now.toISOString();
  const price: PriceChange = {
    changes,
    implied: [],
    requested_at: nowIso,
    base_version: session.version,
    amount,
    new_total: newTotal,
    package_price: null,
    gratuity: prior.gratuity,
    price_text: amount !== null ? priceText(amount, newTotal) : `Your new total is ${money(newTotal)}.`,
    summary: changeBlocks(changes).join("\n\n"),
    basis: null,
    class49_applied: false,
    booked_total: oldTotal,
    deposit_paid: prior.deposit_paid ?? DEFAULT_DEPOSIT,
  };
  const firstName = admin.name.trim().split(/\s+/)[0] || "An admin";

  // Only if nothing changed since it was read, and it is still waiting.
  const { data, error } = await supabase
    .from("sessions")
    .update({
      booked_price: { ...prior, total: newTotal, custom_price: newTotal, source: "update", updated_at: nowIso },
      price_pending: false,
      price_set_at: nowIso,
      price_set_by: admin.id,
      price_set_by_name: admin.name,
      price_set_total: newTotal,
      version: session.version + 1,
      updated_at: nowIso,
    })
    .eq("id", sessionId)
    .eq("version", session.version)
    .eq("price_pending", true)
    .select("id");
  if (error) return { ok: false, error: `Could not save: ${error.message}`, status: 500 };
  if (!data || data.length === 0) return { ok: false, error: "The event changed while you were typing. Reload and try again.", status: 409 };

  const { data: rows, error: insErr } = await supabase
    .from("event_updates")
    .insert({
      session_id: sessionId,
      version: session.version + 1,
      source: "manager",
      changes: [],
      summary: `New total set by ${firstName}: ${money(newTotal)}`,
      within_deadline: true,
      applied: true,
      change_order: price,
      updated_by: "admin",
      updated_by_name: firstName,
      updated_by_staff_id: admin.id,
    })
    .select("*");
  if (insErr) {
    console.error(`[price-pending] session ${sessionId} price row failed:`, insErr.message);
    return { ok: true, total: newTotal, amount };
  }
  // The normal change order flow: GHL gets the new total, the difference and the payment preference.
  await deliverEventUpdates(sessionId, (rows as EventUpdateRow[]) ?? [], {
    extra: {
      pending_change_summary: price.summary,
      pending_change_fields: [...new Set(changes.map((c) => c.field))].join(", "),
      price_set_by_name: admin.name,
    },
  }).catch((err) => console.error(`[price-pending] session ${sessionId} GHL update failed:`, err));
  return { ok: true, total: newTotal, amount };
}

export interface PricePendingAlert {
  sessionId: string;
  name: string;
  summary: string;
  since: string | null;
}

/** Every event waiting for a price, oldest first. Empty before the migration runs. */
export async function pricePendingList(): Promise<PricePendingAlert[]> {
  const { data, error } = await supabase.from("sessions").select("id, name, event_data, price_pending_info, price_pending_at").eq("price_pending", true);
  if (error) return [];
  return ((data as (SessionRow & { price_pending_at: string | null })[]) ?? [])
    .map((s) => ({
      sessionId: s.id,
      name: String(s.event_data?.client_name ?? s.name ?? "Unknown client"),
      summary: pendingSummary(s.price_pending_info),
      since: s.price_pending_at,
    }))
    .sort((a, b) => String(a.since).localeCompare(String(b.since)));
}
