// The mocktail menu, and what happens when there is none. Pure, no database.
//
// The concierge never creates a drink (CONDUCT RULE). There is no mocktail
// menu loaded yet, so when a client asks for a mocktail the concierge records
// the request instead of a recipe:
//   - the drink spot is held by a placeholder ("Mocktail (options coming)",
//     mocktail_followup true, no ingredients), so it still counts toward the
//     package count and nobody is offered an extra drink in its place,
//   - special_requests gets "Our team will send you mocktail options.",
//   - team_notes gets a follow up for our team.
// The server enforces it (guardMocktails) on new intake submissions and new
// updates, whatever the model sent. Events already saved are never changed.
//
// Loading a mocktail menu: put one mocktail per line in MOCKTAIL_MENU_TEXT,
// written exactly like the cocktail menu lines:
//   Name: short description for the client. Recipe: 3 oz lemonade, 1 oz strawberry puree, 0.5 oz lime juice, Top with club soda.
// Every ingredient has its oz amount except "Top with" items. Once a line is
// there, the concierge offers mocktails only from this menu, the follow up
// path turns off by itself, and a mocktail on the menu saves with its recipe.

export const MOCKTAIL_MENU_TEXT = ``;

export interface MenuMocktail {
  name: string;
  description: string;
  ingredients: string[];
}

/** The mocktail menu, parsed. Empty when none is loaded. */
export function mocktailMenu(text: string = MOCKTAIL_MENU_TEXT): MenuMocktail[] {
  const out: MenuMocktail[] = [];
  for (const raw of text.split("\n")) {
    const m = raw.trim().match(/^([^:]+):\s*(.+?)\s*Recipe:\s*(.+)$/);
    if (!m) continue;
    const ingredients = m[3].replace(/\.\s*$/, "").split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    if (ingredients.length === 0) continue;
    out.push({ name: m[1].trim(), description: m[2].replace(/\.\s*$/, "").trim(), ingredients });
  }
  return out;
}

export const hasMocktailMenu = (text: string = MOCKTAIL_MENU_TEXT): boolean => mocktailMenu(text).length > 0;

/**
 * Mocktails on Full Bar, Premium Bar, The Big Day Bar, and the legacy Bartender
 * Only and Tailored Bar. Never Essentials, Dive Bar, or Beer and Wine. The same
 * rule as allowsMocktails in lib/menu-catalog.ts, kept here so the update path
 * can use it without importing the menu.
 */
export function mocktailsAllowed(pkg: unknown): boolean {
  const s = String(pkg ?? "").toLowerCase();
  if (!s.trim()) return true;
  if (s.includes("dive") || s.includes("essentials")) return false;
  if (s.includes("beer") && s.includes("wine") && !s.includes("full") && !s.includes("premium")) return false;
  return true;
}

export const MOCKTAIL_FOLLOWUP_NAME = "Mocktail (options coming)";
export const MOCKTAIL_CLIENT_LINE = "Our team will send you mocktail options.";
export const MOCKTAIL_TEAM_NOTE = "Follow up with mocktail options: the client asked for a mocktail and there is no mocktail menu, so no recipe was made.";
export const MOCKTAIL_NOT_ON_PACKAGE = "You asked about a mocktail, which is not part of your package menu.";

type Drink = Record<string, unknown>;

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A mocktail: marked as one, or named like one ("Peppermint Mocktail", "Virgin Mojito", "zero proof"). */
export function isMocktail(d: unknown): boolean {
  if (!d || typeof d !== "object") return false;
  const x = d as Drink;
  if (x.is_mocktail === true) return true;
  return /\b(mocktails?|virgin|zero proof|non alcoholic|spirit free|alcohol free)\b/.test(norm(`${x.name ?? ""} ${x.menu_name ?? ""}`));
}

export const isMocktailFollowup = (d: unknown): boolean => !!d && typeof d === "object" && (d as Drink).mocktail_followup === true;

/** The menu mocktail this drink is, by name or menu_name. Null when it is not on the menu (or there is no menu). */
export function menuMocktailFor(d: unknown, text: string = MOCKTAIL_MENU_TEXT): MenuMocktail | null {
  if (!d || typeof d !== "object") return null;
  const x = d as Drink;
  const names = [norm(x.menu_name), norm(x.name)].filter(Boolean);
  return mocktailMenu(text).find((m) => names.includes(norm(m.name))) ?? null;
}

/** The placeholder that holds the drink spot until our team sends options. No recipe, no ingredients. */
export function followupDrink(): Drink {
  return { name: MOCKTAIL_FOLLOWUP_NAME, menu_name: "", base_spirit: "", description: MOCKTAIL_CLIENT_LINE, ingredients: [], garnish: "", method: "", is_mocktail: true, is_custom: false, mocktail_followup: true };
}

const sameDrink = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface MocktailGuard {
  drinks: unknown[];
  followups: number; // mocktails turned into a follow up (holding a spot)
  refused: number; // mocktails on a package without mocktails (dropped)
  replaced: string[]; // the names the model sent, for the log
}

/**
 * The server check for new submissions and new updates. A mocktail that is on
 * the loaded menu keeps its recipe, from the menu. Any other mocktail becomes
 * the follow up placeholder (or is dropped on a package without mocktails). A
 * drink already saved on the event, unchanged, is never touched, so events
 * saved before this check stay as they are.
 */
export function guardMocktails(drinks: unknown[], o: { saved?: unknown[]; allowsMocktails: boolean; menuText?: string }): MocktailGuard {
  const saved = o.saved ?? [];
  const out: unknown[] = [];
  let followups = 0;
  let refused = 0;
  const replaced: string[] = [];
  for (const d of drinks) {
    if (!isMocktail(d) || saved.some((s) => sameDrink(s, d))) {
      out.push(d);
      continue;
    }
    if (isMocktailFollowup(d)) {
      if (o.allowsMocktails) {
        out.push(followupDrink());
        followups++;
      } else refused++;
      continue;
    }
    const menu = menuMocktailFor(d, o.menuText);
    if (menu && o.allowsMocktails) {
      out.push({ ...(d as Drink), name: String((d as Drink).name ?? "") || menu.name, menu_name: menu.name, ingredients: menu.ingredients, is_mocktail: true, is_custom: false });
      continue;
    }
    replaced.push(String((d as Drink).name ?? (d as Drink).menu_name ?? "a mocktail"));
    if (o.allowsMocktails) {
      out.push(followupDrink());
      followups++;
    } else refused++;
  }
  return { drinks: out, followups, refused, replaced };
}

function addLine(text: unknown, line: string): string {
  const have = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return have.includes(line) ? have.join("\n") : [...have, line].join("\n");
}

/** special_requests (to the client) and team_notes (our team) after the guard. Nothing when nothing changed. */
export function mocktailNotes(ed: Drink, g: Pick<MocktailGuard, "followups" | "refused">): { special_requests?: string; team_notes?: string } {
  const out: { special_requests?: string; team_notes?: string } = {};
  if (g.followups > 0) {
    out.special_requests = addLine(ed.special_requests, MOCKTAIL_CLIENT_LINE);
    out.team_notes = addLine(ed.team_notes, MOCKTAIL_TEAM_NOTE);
  }
  if (g.refused > 0) out.special_requests = addLine(out.special_requests ?? ed.special_requests, MOCKTAIL_NOT_ON_PACKAGE);
  return out;
}
