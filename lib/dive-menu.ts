// The Dive Bar set menu. Dive Bar comes with five favorites, recorded as the
// event's signature drinks when the concierge submits, with the recipes from
// the CLASSICS section. Guests can also order the other classics, except the
// drinks the package does not include. Events that picked their own drinks
// before the set menu keep what they picked.
//
// Menu card on request: Dive Bar has no printed menu by default. If the client
// asks for a menu, the concierge can offer a printed card with three classics
// the client picks from the classics Dive Bar allows (the CLASSICS section less
// DIVE_NOT_AVAILABLE). Each additional classic is $50, up to three more, six at
// most, handled like extra signature drinks on Full Bar. The picks replace the
// set menu as the event's drinks (dive_menu_card true). The shopping list stays
// on the Dive Bar well, so the card never adds alcohol.

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
export function recipeAsDrink(c: ClassicRecipe, description = "Dive Bar set menu"): SetMenuDrink {
  const parts = c.recipe.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  const ingredients = parts.filter(isPour);
  const garnish = parts.filter((p) => !isPour(p)).join(", ");
  const base = (ingredients[0] ?? "").replace(/^[\d.]+\s*oz\s*/i, "").replace(/^(tequila) blanco$/i, "$1").toLowerCase();
  return { name: c.name, base_spirit: base || c.group.toLowerCase(), ingredients, garnish, method: "", is_mocktail: false, description };
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

// ---------- menu card on request ----------

/** Classics on the card for free, and the most extras (at $50 each). */
export const DIVE_CARD_INCLUDED = 3;
export const DIVE_CARD_EXTRA_MAX = 3;
export const DIVE_CARD_MAX = DIVE_CARD_INCLUDED + DIVE_CARD_EXTRA_MAX;
export const DIVE_CARD_EXTRA_PRICE = 50;
export const DIVE_CARD_DESCRIPTION = "Dive Bar menu card";

/** What the concierge says when a Dive Bar client asks for a menu. Never said unprompted. */
export const DIVE_CARD_OFFER_LINE = "We can add a printed menu card with three classics you pick. Each additional classic is $50, up to three more.";

/** The planning chat heads up before a fourth, fifth or sixth classic, worded like the Full Bar extra drink heads up. */
export const DIVE_CARD_EXTRA_LINE =
  "Just a heads up, your menu card includes three classics. Each additional classic is $50. Would you like to add [drink name] as an additional classic for $50?";

/** A seventh classic. */
export const DIVE_CARD_FULL_LINE = "Your menu card can hold up to six classics. Would you like to swap one instead?";

/** The staff package guide line. Never on the short client facing wording. */
export const DIVE_CARD_GUIDE_LINE = "Menu card on request only: three classics the client picks, each additional $50.";

/**
 * What the planning chat says when a Dive Bar client asks for a drink that is
 * not a classic Dive Bar allows, worded like the hours upgrade offer. Update
 * mode offers the package change through its normal price quote instead.
 */
export const DIVE_CARD_FULL_BAR_LINE =
  "That is a Full Bar feature. Your menu card can have classics only. If you'd like specialty cocktails or mocktails, I can have a representative reach out about the upgrade to Full Bar.";

/** The classics a menu card can hold, as a list for the prompts. */
export function diveCardClassicNames(): string {
  return diveCardClassics().map((c) => c.name).join(", ");
}

/** The classics a Dive Bar menu card can hold: every CLASSICS drink except the ones Dive Bar leaves out. */
export function diveCardClassics(): ClassicRecipe[] {
  const skip = new Set<string>(DIVE_NOT_AVAILABLE);
  return classicRecipes().filter((c) => !skip.has(c.name));
}

const nameKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

/** The Dive Bar card classic a name means, or null. "Moscow mule", "Pina Colada" and "Gin & Tonic" all match. */
export function findCardClassic(name: unknown): ClassicRecipe | null {
  const key = nameKey(name);
  if (!key) return null;
  return diveCardClassics().find((c) => nameKey(c.name) === key) ?? null;
}

/** True when this Dive Bar event has a menu card. */
export function hasDiveMenuCard(ed: Loose): boolean {
  return isDiveBarPackage(ed.package) && ed.dive_menu_card === true;
}

export interface CardPicks {
  drinks: SetMenuDrink[]; // the classics, in order, at most DIVE_CARD_MAX, with their CLASSICS recipes
  refused: string[]; // names that are not a classic Dive Bar allows (specialty, mocktail, custom, excluded)
  overMax: string[]; // classics past the sixth
}

/**
 * The client's picks for the card, checked. Each pick (a drink object or a name)
 * must be a classic Dive Bar allows, by name or menu_name, and not a mocktail or
 * a custom drink. Its recipe comes from CLASSICS, whatever the model sent.
 * Repeats are dropped. Past six the rest are overMax.
 */
export function cardPicks(raw: unknown): CardPicks {
  const list = Array.isArray(raw) ? raw : [];
  const drinks: SetMenuDrink[] = [];
  const refused: string[] = [];
  const overMax: string[] = [];
  for (const item of list) {
    if (item === null || item === undefined) continue;
    const d = (typeof item === "object" ? item : { name: item }) as Loose;
    const label = String(d.name ?? d.menu_name ?? "").trim() || "Unnamed drink";
    const c = d.is_mocktail === true || d.is_custom === true ? null : findCardClassic(d.name) ?? findCardClassic(d.menu_name);
    if (!c) {
      refused.push(label);
      continue;
    }
    if (drinks.some((x) => x.name === c.name)) continue;
    if (drinks.length >= DIVE_CARD_MAX) {
      overMax.push(c.name);
      continue;
    }
    drinks.push(recipeAsDrink(c, DIVE_CARD_DESCRIPTION));
  }
  return { drinks, refused, overMax };
}

/** Extra classics on a card of this many, past the three included. */
export function cardExtras(count: number): number {
  return Math.max(0, Math.min(count, DIVE_CARD_MAX) - DIVE_CARD_INCLUDED);
}

/**
 * True when a Dive Bar event has no printed menu: no menu card, and not an
 * older booking that asked for a printed menu (dive_menu_requested). Null for
 * other packages, which the admin sets by hand.
 */
export function diveNoPrintedMenu(ed: Loose): boolean | null {
  if (!isDiveBarPackage(ed.package)) return null;
  return !(ed.dive_menu_card === true || ed.dive_menu_requested === true);
}

/**
 * The menu a Dive Bar event serves: the set menu when it was recorded, or when
 * the event has no drinks of its own (booked before the set menu). Null when
 * the event picked its own drinks, or is not Dive Bar.
 */
export function usesDiveSetMenu(ed: Loose): boolean {
  if (!isDiveBarPackage(ed.package) || ed.dive_menu_card === true) return false;
  return ed.dive_set_menu === true || alcoholicDrinks(ed).length === 0;
}

/**
 * At submit: a Dive Bar event gets the five as its signature drinks and
 * dive_set_menu true, whatever drinks the model sent. When the client asked for
 * a menu card (dive_menu_card true) and picked at least one classic Dive Bar
 * allows, the picks are the drinks instead (CLASSICS recipes, six at most), and
 * anything else they sent is dropped. Other packages are returned unchanged.
 */
export function applyDiveSetMenu<T extends Loose>(ed: T): T {
  if (!isDiveBarPackage(ed.package)) return ed;
  if (ed.dive_menu_card === true) {
    const picks = cardPicks(ed.signature_drinks);
    if (picks.drinks.length > 0) {
      return { ...ed, signature_drinks: picks.drinks, dive_menu_card: true, dive_set_menu: false, dive_menu_requested: false };
    }
  }
  return { ...ed, signature_drinks: diveSetMenuDrinks(), dive_set_menu: true, dive_menu_card: false, dive_menu_requested: false };
}
