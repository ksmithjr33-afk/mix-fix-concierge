// Database side of an event an admin adds by hand. Server only, admins only.
//
// "Save as a confirmed event" records the event exactly the way the concierge
// does when a client finishes: the session row with event_data as version 1
// (recordSubmission), the events table row, the GHL intake payload and note,
// its market from the address, and the shopping list sync. Everything else
// (the events list, calendar, supplies list, checklist, recipes, assignments,
// time clock, wrap up, admin edits and client updates) reads that row, so it
// works as normal from there.
//
// "Save and send the client the concierge link" creates the booking only, like
// /api/create-session, and returns the link for the admin to copy.
//
// Neither one messages the client: the GHL payloads say created_by "admin"
// with the admin's name, and client_shopping_list_send is false unless the
// admin ticked "Send the client their list".

import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { eventsInsertRow } from "@/lib/events-row";
import { getSession, recordSubmission, type SessionRow } from "@/lib/event-updates";
import { buildEventFields } from "@/lib/ghl-payload";
import { createNoteByEmail } from "@/lib/ghl-api";
import { generateShoppingList, formatShoppingList } from "@/lib/shopping-list";
import { completionFields } from "@/lib/client-list-db";
import { quietly } from "@/lib/client-list";
import { createdByFields } from "@/lib/update-notes";
import { DEFAULT_DEPOSIT, toBool, toMoney, type BookedPrice } from "@/lib/price-change";
import { ensureMarket } from "@/lib/team/markets-db";
import { syncOrderSheet } from "@/lib/order-sheet-db";
import { siteOrigin } from "@/lib/team/clock-db";
import { managerHref } from "@/lib/team/manager-tabs";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { eventDay, todayIn, TZ } from "@/lib/team/time";
import { cleanManualEvent, type CleanManual } from "@/lib/manual-event";
import { isAdminRole } from "@/lib/team/roles";
import { isCalendarOnly } from "@/lib/calendar-only";
import type { PricingModel } from "@/lib/pricing-model";
import { FEE_BP_STANDARD, feeBp, serviceFeePackage, splitFromCustom } from "@/lib/service-fee";

export type AddResult =
  | { ok: true; id: string; mode: "confirmed"; managerUrl: string }
  | { ok: true; id: string; mode: "link"; link: string }
  | { ok: false; error: string; status: number; duplicate?: { id: string; title: string; status: string }[] };

/**
 * The booked price from the optional price fields, the same way /api/create-session reads them.
 * On the service fee model the total is split like a booking with a custom price: the
 * service fee is carved out of the total less add ons (20%, 10% on Premium). No gratuity.
 */
export function bookedPrice(f: Record<string, unknown>, model: PricingModel = "gratuity", pkg: unknown = null, nowIso: string = new Date().toISOString()): BookedPrice | null {
  const keys = ["package_price", "gratuity", "total", "promo_code", "discount_amount", "deposit_paid", "addons_total"];
  if (!keys.some((k) => f[k] !== undefined && f[k] !== null && String(f[k]).trim() !== "")) return null;
  const promo = typeof f.promo_code === "string" && f.promo_code.trim() ? f.promo_code.trim().toUpperCase() : null;
  if (model === "service_fee") {
    const total = toMoney(f.total);
    const addons = toMoney(f.addons_total) ?? 0;
    const key = serviceFeePackage(pkg);
    const bp = key ? feeBp(key) : FEE_BP_STANDARD;
    const split = total !== null && total > 0 ? splitFromCustom(Math.max(0, Math.round(total * 100) - Math.round(addons * 100)), bp, Math.round(addons * 100)) : null;
    return {
      pricing_model: "service_fee",
      total,
      package_price: split ? split.packageCents / 100 : null,
      service_fee: split ? split.feeCents / 100 : null,
      service_fee_rate: bp / 10000,
      addons_total: addons,
      gratuity: null,
      bartenders: toMoney(f.bartenders),
      promo_code: promo,
      custom_price: null,
      discount_amount: toMoney(f.discount_amount),
      tip_jar: toBool(f.tip_jar, true),
      deposit_paid: toMoney(f.deposit_paid) ?? DEFAULT_DEPOSIT,
      split_method: split ? "carved" : null,
      source: "create-session",
      updated_at: nowIso,
    } as BookedPrice;
  }
  return {
    package_price: toMoney(f.package_price),
    gratuity: toMoney(f.gratuity),
    total: toMoney(f.total),
    bartenders: toMoney(f.bartenders),
    promo_code: promo,
    custom_price: null,
    discount_amount: toMoney(f.discount_amount),
    tip_jar: toBool(f.tip_jar, true),
    deposit_paid: toMoney(f.deposit_paid) ?? DEFAULT_DEPOSIT,
    source: "create-session",
    updated_at: nowIso,
  };
}

/** Other events (finished or not) for the same client email on the same day. */
export async function sameClientSameDay(email: string, day: string): Promise<{ id: string; title: string; status: string }[]> {
  const { data, error } = await supabase.from("sessions").select("*");
  if (error || !data) return [];
  return (data as SessionRow[])
    .filter((s) => {
      const mail = String(s.event_data?.email ?? s.email ?? "").trim().toLowerCase();
      return mail === email && eventDay(s.event_data?.event_date ?? s.event_date) === day;
    })
    .map((s) => ({ id: s.id, title: String(s.event_data?.event_name || s.event_name || s.event_data?.client_name || s.name || "Event"), status: s.status }));
}

async function newId(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const id = crypto.randomBytes(4).toString("hex");
    const { data } = await supabase.from("sessions").select("id").eq("id", id).maybeSingle();
    if (!data) return id;
  }
  return crypto.randomBytes(6).toString("hex");
}

/** The events table row the concierge's /api/save-event writes, without a transcript. */
async function saveEventRow(eventData: Record<string, unknown>): Promise<void> {
  const items = quietly(() => {
    try {
      return generateShoppingList(eventData as unknown as Parameters<typeof generateShoppingList>[0]);
    } catch {
      return [];
    }
  });
  const { error } = await supabase.from("events").insert({
    ...eventsInsertRow(eventData).row,
    shopping_list: items.length > 0 ? items : null,
    shopping_list_text: items.length > 0 ? formatShoppingList(items) : null,
    conversation_transcript: null,
    status: "new",
    ghl_webhook_sent: false,
    ghl_webhook_response: null,
    menu_colors: eventData.menu_colors || null,
    menu_reference_photos: eventData.menu_reference_photos || null,
  });
  if (error) console.error("[manual-event] events insert failed:", error.message);
}

/** The intake payload GHL gets when a client finishes the concierge, marked as added by an admin. */
async function postIntake(session: SessionRow): Promise<void> {
  if (isCalendarOnly(session)) return; // calendar only: nothing to GHL, ever
  const eventData = session.event_data ?? {};
  const { cleanEventData, fields } = quietly(() => buildEventFields(eventData));
  const listFields = await completionFields(session.id).catch((err) => {
    console.error("[manual-event] client list decision failed:", err);
    return null;
  });
  const payload: Record<string, unknown> = {
    ...cleanEventData,
    conversation_transcript: null,
    conversation_summary: null,
    ...fields,
    client_shopping_list_send: false,
    client_shopping_list_reason: "",
    client_shopping_list_changes: "",
    client_shopping_list_url: "",
    client_shopping_list_text: "",
    list_change_declined: false,
    order_sheet_url: "",
    ...(listFields ?? {}),
    ...createdByFields(session),
  };
  if (!payload.email && session.email) payload.email = session.email;
  const url = process.env.GHL_WEBHOOK_URL;
  if (!url) {
    console.error("[manual-event] GHL_WEBHOOK_URL is not set, intake payload NOT sent");
  } else {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) console.error(`[manual-event] GHL webhook responded ${res.status}`);
    } catch (err) {
      console.error("[manual-event] GHL webhook failed:", err instanceof Error ? err.message : String(err));
    }
  }
  // The team's note on the contact, like intake. A note is internal, never a message to the client.
  if (fields.isabel_summary && payload.email) {
    await createNoteByEmail(String(payload.email), `Added by hand by ${createdByFields(session).created_by_name || "an admin"}\n\n${fields.isabel_summary}`).catch(() => null);
  }
}

/** Add an event by hand. Admins only, checked here as well as in the route. */
export async function addManualEvent(admin: StaffMember, raw: unknown, now: Date = new Date()): Promise<AddResult> {
  if (!isAdminRole(admin.role)) return { ok: false, error: "Admins only.", status: 403 };
  const clean = cleanManualEvent(raw, todayIn(TZ, now));
  if (!clean.ok) return { ok: false, error: clean.error, status: 400 };
  const v: CleanManual = clean.value;
  const f = raw as Record<string, unknown>;

  // The same client email on the same day: warn first, save only when the admin says so.
  const duplicate = await sameClientSameDay(v.email, v.day);
  if (duplicate.length > 0 && f.confirm_duplicate !== true) {
    return { ok: false, status: 409, duplicate, error: `There is already ${duplicate.length === 1 ? "an event" : `${duplicate.length} events`} for ${v.email} on this date. Save anyway?` };
  }

  const id = await newId();
  const byName = firstName(admin.name) || admin.name || "Admin";
  const price = bookedPrice({ ...v.priceFields }, v.pricingModel, v.booking.package_type, now.toISOString());
  const row = {
    id,
    ...v.booking,
    ...(price ? { booked_price: price } : {}),
    pricing_model: v.pricingModel,
    booked_on: v.bookedOn,
    // Service fee model: the tip jar, in the same column the booking webhook writes (the staff Details line reads it).
    ...(v.tipJar !== null ? { tip_jar: v.tipJar } : {}),
    created_by: "admin",
    created_by_name: byName,
    created_by_staff_id: admin.id,
    send_client_list: v.sendList,
    ...(v.calendarOnly ? { calendar_only: true } : {}),
  };
  let { error } = await supabase.from("sessions").insert(row);
  if (error && /booked_on/.test(error.message ?? "")) {
    // supabase/migrations/20270104_booked_on.sql not run yet: save without the date, the model is still stored.
    console.error("[manual-event] sessions.booked_on missing (run supabase/migrations/20270104_booked_on.sql). Saved without it.");
    ({ error } = await supabase.from("sessions").insert({ ...row, booked_on: undefined }));
  }
  if (error) {
    console.error("[manual-event] session insert failed:", error.message);
    return { ok: false, error: "Could not save. Try again.", status: 500 };
  }

  if (v.mode === "link") {
    return { ok: true, id, mode: "link", link: `${siteOrigin()}/s?id=${encodeURIComponent(id)}` };
  }

  // Exactly as if the client had completed the concierge.
  if (!(await recordSubmission(id, v.eventData))) return { ok: false, error: "Could not save. Try again.", status: 500 };
  const session = await getSession(id);
  if (!session) return { ok: false, error: "Could not save. Try again.", status: 500 };
  await saveEventRow(session.event_data ?? v.eventData);
  // Calendar only: nothing to GHL (no intake webhook, no contact note), so nothing reaches the client.
  if (!isCalendarOnly(session)) await postIntake(session);
  await ensureMarket(session).catch(() => null);
  await syncOrderSheet(session).catch((err) => console.error("[manual-event] shopping list sync failed:", err));
  return { ok: true, id, mode: "confirmed", managerUrl: managerHref(id) };
}

export type TurnOnResult = { ok: true; sent: boolean } | { ok: false; error: string; status: number };

/**
 * "Turn on client messages" on a calendar only event: clears calendar_only and
 * sends the normal intake payload once. A second tap (or two admins at once)
 * finds it already on and sends nothing. Admins and managers only.
 */
export async function turnOnClientMessages(admin: StaffMember, sessionId: string, now: Date = new Date()): Promise<TurnOnResult> {
  if (!isAdminRole(admin.role)) return { ok: false, error: "Admins only.", status: 403 };
  const { data, error } = await supabase
    .from("sessions")
    .update({ calendar_only: false, client_messages_on_at: now.toISOString(), client_messages_on_by: firstName(admin.name) || admin.name || "Admin" })
    .eq("id", sessionId)
    .eq("calendar_only", true)
    .select("id");
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  if (((data as unknown[]) ?? []).length === 0) return { ok: true, sent: false }; // already on
  const session = await getSession(sessionId);
  if (session && session.status === "submitted") await postIntake(session);
  return { ok: true, sent: true };
}
