// The drinks an admin can pick when adding an event by hand, read from the same
// menu text the concierge uses (DRINK_MENU_RULES), with the same package rules
// (DRINK_SOURCING_RULES):
//   Dive Bar: the set menu of five, no picks.
//   Essentials Bar and The Big Day Bar: the specialty (craft) menu only, no mocktails.
//   Full Bar and Premium Bar (and legacy Bartender Only, Tailored Bar): the
//   craft menu plus the CLASSICS, and mocktails.
//   Beer and Wine: no signature drinks.
// On every package a custom drink is allowed with its exact recipe (is_custom).
// Pure, no database.

import { DRINK_MENU_RULES } from "@/lib/system-prompt";
import { classicRecipes, isDiveBarPackage, recipeAsDrink } from "@/lib/dive-menu";
import { packageDrinkCount } from "@/lib/event-diff";

export interface CatalogDrink {
  key: string; // "craft:French Martini" or "classic:Old Fashioned"
  name: string;
  group: string; // "Vodka", "Classics: Whiskey"
  ingredients: string[]; // with oz amounts, the way the concierge stores them
  garnish: string;
  base_spirit: string;
  description: string;
}

const CRAFT_SECTIONS = ["VODKA", "TEQUILA", "WHISKEY", "RUM", "GIN", "COGNAC", "BUBBLIES"];

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Every craft menu drink, VODKA through BUBBLIES, with its recipe. */
export function craftDrinks(): CatalogDrink[] {
  const out: CatalogDrink[] = [];
  let section = "";
  for (const line of DRINK_MENU_RULES.split("\n")) {
    const head = line.match(/^=== ([A-Z]+) ===$/);
    if (head) {
      section = CRAFT_SECTIONS.includes(head[1]) ? head[1] : "";
      continue;
    }
    if (line.startsWith("=== CLASSICS")) break;
    if (!section) continue;
    const m = line.match(/^([^:]+):\s*(.+?)\s*Recipe:\s*(.+)$/);
    if (!m) continue;
    const description = m[2].replace(/\.\s*$/, "").trim();
    const ingredients = m[3].replace(/\.\s*$/, "").split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    const garnish = description.split(/,\s*/).filter((p) => /garnish|rim\b/i.test(p)).join(", ");
    const base = (ingredients[0] ?? "").replace(/^[\d.]+\s*oz\s*/i, "").toLowerCase();
    out.push({ key: `craft:${m[1].trim()}`, name: m[1].trim(), group: title(section), ingredients, garnish, base_spirit: base, description });
  }
  return out;
}

/** Every CLASSICS drink as a pickable drink. */
export function classicDrinks(): CatalogDrink[] {
  return classicRecipes().map((c) => {
    const d = recipeAsDrink(c);
    return { key: `classic:${c.name}`, name: c.name, group: `Classics: ${c.group}`, ingredients: d.ingredients, garnish: d.garnish, base_spirit: d.base_spirit, description: "" };
  });
}

export type MenuPool = "none" | "set" | "craft" | "craft_classics";

/** Which drinks a package can pick from. */
export function menuPool(pkg: unknown): MenuPool {
  const p = String(pkg ?? "").toLowerCase();
  if (isDiveBarPackage(p)) return "set";
  if (packageDrinkCount(p) === 0) return "none";
  if (p.includes("essentials") || p.includes("big day") || p.includes("wedding bar")) return "craft";
  return "craft_classics";
}

/** Mocktails only on Full Bar and Premium Bar, and the legacy Bartender Only and Tailored Bar. */
export function allowsMocktails(pkg: unknown): boolean {
  return menuPool(pkg) === "craft_classics";
}

/** The drinks this package can pick from, craft menu first. */
export function drinksFor(pkg: unknown): CatalogDrink[] {
  const pool = menuPool(pkg);
  if (pool === "craft") return craftDrinks();
  if (pool === "craft_classics") return [...craftDrinks(), ...classicDrinks()];
  return [];
}

/** The package count, and up to 3 more at $50 each, as the concierge allows. */
export function drinkLimits(pkg: unknown): { included: number; max: number } {
  const included = packageDrinkCount(pkg);
  return { included, max: menuPool(pkg) === "set" || included === 0 ? 0 : included + 3 };
}
