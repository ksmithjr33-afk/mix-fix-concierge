// Staffing corrections an admin or manager makes on the event page, without
// touching the price. Pure, no database. The writes are in
// lib/team/staffing-fix-db.ts.
//
// Bartenders needed (Team tab):
// - Kept on sessions.package_extras (bartenders_needed, with who and when), never
//   in event_data or booked_price, so the booked total, the price basis, the
//   update history and GHL never see it.
// - bartendersNeeded (lib/team/event-view.ts) reads it first, so the event cards,
//   the staffing colors, the Team badge and open shift posts all follow it.
// - It remembers the booking's own count when it was set. If a later priced
//   change moves the booking's count (a client adds a bartender), the booking's
//   new count wins again: the correction was about the old number.
//
// Barback "not part of this booking" (Booking card): see lib/package-extras.ts.
//
// Every change, bartenders and barback, priced or not, adds a line to
// package_extras.staffing_log, shown on the Team tab.

import { staffingFor } from "@/lib/pricing";
import { isAdminRole } from "@/lib/team/roles";

export const MIN_BARTENDERS = 1;
export const MAX_BARTENDERS = 4;
export const STAFFING_LOG_MAX = 30;

export interface StaffingLogEntry {
  at: string;
  by: string; // first name, or "client"
  text: string; // "Bartenders needed set to 1"
}

interface SessionLike {
  event_data?: Record<string, unknown> | null;
  guest_count?: string | null;
  booked_price?: { bartenders?: number | null; source?: string | null } | null;
  package_extras?: unknown;
}

function count(v: unknown): number | null {
  const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function extras(session: SessionLike): Record<string, unknown> {
  const x = session.package_extras;
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

/** Admins and managers. Bartenders and every other staff role cannot. */
export function canFixStaffing(role: unknown): boolean {
  return isAdminRole(role);
}

/** A bartenders needed value from the form: a whole number 1 to 4, or null when it is not one. */
export function cleanBartenders(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= MIN_BARTENDERS && n <= MAX_BARTENDERS ? n : null;
}

export interface BookedBartenders {
  count: number | null;
  estimated: boolean; // the booking had no count: worked out from the guest count
  guests: number | null;
}

/** The booking's own bartender count, or the guest count estimate when the booking had none. */
export function bookedBartenders(session: SessionLike): BookedBartenders {
  const ed = session.event_data ?? {};
  const guests = count(ed.guest_count) ?? count(session.guest_count);
  const saved = count(ed.bartenders);
  // A booked price the app computed itself (no price from the booking) took its count from the guest count too.
  const fromBooking = session.booked_price?.source === "computed" ? null : count(session.booked_price?.bartenders);
  const explicit = saved ?? fromBooking;
  if (explicit) return { count: explicit, estimated: false, guests };
  const fallback = count(session.booked_price?.bartenders);
  if (fallback) return { count: fallback, estimated: true, guests };
  return { count: guests ? staffingFor(guests) : null, estimated: !!guests, guests };
}

export interface BartendersFix {
  value: number;
  by: string;
  at: string | null;
}

/** The admin's bartenders needed, while the booking's count is still the one it corrected. Null otherwise. */
export function bartendersFix(session: SessionLike): BartendersFix | null {
  const x = extras(session);
  const value = cleanBartenders(x.bartenders_needed);
  if (value === null) return null;
  const booked = bookedBartenders(session);
  const was = x.bartenders_needed_booked === null || x.bartenders_needed_booked === undefined ? null : count(x.bartenders_needed_booked);
  const now = booked.estimated ? null : booked.count;
  if (was !== now) return null;
  return { value, by: typeof x.bartenders_needed_by === "string" ? x.bartenders_needed_by : "", at: typeof x.bartenders_needed_at === "string" ? x.bartenders_needed_at : null };
}

/** "Estimated from 90 guests. Set the right number." when the count came from the guest count and nobody set it. */
export function estimateNote(session: SessionLike): string {
  if (bartendersFix(session)) return "";
  const b = bookedBartenders(session);
  return b.estimated && b.guests ? `Estimated from ${b.guests} guests. Set the right number.` : "";
}

/** The package_extras keys for a new bartenders needed (or null to go back to the booking's number). */
export function bartendersExtras(session: SessionLike, value: number | null, by: string, at: string): Record<string, unknown> {
  const booked = bookedBartenders(session);
  const text = value === null ? `Bartenders needed back to the booking's number${booked.count ? ` (${booked.count})` : ""}` : `Bartenders needed set to ${value}`;
  const base: Record<string, unknown> = { ...extras(session), staffing_log: withLog(session, { at, by, text }) };
  if (value === null) {
    delete base.bartenders_needed;
    delete base.bartenders_needed_booked;
    delete base.bartenders_needed_by;
    delete base.bartenders_needed_at;
    return base;
  }
  return {
    ...base,
    bartenders_needed: value,
    bartenders_needed_booked: booked.estimated ? null : booked.count,
    bartenders_needed_by: by,
    bartenders_needed_at: at,
  };
}

/** The staffing log, newest first. */
export function staffingLog(session: SessionLike): StaffingLogEntry[] {
  const log = extras(session).staffing_log;
  if (!Array.isArray(log)) return [];
  return log
    .filter((e): e is StaffingLogEntry => !!e && typeof e === "object" && typeof (e as StaffingLogEntry).text === "string")
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** The log with one more line, oldest dropped past the limit. */
export function withLog(session: SessionLike, entry: StaffingLogEntry): StaffingLogEntry[] {
  return [entry, ...staffingLog(session)].slice(0, STAFFING_LOG_MAX);
}

// ----- Barbacks, event helpers and servers needed (Team tab) -----
//
// Beside Bartenders needed, staffing only like it: kept on
// sessions.package_extras.role_needed ({ bar_back, event_helper, server }, 0 to
// 4 each), never the price or the booking. Barbacks default to 1 when the
// package has a barback on (lib/package-extras.ts), else 0; event helpers and
// servers default to 0. Ranked offers and open shifts fill Bartender spots
// only; these roles are assigned by hand.

export const MAX_ROLE_NEEDED = 4;
type OtherRole = "bar_back" | "event_helper" | "server";
const OTHER: OtherRole[] = ["bar_back", "event_helper", "server"];
const ROLE_LOG_LABEL: Record<OtherRole, string> = { bar_back: "Barbacks", event_helper: "Event helpers", server: "Servers" };

export const isOtherRole = (v: unknown): v is OtherRole => typeof v === "string" && (OTHER as string[]).includes(v);

/** A needed count from the form: a whole number 0 to 4, or null when it is not one. */
export function cleanRoleNeeded(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= MAX_ROLE_NEEDED ? n : null;
}

/** What an admin set for each role, or nothing when they never did. */
export function roleNeededSet(session: SessionLike): Partial<Record<OtherRole, number>> {
  const r = extras(session).role_needed;
  if (!r || typeof r !== "object" || Array.isArray(r)) return {};
  const out: Partial<Record<OtherRole, number>> = {};
  for (const k of OTHER) {
    const n = cleanRoleNeeded((r as Record<string, unknown>)[k]);
    if (n !== null) out[k] = n;
  }
  return out;
}

/** Barbacks, event helpers and servers needed: the admin's number, else the default (a barback when the package has one on). */
export function roleNeeded(session: SessionLike, barbackOn: boolean): Record<OtherRole, number> {
  const set = roleNeededSet(session);
  return { bar_back: set.bar_back ?? (barbackOn ? 1 : 0), event_helper: set.event_helper ?? 0, server: set.server ?? 0 };
}

/** The package_extras with one role's needed count set, and a log line. */
export function roleNeededExtras(session: SessionLike, role: OtherRole, value: number, by: string, at: string): Record<string, unknown> {
  const base = extras(session);
  return {
    ...base,
    role_needed: { ...roleNeededSet(session), [role]: value },
    staffing_log: withLog(session, { at, by, text: `${ROLE_LOG_LABEL[role]} needed set to ${value}` }),
  };
}
