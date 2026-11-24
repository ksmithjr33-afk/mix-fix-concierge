// The drinks an admin can pick when adding an event by hand, read from the same
// menu text the concierge uses (DRINK_MENU_RULES), with the same package rules
// (DRINK_SOURCING_RULES):
//   Dive Bar: the set menu of five, no picks.
//   Essentials Bar (legacy): the specialty (craft) menu only, no mocktails.
//   Full Bar, Premium Bar and The Big Day Bar (and legacy Bartender Only,
//   Tailored Bar): the craft menu plus the CLASSICS on request, and mocktails.
//   Beer and Wine: no signature drinks.
//   Bartender Only on the service fee model (the new Bartender Only): the
//   CLASSICS only, no craft menu, no mocktails, no custom drinks.
// On every other package a custom drink is allowed with its exact recipe (is_custom).
// Pure, no database.

import { DRINK_MENU_RULES } from "@/lib/system-prompt";
import { classicRecipes, isDiveBarPackage, recipeAsDrink } from "@/lib/dive-menu";
import { packageDrinkCount } from "@/lib/event-diff";
import { isServiceFeeBartenderOnly } from "@/lib/bartender-only";

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

export type MenuPool = "none" | "set" | "craft" | "craft_classics" | "classics";

/** The pricing model of the event, when known: only the new Bartender Only reads it. */
export type ModelOpt = { pricingModel?: unknown };

/** Which drinks a package can pick from. Bartender Only on the service fee model is the classics only. */
export function menuPool(pkg: unknown, opt: ModelOpt = {}): MenuPool {
  const p = String(pkg ?? "").toLowerCase();
  if (isServiceFeeBartenderOnly({ package: pkg, pricing_model: opt.pricingModel })) return "classics";
  if (isDiveBarPackage(p)) return "set";
  if (packageDrinkCount(p) === 0) return "none";
  if (p.includes("essentials")) return "craft";
  return "craft_classics";
}

/** Mocktails on Full Bar, Premium Bar, The Big Day Bar, and the legacy Bartender Only and Tailored Bar. Never Essentials, Dive Bar, or the new Bartender Only. */
export function allowsMocktails(pkg: unknown, opt: ModelOpt = {}): boolean {
  return menuPool(pkg, opt) === "craft_classics";
}

/** A custom drink with its own recipe: every package with picks except the new Bartender Only. */
export function allowsCustom(pkg: unknown, opt: ModelOpt = {}): boolean {
  const pool = menuPool(pkg, opt);
  return pool === "craft" || pool === "craft_classics";
}

/** The drinks this package can pick from, craft menu first. */
export function drinksFor(pkg: unknown, opt: ModelOpt = {}): CatalogDrink[] {
  const pool = menuPool(pkg, opt);
  if (pool === "classics") return classicDrinks();
  if (pool === "craft") return craftDrinks();
  if (pool === "craft_classics") return [...craftDrinks(), ...classicDrinks()];
  return [];
}

/** The package count, and up to 3 more at $50 each, as the concierge allows. */
export function drinkLimits(pkg: unknown, opt: ModelOpt = {}): { included: number; max: number } {
  const included = packageDrinkCount(pkg);
  return { included, max: menuPool(pkg, opt) === "set" || included === 0 ? 0 : included + 3 };
}
