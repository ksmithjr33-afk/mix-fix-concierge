// Most popular drinks: how often each drink on the CURRENT menu was picked
// across submitted events. A drink no longer on the menu is never counted.
// The concierge gets the top five and answers "what is popular?" from that list
// only (lib/system-prompt.ts, popularSection). Until enough events have menu
// picks (MIN_EVENTS) the admins' fallback list in team settings is used.
//
// Matching a picked drink to the menu, in order:
//   1. menu_name, the menu drink the concierge built it from (sent since 2026-11-17)
//   2. its name, when the client kept the menu name
//   3. its recipe: the ingredient names (amounts dropped) against each menu
//      recipe, a clear best match only. Older events only have creative names.
// Dive Bar events are skipped: their set menu is not a pick.
//
// Mocktails: there is no mocktail menu. The concierge makes mocktails up under
// MOCKTAIL RULES, so no mocktail is "on the current menu" and none is counted.
// The mocktail list always comes from the fallback list until a menu exists.
// Pure, no database.

import { classicDrinks, craftDrinks } from "@/lib/menu-catalog";
import { isDiveBarPackage } from "@/lib/dive-menu";

export const TOP_N = 5;
export const MIN_EVENTS = 20;
const MATCH_AT = 0.75; // share of ingredient names in common to count as that menu drink

export interface MenuDrink {
  name: string;
  spirit: string;
  ingredients: string[]; // names, amounts dropped
}

export interface PickedEvent {
  package?: unknown;
  signature_drinks?: unknown;
}

export interface DrinkCount {
  name: string;
  count: number;
}

export interface PickCounts {
  cocktails: DrinkCount[]; // most picked first, ties by menu order
  mocktails: DrinkCount[]; // always empty while there is no mocktail menu
  eventsWithPicks: number; // events with at least one drink on the current menu
}

export interface PopularDrinks {
  cocktails: DrinkCount[]; // top five; fallback entries have count 0
  mocktails: DrinkCount[];
  cocktailSource: "counts" | "fallback";
  mocktailSource: "counts" | "fallback";
  eventsWithPicks: number;
  minEvents: number;
}

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "0.75 oz raspberry liqueur (Chambord)" → "raspberry liqueur". */
export function ingredientName(raw: unknown): string {
  return norm(
    String(raw ?? "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/^\s*(top(ped)? with|splash of|pinch of|dash of|a dash of|fresh)\s+/i, "")
      .replace(/^\s*[\d.\/]+\s*(oz|ounces?|dashes|dash|slices?|halves|leaves|sprigs?|spoons?|tsp|tbsp)?\s+/i, "")
      .replace(/^\s*(muddled|fresh)\s+/i, "")
  );
}

/** Every drink on the current menu (the craft menu, then the CLASSICS), one per name. */
export function currentMenu(): MenuDrink[] {
  const seen = new Set<string>();
  const out: MenuDrink[] = [];
  for (const d of [...craftDrinks(), ...classicDrinks()]) {
    const key = norm(d.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: d.name, spirit: d.base_spirit, ingredients: d.ingredients.map(ingredientName).filter(Boolean) });
  }
  return out;
}

function overlap(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / (A.size + B.size - both);
}

type Loose = Record<string, unknown>;

/** The menu drink a picked drink is, or null (a mocktail, a custom drink, or no clear match). */
export function matchMenuDrink(drink: unknown, menu: MenuDrink[]): MenuDrink | null {
  if (!drink || typeof drink !== "object") return null;
  const d = drink as Loose;
  if (d.is_mocktail === true) return null;
  const byName = new Map(menu.map((m) => [norm(m.name), m]));
  const named = byName.get(norm(d.menu_name)) ?? byName.get(norm(d.name));
  if (named) return named;
  if (d.is_custom === true) return null;
  const ings = (Array.isArray(d.ingredients) ? d.ingredients : []).map(ingredientName).filter(Boolean);
  if (ings.length === 0) return null;
  let best: MenuDrink | null = null;
  let bestScore = 0;
  let second = 0;
  for (const m of menu) {
    const s = overlap(ings, m.ingredients);
    if (s > bestScore) {
      second = bestScore;
      bestScore = s;
      best = m;
    } else if (s > second) {
      second = s;
    }
  }
  return best && bestScore >= MATCH_AT && bestScore > second ? best : null;
}

/** How often each current menu drink was picked: once per event at most. */
export function countPicks(events: PickedEvent[], menu: MenuDrink[] = currentMenu()): PickCounts {
  const counts = new Map<string, number>();
  let eventsWithPicks = 0;
  for (const ev of events) {
    if (isDiveBarPackage(ev.package)) continue;
    const drinks = Array.isArray(ev.signature_drinks) ? ev.signature_drinks : [];
    const picked = new Set<string>();
    for (const d of drinks) {
      const m = matchMenuDrink(d, menu);
      if (m) picked.add(m.name);
    }
    if (picked.size === 0) continue;
    eventsWithPicks++;
    for (const name of picked) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const order = new Map(menu.map((m, i) => [m.name, i]));
  const cocktails = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
  return { cocktails, mocktails: [], eventsWithPicks };
}

/** An admin's list: one drink per comma or line, blanks and repeats dropped. */
export function parseNameList(text: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(text ?? "").split(/[,\n;]+/)) {
    const name = part.replace(/^\s*\d+[.)]\s*/, "").trim();
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    out.push(name);
  }
  return out;
}

/** The fallback cocktails that are on the current menu, with the menu's spelling. Anything else is dropped. */
export function fallbackCocktails(text: unknown, menu: MenuDrink[] = currentMenu()): string[] {
  const byName = new Map(menu.map((m) => [norm(m.name), m.name]));
  return parseNameList(text)
    .map((n) => byName.get(norm(n)))
    .filter((n): n is string => !!n);
}

/**
 * The top five of each, from the counts when at least MIN_EVENTS events have
 * menu picks, else from the admins' fallback lists. Fallback entries have count 0.
 */
export function popularDrinks(
  counts: PickCounts,
  fallback: { cocktails: unknown; mocktails: unknown },
  menu: MenuDrink[] = currentMenu(),
  minEvents = MIN_EVENTS
): PopularDrinks {
  const enough = counts.eventsWithPicks >= minEvents;
  const asFallback = (names: string[]) => names.slice(0, TOP_N).map((name) => ({ name, count: 0 }));
  const mocktailsFromCounts = enough && counts.mocktails.length > 0;
  return {
    cocktails: enough ? counts.cocktails.slice(0, TOP_N) : asFallback(fallbackCocktails(fallback.cocktails, menu)),
    mocktails: mocktailsFromCounts ? counts.mocktails.slice(0, TOP_N) : asFallback(parseNameList(fallback.mocktails)),
    cocktailSource: enough ? "counts" : "fallback",
    mocktailSource: mocktailsFromCounts ? "counts" : "fallback",
    eventsWithPicks: counts.eventsWithPicks,
    minEvents,
  };
}

/** Names only, for the prompt. */
export function popularForPrompt(p: PopularDrinks): { cocktails: string[]; mocktails: string[] } {
  return { cocktails: p.cocktails.map((d) => d.name), mocktails: p.mocktails.map((d) => d.name) };
}

/** One line for admins: where the concierge's list comes from right now. */
export function popularStatusLine(p: PopularDrinks, kind: "cocktails" | "mocktails"): string {
  const list = kind === "cocktails" ? p.cocktails : p.mocktails;
  const source = kind === "cocktails" ? p.cocktailSource : p.mocktailSource;
  const names = list.length ? list.map((d) => (source === "counts" ? `${d.name} (${d.count})` : d.name)).join(", ") : "nothing";
  if (source === "counts") return `In use now: counts from ${p.eventsWithPicks} events: ${names}.`;
  const why = kind === "cocktails" ? ` (${p.eventsWithPicks} of ${p.minEvents} events with menu picks so far)` : "";
  return `In use now: this list${why}: ${names}.`;
}
