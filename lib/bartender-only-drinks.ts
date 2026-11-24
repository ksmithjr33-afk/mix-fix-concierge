// The drinks on the new Bartender Only (a service fee model event with the
// Bartender Only package key): classics only. Pure, no database.
//
// Every drink comes from the CLASSICS section of the concierge's menu text,
// with its CLASSICS recipe. Nothing from the craft menu, no mocktails (none is
// on the classics list), and no custom or off menu drink, even with a recipe.
// The signature drink count is the package's count, as before.
//
// Legacy Bartender Only events on the gratuity model are untouched: they keep
// the Full Bar sourcing. Callers decide which event this is with
// isServiceFeeBartenderOnly / isServiceFeeBartenderOnlyBooking.

import { classicRecipes, recipeAsDrink, type ClassicRecipe } from "@/lib/dive-menu";
import { isMocktail } from "@/lib/mocktail-menu";

export { BO_CLASSICS_LINE } from "@/lib/bartender-only";

/** The team note when drinks that are not classics were left off a new Bartender Only event. */
export const boClassicsNote = (names: string[]): string =>
  `Not on Bartender Only, which covers classics only, so left off the drink menu: ${names.join(", ")}.`;

const nameKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

/** The CLASSICS drink a name means, or null. "moscow mule" and "Gin & Tonic" both match. */
export function findClassic(name: unknown): ClassicRecipe | null {
  const key = nameKey(name);
  if (!key) return null;
  return classicRecipes().find((c) => nameKey(c.name) === key) ?? null;
}

type Drink = Record<string, unknown>;

/**
 * The classic this drink is, or null for a craft drink, a mocktail, or a
 * custom drink. menu_name (the menu drink it was built from) decides when it is
 * there, so a craft drink given a classic's name as its creative name is still
 * the craft drink. Without one, the name decides.
 */
export function classicOf(d: unknown): ClassicRecipe | null {
  if (!d || typeof d !== "object") return findClassic(d);
  const x = d as Drink;
  if (x.is_custom === true || x.mocktail_followup === true || isMocktail(x)) return null;
  return String(x.menu_name ?? "").trim() ? findClassic(x.menu_name) : findClassic(x.name);
}

const sameDrink = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface ClassicsGuard {
  drinks: unknown[]; // the classics, each with its CLASSICS recipe
  refused: string[]; // names of the drinks left off: craft menu, mocktail, custom, off menu
}

/**
 * The server check on every drink saved to a new Bartender Only event. A
 * classic keeps the name the client approved, and its menu_name, ingredients,
 * garnish and spirit come from CLASSICS whatever was sent. Anything else is
 * left off. A drink already saved on the event, unchanged, is never touched.
 */
export function guardClassicsOnly(drinks: unknown[], saved: unknown[] = []): ClassicsGuard {
  const out: unknown[] = [];
  const refused: string[] = [];
  for (const d of drinks) {
    if (d === null || d === undefined) continue;
    if (saved.some((s) => sameDrink(s, d))) {
      out.push(d);
      continue;
    }
    const c = classicOf(d);
    const x = (typeof d === "object" ? d : { name: d }) as Drink;
    if (!c) {
      refused.push(String(x.name ?? x.menu_name ?? "").trim() || "Unnamed drink");
      continue;
    }
    const r = recipeAsDrink(c, "");
    out.push({
      ...x,
      name: String(x.name ?? "").trim() || c.name,
      menu_name: c.name,
      base_spirit: r.base_spirit,
      ingredients: r.ingredients,
      garnish: r.garnish,
      method: String(x.method ?? "").trim() || r.method,
      description: String(x.description ?? "").trim(),
      is_mocktail: false,
      is_custom: false,
    });
  }
  return { drinks: out, refused };
}
