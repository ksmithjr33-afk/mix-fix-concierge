// Markets: Dallas, Austin, Houston, and Los Angeles. Each staff member works one
// or more markets, and each event has one: set automatically from the event's
// location (the nearest metro center within 150 miles) or by an admin. The
// market decides the event's time zone. Pure, no database.

import { distanceMeters, type LatLng } from "@/lib/team/clock";
import { TZ, TZ_KEY } from "@/lib/team/time";

export const MARKETS = ["dallas", "austin", "houston", "los_angeles"] as const;
export type Market = (typeof MARKETS)[number];
export const DEFAULT_MARKET: Market = "dallas";

export const MARKET_INFO: Record<Market, { label: string; tz: string; center: LatLng }> = {
  dallas: { label: "Dallas", tz: "America/Chicago", center: { lat: 32.7767, lng: -96.797 } },
  austin: { label: "Austin", tz: "America/Chicago", center: { lat: 30.2672, lng: -97.7431 } },
  houston: { label: "Houston", tz: "America/Chicago", center: { lat: 29.7604, lng: -95.3698 } },
  los_angeles: { label: "Los Angeles", tz: "America/Los_Angeles", center: { lat: 34.0522, lng: -118.2437 } },
};

export const MARKET_RADIUS_MILES = 150;
const METERS_PER_MILE = 1609.344;

export function isMarket(v: unknown): v is Market {
  return typeof v === "string" && (MARKETS as readonly string[]).includes(v);
}

export function marketLabel(m: unknown): string {
  return isMarket(m) ? MARKET_INFO[m].label : "No market";
}

/** The market's time zone. America/Chicago when there is no market yet. */
export function marketTz(m: unknown): string {
  return isMarket(m) ? MARKET_INFO[m].tz : TZ;
}

/** The nearest metro center within 150 miles, or null when the event is farther than that from all four. */
export function nearestMarket(loc: LatLng | null): Market | null {
  if (!loc) return null;
  let best: { m: Market; d: number } | null = null;
  for (const m of MARKETS) {
    const d = distanceMeters(loc, MARKET_INFO[m].center);
    if (!best || d < best.d) best = { m, d };
  }
  return best && best.d <= MARKET_RADIUS_MILES * METERS_PER_MILE ? best.m : null;
}

/** A staff member's markets from the form: at least one, known ones only, in a fixed order. Null when invalid. */
export function cleanMarkets(raw: unknown): Market[] | null {
  if (!Array.isArray(raw)) return null;
  const picked = MARKETS.filter((m) => raw.includes(m));
  if (picked.length === 0 || raw.some((x) => !isMarket(x))) return null;
  return picked;
}

/** Markets as stored. Staff from before markets count as Dallas. */
export function staffMarketsOf(s: { markets?: unknown }): Market[] {
  return cleanMarkets(s.markets) ?? [DEFAULT_MARKET];
}

export interface MarketSession {
  id: string;
  event_date?: string | null;
  event_data: Record<string, unknown> | null;
  team_market?: string | null;
  team_market_source?: string | null;
  team_market_address?: string | null;
}

/** The event's market time zone, America/Chicago before it has a market. */
export function eventTimeZone(s: object): string {
  return marketTz(sessionMarket(s));
}

/** The event's market, from the session row (team_market), or null when it has none yet. */
export function sessionMarket(s: object): Market | null {
  const m = (s as { team_market?: unknown }).team_market;
  return isMarket(m) ? m : null;
}

/**
 * A working copy of the event's data for time math: the event date from the
 * session when event_data has none, and the market's time zone. Never saved.
 */
export function eventData(s: { event_date?: string | null; event_data: Record<string, unknown> | null }): Record<string, unknown> {
  const ed: Record<string, unknown> = { ...(s.event_data ?? {}) };
  if (!ed.event_date && s.event_date) ed.event_date = s.event_date;
  ed[TZ_KEY] = marketTz(sessionMarket(s));
  return ed;
}

/**
 * Whether the automatic market needs working out again: never set, or set
 * automatically for a different address. A market an admin picked is kept.
 */
export function needsAutoMarket(s: MarketSession): boolean {
  if (s.team_market_source === "admin") return false;
  const address = String(s.event_data?.event_address ?? "").trim();
  if (!s.team_market_source) return true;
  return (s.team_market_address ?? "") !== address;
}
