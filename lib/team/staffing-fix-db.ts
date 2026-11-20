// The staffing corrections an admin or manager saves from the event page,
// with no price change. Server only. The rules are in lib/team/staffing-fix.ts
// and lib/package-extras.ts.
//
// Neither one writes an event_updates row, sends the GHL update webhook, texts
// the client or staff, or touches the booked total:
// - Bartenders needed writes only sessions.package_extras (and closes an open
//   shift post the new number fills, which texts only staff who asked for it).
// - "A barback was not part of this booking" (and its no charge undo) writes
//   event_data.barback, the barback in the booked price's basis (so the next
//   priced change is priced from the booking as sold), and package_extras. It
//   bumps the version so a save in flight from an older read cannot undo it.

import { supabase } from "@/lib/supabase";
import { getSubmittedSession } from "@/lib/team/events";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { barbackStatus, BARBACK_INCLUDED, BARBACK_REMOVED } from "@/lib/package-extras";
import { computeBaseline, withHoursBooked, type BookedPrice } from "@/lib/price-change";
import { bartendersExtras, canFixStaffing, cleanBartenders, withLog } from "@/lib/team/staffing-fix";
import type { SessionRow } from "@/lib/event-updates";
import { closeIfFilled } from "@/lib/team/shifts-db";

export type FixResult = { ok: true } | { ok: false; error: string; status: number };

const NOT_FOUND: FixResult = { ok: false, error: "We could not find that event.", status: 404 };
const ADMINS_ONLY: FixResult = { ok: false, error: "Admins only.", status: 403 };

function extrasOf(session: SessionRow): Record<string, unknown> {
  const x = (session as { package_extras?: unknown }).package_extras;
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

/** Set bartenders needed (1 to 4), or null to go back to the booking's number. Staffing only. */
export async function setBartendersNeeded(sessionId: string, staff: StaffMember, raw: unknown): Promise<FixResult> {
  if (!canFixStaffing(staff.role)) return ADMINS_ONLY;
  const value = raw === null ? null : cleanBartenders(raw);
  if (raw !== null && value === null) return { ok: false, error: "Pick 1 to 4 bartenders.", status: 400 };
  const session = await getSubmittedSession(sessionId);
  if (!session) return NOT_FOUND;
  const extras = bartendersExtras(session, value, firstName(staff.name) || "an admin", new Date().toISOString());
  const { error } = await supabase.from("sessions").update({ package_extras: extras }).eq("id", sessionId);
  if (error) throw new Error(`bartenders needed save failed: ${error.message}`);
  // An open shift post now covered by the new number closes, as when its last spot is filled.
  await closeIfFilled({ ...session, package_extras: extras } as SessionRow).catch((err) => console.error(`[staffing] ${sessionId}: open post check failed:`, err));
  return { ok: true };
}

/** The booked price with the barback in its basis set, the total unchanged. Null when there is none to keep. */
function bookedWithBarback(session: SessionRow, on: boolean): BookedPrice | null {
  const bp = session.booked_price;
  if (bp && typeof bp.total === "number") {
    return bp.basis ? { ...bp, basis: { ...bp.basis, barback: on } } : bp;
  }
  // No stored total: freeze the one the pages show now, so the flip cannot move it.
  if (!session.event_data) return null;
  const computed = computeBaseline(withHoursBooked(session.event_data, session), session, {
    promoCode: bp?.promo_code ?? null,
    tipJar: bp?.tip_jar ?? true,
  });
  if (!computed) return null;
  if (bp?.deposit_paid) computed.deposit_paid = bp.deposit_paid;
  return { ...computed, basis: computed.basis ? { ...computed.basis, barback: on } : null };
}

/**
 * notBooked true: "A barback was not part of this booking". notBooked false:
 * "Add the barback at no charge", only from that state. No price change either way.
 */
export async function setBarbackNotBooked(sessionId: string, staff: StaffMember, notBooked: boolean): Promise<FixResult> {
  if (!canFixStaffing(staff.role)) return ADMINS_ONLY;
  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await getSubmittedSession(sessionId);
    if (!session || !session.event_data) return NOT_FOUND;
    const b = barbackStatus(session);
    if (!b.applies) return { ok: false, error: "This event has no barback.", status: 400 };
    if (!b.removable) return { ok: false, error: "The barback is part of this package and cannot be removed.", status: 400 };
    if (notBooked && !b.on) return { ok: false, error: "The barback is already off.", status: 400 };
    if (!notBooked && !b.notBooked) return { ok: false, error: "Add the barback back through the priced add back.", status: 400 };

    const by = firstName(staff.name) || "an admin";
    const at = new Date().toISOString();
    const extras: Record<string, unknown> = { ...extrasOf(session), barback_by: by, barback_at: at, staffing_log: withLog(session, { at, by, text: notBooked ? "Barback marked not part of this booking (no price change)" : "Barback added at no charge" }) };
    if (notBooked) extras.barback_not_booked = true;
    else delete extras.barback_not_booked;

    const update: Record<string, unknown> = {
      event_data: { ...session.event_data, barback: notBooked ? BARBACK_REMOVED : BARBACK_INCLUDED },
      package_extras: extras,
      version: session.version + 1,
      updated_at: at,
    };
    const booked = bookedWithBarback(session, !notBooked);
    if (booked) update.booked_price = booked;

    const { data, error } = await supabase.from("sessions").update(update).eq("id", sessionId).eq("version", session.version).select("id");
    if (error) throw new Error(`barback save failed: ${error.message}`);
    if (data && data.length > 0) return { ok: true };
  }
  return { ok: false, error: "Someone else changed this event. Reload and try again.", status: 409 };
}
