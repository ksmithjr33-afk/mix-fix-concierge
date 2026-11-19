// What a booking includes beyond the package's standard wording. Pure, no database.
//
// Barback:
// - The Big Day Bar and Premium include a barback that cannot be removed.
// - A Full Bar wedding has a barback on by default (the $190 FULL_WEDDING_BARBACK
//   in lib/pricing.ts). The client (concierge or update mode) or an admin
//   (Booking card) can remove it and add it back; either way it goes through
//   the normal price change flow. The state is event_data.barback ("Included"
//   or "Removed"; missing means on). Who changed it last and when is kept on
//   sessions.package_extras (barback_by, barback_at).
// - A wedding is what the price engine calls a wedding: the event type
//   contains "wedding" (lib/price-change.ts basisFromEvent).
//
// Custom cups:
// - Included on Premium. Everywhere else a paid add on, except events booked
//   before 2026-11-19 as Full Bar over 100 guests, which were promised them:
//   those carry package_extras.cups_included, set once by
//   supabase/migrations/20261227_package_extras.sql (a flag, not a date check).

import { packageKey } from "@/lib/pricing";
import { barbackOnIn, BARBACK_INCLUDED, BARBACK_REMOVED } from "@/lib/price-change";

export { BARBACK_INCLUDED, BARBACK_REMOVED };

export interface PackageExtras {
  cups_included?: boolean;
  cups_set_by?: string;
  cups_set_at?: string;
  barback_by?: string; // "client", or the admin's first name
  barback_at?: string;
}

interface SessionLike {
  package_type?: string | null;
  event_type?: string | null;
  event_name?: string | null;
  event_data?: Record<string, unknown> | null;
  package_extras?: unknown;
}

export function extrasOf(session: SessionLike | null | undefined): PackageExtras {
  const x = session?.package_extras;
  return x && typeof x === "object" && !Array.isArray(x) ? (x as PackageExtras) : {};
}

function pkgOf(session: SessionLike): string {
  return String(session.event_data?.package ?? session.package_type ?? "");
}

/** The price engine's wedding test: the event type contains "wedding". */
export function isEngineWedding(session: SessionLike): boolean {
  return String(session.event_data?.event_type ?? session.event_type ?? session.event_name ?? "").toLowerCase().includes("wedding");
}

export interface BarbackStatus {
  applies: boolean; // the package has a barback at all (Big Day, Premium, a Full Bar wedding)
  removable: boolean; // Full Bar weddings only
  on: boolean; // needed in staffing, and in the price
  by: string; // who removed it or added it back last: "client" or an admin's first name
  at: string | null;
  line: string; // "Barback: included", "Barback: removed by client", ""
}

export function barbackStatus(session: SessionLike | null | undefined): BarbackStatus {
  const none: BarbackStatus = { applies: false, removable: false, on: false, by: "", at: null, line: "" };
  if (!session) return none;
  const key = packageKey(pkgOf(session));
  if (key === "wedding" || key === "premium") return { applies: true, removable: false, on: true, by: "", at: null, line: "Barback: included" };
  if (key !== "full" || !isEngineWedding(session)) return none;
  const x = extrasOf(session);
  const on = barbackOnIn(session.event_data ?? {});
  const by = x.barback_by ?? "";
  return {
    applies: true,
    removable: true,
    on,
    by,
    at: x.barback_at ?? null,
    line: on ? "Barback: included" : `Barback: removed by ${by || "client"}`,
  };
}

/** Custom cups are part of this booking: Premium, or an older Full Bar booking that was promised them. */
export function cupsIncluded(session: SessionLike | null | undefined): boolean {
  if (!session) return false;
  return packageKey(pkgOf(session)) === "premium" || extrasOf(session).cups_included === true;
}

/** This booking's changes to the short package wording (lib/packages-info.ts packageShortFor). */
export function bookingShortOf(session: SessionLike | null | undefined): { wedding: boolean; barback: "on" | "removed"; cups: boolean } {
  const b = barbackStatus(session);
  return { wedding: !!session && isEngineWedding(session), barback: b.removable && !b.on ? "removed" : "on", cups: !!session && extrasOf(session).cups_included === true };
}
