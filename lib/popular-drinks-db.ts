// Most popular drinks from the database: every submitted event that is not
// hidden, counted by lib/popular-drinks.ts, with the admins' fallback lists from
// team settings. Kept for 10 minutes so each chat turn does not recount, and so
// the prompt (and its cache) stays the same through a conversation. Server only.

import { supabase } from "@/lib/supabase";
import { hiddenEventIds } from "@/lib/team/hidden";
import { POPULAR_COCKTAILS_KEY, POPULAR_MOCKTAILS_KEY, teamText } from "@/lib/client-list-db";
import { countPicks, currentMenu, popularDrinks, type PickCounts, type PickedEvent, type PopularDrinks } from "@/lib/popular-drinks";

const TTL_MS = 10 * 60 * 1000;
const PAGE = 1000;
let cached: { at: number; value: PopularDrinks } | null = null;

/** Every submitted, not hidden event's package and drinks. */
async function submittedEvents(): Promise<PickedEvent[]> {
  const hidden = await hiddenEventIds();
  const out: PickedEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sessions")
      .select("id, package_type, event_data")
      .eq("status", "submitted")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`popular drinks: sessions read failed: ${error.message}`);
    const rows = (data as { id: string; package_type: string | null; event_data: Record<string, unknown> | null }[]) ?? [];
    for (const r of rows) {
      if (hidden.has(r.id) || !r.event_data) continue;
      out.push({ package: r.event_data.package ?? r.package_type, signature_drinks: r.event_data.signature_drinks });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** The counts across every submitted event, before any fallback. */
export async function pickCounts(): Promise<PickCounts> {
  return countPicks(await submittedEvents(), currentMenu());
}

/** The top five cocktails and mocktails for the concierge. Never throws: a failed read uses the fallback lists. */
export async function currentPopularDrinks(opts: { fresh?: boolean } = {}): Promise<PopularDrinks> {
  if (!opts.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const [counts, cocktails, mocktails] = await Promise.all([
    pickCounts().catch((err) => {
      console.error(err);
      return { cocktails: [], mocktails: [], eventsWithPicks: 0 } as PickCounts;
    }),
    teamText(POPULAR_COCKTAILS_KEY),
    teamText(POPULAR_MOCKTAILS_KEY),
  ]);
  const value = popularDrinks(counts, { cocktails, mocktails });
  cached = { at: Date.now(), value };
  return value;
}

/** Drop the 10 minute copy, after an admin edits a fallback list. */
export function forgetPopularDrinks() {
  cached = null;
}
