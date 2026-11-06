// Applies a signed change order. GHL calls this when the client signs:
//   POST /api/manager-update
//   X-Manager-Secret: <MANAGER_UPDATE_SECRET>
//   { "email": "client@example.com" }
// The session's pending_change is merged into event_data as a new applied
// event_updates row (source manager, "Change order signed"), the booked price
// moves to the change order total, pending_change is cleared, and the version
// goes up. The regenerated documents come back in the response. This route
// never fires the GHL update webhook.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { applyChanges, type EventData } from "@/lib/event-diff";
import { buildEventFields, buildNatalieSupplyList } from "@/lib/ghl-payload";
import type { SessionRow } from "@/lib/event-updates";
import { signedChanges, toCount, withHoursBooked, type BookedPrice } from "@/lib/change-order";

function secretMatches(given: string | null): boolean {
  const expected = process.env.MANAGER_UPDATE_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function findSession(email: string): Promise<SessionRow | null> {
  const lower = email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("status", "submitted")
    .not("pending_change", "is", null);
  if (error) throw new Error(`sessions lookup failed: ${error.message}`);
  const matches = ((data as SessionRow[]) ?? []).filter(
    (s) =>
      (s.email ?? "").trim().toLowerCase() === lower ||
      String(s.event_data?.email ?? "").trim().toLowerCase() === lower
  );
  matches.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  return matches[0] ?? null;
}

export async function POST(request: Request) {
  if (!process.env.MANAGER_UPDATE_SECRET) {
    console.error("[manager-update] MANAGER_UPDATE_SECRET is not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (!secretMatches(request.headers.get("x-manager-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email: string;
  try {
    const body = await request.json();
    email = typeof body?.email === "string" ? body.email : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!email.trim()) return NextResponse.json({ error: "email is required" }, { status: 400 });

  try {
    const session = await findSession(email);
    if (!session || !session.event_data || !session.pending_change) {
      return NextResponse.json({ error: "No pending change order for this email" }, { status: 404 });
    }

    const pending = session.pending_change;
    const prior: Partial<BookedPrice> = session.booked_price ?? {};
    // Stored hours and bartenders follow what was signed, even when the client did not ask for them directly.
    const stored = withHoursBooked(session.event_data, session);
    const changes = signedChanges(stored, pending, prior.bartenders ?? null);
    const next: EventData = applyChanges(stored, changes);
    const version = session.version + 1;
    const nowIso = new Date().toISOString();

    const booked: BookedPrice = {
      package_price: pending.package_price ?? prior.package_price ?? null,
      gratuity: pending.gratuity ?? prior.gratuity ?? null,
      total: pending.new_total ?? prior.total ?? null,
      bartenders: toCount(next.bartenders) ?? prior.bartenders ?? null,
      promo_code: prior.promo_code ?? null,
      custom_price: prior.custom_price ?? null,
      discount_amount: prior.discount_amount ?? null,
      tip_jar: prior.tip_jar ?? true,
      deposit_paid: prior.deposit_paid ?? pending.deposit_paid,
      source: "change-order",
      // The next change order is priced against the event as signed.
      basis: pending.basis ?? prior.basis ?? null,
      class49_used: Boolean(prior.class49_used || pending.class49_applied),
      updated_at: nowIso,
    };

    const sessionUpdate: Record<string, unknown> = {
      event_data: next,
      version,
      updated_at: nowIso,
      pending_change: null,
      booked_price: booked,
    };
    // Keep the summary columns in step with the signed event.
    if (next.event_date !== undefined) sessionUpdate.event_date = next.event_date;
    if (next.guest_count !== undefined) sessionUpdate.guest_count = String(next.guest_count);
    if (next.package !== undefined) sessionUpdate.package_type = next.package;
    if (next.hours_booked !== undefined) sessionUpdate.hours_booked = String(next.hours_booked);

    // Only succeeds if nothing changed the session since we read it.
    const { data: updated, error: updateError } = await supabase
      .from("sessions")
      .update(sessionUpdate)
      .eq("id", session.id)
      .eq("version", session.version)
      .select("id");
    if (updateError) throw new Error(`sessions update failed: ${updateError.message}`);
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "Session changed while applying, try again" }, { status: 409 });
    }

    const { error: insertError } = await supabase.from("event_updates").insert({
      session_id: session.id,
      version,
      source: "manager",
      changes,
      summary: "Change order signed",
      within_deadline: true,
      applied: true,
    });
    if (insertError) console.error(`[manager-update] session ${session.id} history insert failed:`, insertError.message);

    const { cleanEventData, fields } = buildEventFields(next);
    console.log(`[manager-update] session ${session.id} change order signed, v${version}, total ${booked.total}`);

    return NextResponse.json({
      success: true,
      session_id: session.id,
      version,
      booked_total: booked.total,
      booked_price: booked,
      remaining_balance: booked.total !== null ? booked.total - booked.deposit_paid : null,
      event_data: cleanEventData,
      ...fields,
      shopping_list_email: fields.shopping_list_email,
      natalie_supply_list: buildNatalieSupplyList(next) || null,
      order_team_email: fields.order_team_email,
      isabel_summary: fields.isabel_summary,
    });
  } catch (err) {
    console.error("[manager-update] error:", err);
    return NextResponse.json({ error: "Failed to apply the change order" }, { status: 500 });
  }
}
