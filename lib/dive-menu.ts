// The Dive Bar set menu. Dive Bar comes with five favorites, recorded as the
// event's signature drinks when the concierge submits, with the recipes from
// the CLASSICS section. Guests can also order the other classics, except the
// drinks the package does not include. Events that picked their own drinks
// before the set menu keep what they picked.

import { DRINK_MENU_RULES } from "@/lib/system-prompt";

export const DIVE_SET_MENU = ["Margarita", "Old Fashioned", "Cosmopolitan", "Lemon Drop", "Moscow Mule"] as const;

/** Never available on Dive Bar. The last four were "signature only" before the set menu. */
export const DIVE_NOT_AVAILABLE = [
  "Espresso Martini",
  "French Connection",
  "Aperol Spritz",
  "Mojito",
  "Mint Julep",
  "Bloody Mary",
  "Mai Tai",
  "Sidecar",
  "Bellini",
  "Amaretto Sour",
  "Hurricane",
] as const;

/** What the concierge tells a Dive Bar client, once. */
export const DIVE_SET_MENU_LINE =
  "Dive Bar comes with a set menu of five favorites: Margarita, Old Fashioned, Cosmopolitan, Lemon Drop and Moscow Mule. Your guests can also order any other classic you would find at a dive bar.";

/** What update mode says when a Dive Bar client asks to change drinks. */
export const DIVE_MENU_SET_MESSAGE =
  "Your drink menu is set for the Dive Bar package: Margarita, Old Fashioned, Cosmopolitan, Lemon Drop and Moscow Mule. Your guests can also order any other classic you would find at a dive bar.";

export function isDiveBarPackage(pkg: unknown): boolean {
  return String(pkg ?? "").toLowerCase().includes("dive");
}

export interface ClassicRecipe {
  name: string;
  group: string; // "Whiskey"
  recipe: string; // the CLASSICS line after the name
}

/** Every drink in the CLASSICS section, in order, with its spirit group. */
export function classicRecipes(): ClassicRecipe[] {
  const lines = DRINK_MENU_RULES.split("\n");
  const from = lines.findIndex((l) => l.startsWith("=== CLASSICS"));
  const out: ClassicRecipe[] = [];
  let group = "";
  for (const line of lines.slice(from + 1)) {
    if (line.startsWith("===") || line.startsWith("Only a drink")) break;
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (m) out.push({ name: m[1].trim(), group, recipe: m[2].trim() });
    else if (line.trim() && /^[A-Z ]+$/.test(line.trim())) {
      const t = line.trim().toLowerCase();
      group = t.charAt(0).toUpperCase() + t.slice(1);
    }
  }
  return out;
}

export interface SetMenuDrink {
  name: string;
  base_spirit: string;
  ingredients: string[];
  garnish: string;
  method: string;
  is_mocktail: false;
  description: string;
}

const isPour = (part: string) => /^[\d.]+\s*oz\b|^top with\b|^\d+\s+dash(es)?\b/i.test(part);

/** One CLASSICS recipe as a signature drink: measured parts are ingredients, the rest garnish. */
export function recipeAsDrink(c: ClassicRecipe): SetMenuDrink {
  const parts = c.recipe.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  const ingredients = parts.filter(isPour);
  const garnish = parts.filter((p) => !isPour(p)).join(", ");
  const base = (ingredients[0] ?? "").replace(/^[\d.]+\s*oz\s*/i, "").replace(/^(tequila) blanco$/i, "$1").toLowerCase();
  return { name: c.name, base_spirit: base || c.group.toLowerCase(), ingredients, garnish, method: "", is_mocktail: false, description: "Dive Bar set menu" };
}

/** The five set menu drinks with their CLASSICS recipes. */
export function diveSetMenuDrinks(): SetMenuDrink[] {
  const all = classicRecipes();
  return DIVE_SET_MENU.map((name) => {
    const c = all.find((r) => r.name === name);
    if (!c) throw new Error(`${name} is missing from the CLASSICS section`);
    return recipeAsDrink(c);
  });
}

/** The other classics a Dive Bar guest can order: everything in CLASSICS except the five and the drinks not available. */
export function diveAlsoAvailable(): ClassicRecipe[] {
  const skip = new Set<string>([...DIVE_SET_MENU, ...DIVE_NOT_AVAILABLE]);
  return classicRecipes().filter((c) => !skip.has(c.name));
}

type Loose = Record<string, unknown>;

function alcoholicDrinks(ed: Loose): unknown[] {
  const list = Array.isArray(ed.signature_drinks) ? ed.signature_drinks : [];
  return list.filter((d) => d && !(d as Loose).is_mocktail);
}

/**
 * The menu a Dive Bar event serves: the set menu when it was recorded, or when
 * the event has no drinks of its own (booked before the set menu). Null when
 * the event picked its own drinks, or is not Dive Bar.
 */
export function usesDiveSetMenu(ed: Loose): boolean {
  if (!isDiveBarPackage(ed.package)) return false;
  return ed.dive_set_menu === true || alcoholicDrinks(ed).length === 0;
}

/**
 * At submit: a Dive Bar event gets the five as its signature drinks and
 * dive_set_menu true, whatever drinks the model sent. Other packages are
 * returned unchanged.
 */
export function applyDiveSetMenu<T extends Loose>(ed: T): T {
  if (!isDiveBarPackage(ed.package)) return ed;
  return { ...ed, signature_drinks: diveSetMenuDrinks(), dive_set_menu: true, dive_menu_requested: false };
}
