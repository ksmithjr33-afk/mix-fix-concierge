// Database side of markets: working out an event's market from its location,
// an admin changing it, and each staff member's markets. Server only.
//
// The market lives in team_* columns on sessions, never in event_data. An
// automatic market is worked out again when the event address changes; a
// market an admin picked is kept.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { eventLocation } from "@/lib/team/clock-db";
import { isMarket, nearestMarket, needsAutoMarket, sessionMarket, staffMarketsOf, type Market, type MarketSession } from "@/lib/team/markets";

type WithMarket = SessionRow & MarketSession;

/**
 * The event's market, working it out first when it was never set or the
 * address changed. Updates the session object passed in, so later time math
 * on it uses the right time zone. Never throws: a failed lookup leaves the
 * market as it was.
 */
export async function ensureMarket(session: SessionRow): Promise<Market | null> {
  const s = session as WithMarket;
  if (!needsAutoMarket(s)) return sessionMarket(s);
  try {
    const address = String(s.event_data?.event_address ?? "").trim();
    const location = address ? await eventLocation(session) : null;
    const market = nearestMarket(location);
    const patch = {
      team_market: market,
      team_market_source: market ? "auto" : "none",
      team_market_address: address,
      team_market_set_by: null,
      team_market_set_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("sessions").update(patch).eq("id", session.id);
    if (error) {
      console.error("[team] saving the event market failed:", error.message);
      return sessionMarket(s);
    }
    Object.assign(s, patch);
    return market;
  } catch (err) {
    console.error("[team] working out the event market failed:", err instanceof Error ? err.message : String(err));
    return sessionMarket(s);
  }
}

/** Work out markets for events that need one, a few at a time (each may geocode). Returns how many were set. */
export async function ensureMarkets(sessions: SessionRow[], limit: number): Promise<number> {
  let done = 0;
  for (const s of sessions) {
    if (done >= limit) break;
    if (!needsAutoMarket(s as WithMarket)) continue;
    await ensureMarket(s);
    done++;
    const gap = Number(process.env.TEAM_GEOCODE_GAP_MS ?? (process.env.GOOGLE_MAPS_API_KEY ? 0 : 1100));
    if (gap > 0 && done < limit) await new Promise((r) => setTimeout(r, gap)); // OpenStreetMap asks for one lookup a second
  }
  return done;
}

export type MarketResult = { ok: true; market: Market } | { ok: false; error: string; status: number };

/** An admin sets the event's market. It stays until an admin changes it again. */
export async function setEventMarket(sessionId: string, market: unknown, admin: StaffMember): Promise<MarketResult> {
  if (!isMarket(market)) return { ok: false, error: "Pick a market.", status: 400 };
  const { data, error } = await supabase
    .from("sessions")
    .update({ team_market: market, team_market_source: "admin", team_market_set_by: admin.id, team_market_set_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "submitted")
    .select("id");
  if (error) throw new Error(`market save failed: ${error.message}`);
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: "We could not find that event.", status: 404 };
  return { ok: true, market };
}

/** A staff member's markets. Dallas until the markets column exists. */
export async function staffMarkets(staffId: string): Promise<Market[]> {
  const { data, error } = await supabase.from("staff").select("*").eq("id", staffId).maybeSingle();
  if (error || !data) return staffMarketsOf({});
  return staffMarketsOf(data as { markets?: unknown });
}
