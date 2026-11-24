// Every ingredient in a saved recipe must land on the Shopping list. This
// checks the event's recipes against the list's lines (and the house syrups
// the list makes) and returns what it could not match, so the admin
// Shopping list can flag it: "Not matched, check this". Admins only: staff
// never see it. Pure, no database.
//
// Left out on purpose, never flagged: what the bartender's kit covers (salt,
// pepper, bitters), ice and water, and how a drink is made ("shaken").

export interface Unmatched {
  drink: string;
  ingredient: string; // as written in the recipe, without the oz
}

export const NOT_MATCHED_TITLE = "Not matched, check this";

const KIT_OR_METHOD = /^(ice|crushed ice|water|hot water|salt|kosher salt|sea salt|pepper|black pepper|bitters|.* bitters|egg whites?|shaken|stirred|on the rocks|garnish)$/;

// Words too general to say two lines are the same thing.
const GENERIC = new Set(["fresh", "juice", "syrup", "simple", "liqueur", "soda", "water", "with", "top", "topped", "leaves", "leaf", "slices", "slice", "wedge", "wedges", "wheel", "wheels", "cream", "sparkling", "light", "dark", "dry", "sweet", "house", "made", "homemade", "spirit", "bottle", "bottles", "squeezed", "chilled", "muddled", "splash", "dash", "pinch", "float"]);

/** "2 oz fresh lime juice" -> "fresh lime juice"; "Top with Prosecco" -> "prosecco"; "6 mint leaves" -> "mint leaves". */
export function coreName(ingredient: string): string {
  return ingredient
    .toLowerCase()
    .replace(/crème/g, "creme")
    .replace(/^[\d./\s]+(oz|ounces?|ml|cl|tsp|tbsp|teaspoons?|tablespoons?|cups?|dashes|dash|drops?|barspoons?|bar spoons?)?\b\s*/i, "")
    .replace(/^(of\s+)/, "")
    .replace(/^(splash of|pinch of|dash of|drop of|squeeze of|muddled|top with|topped with|top off with|fill with|garnish with|garnished with|float of|rim with|a few|few)\s+/i, "")
    .replace(/^(of\s+)/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Brand names the list writes by kind: "St. Germain" is the "Elderflower liqueur" line.
const ALIASES: [RegExp, string][] = [
  [/\bst\.? ?germain\b|st germain/, "elderflower liqueur"],
  [/\bcointreau\b/, "triple sec"],
  [/\bkahl[uú]a\b|\bmr black\b/, "coffee liqueur"],
  [/\bchambord\b|\bframboise\b/, "raspberry liqueur"],
  [/\bdisaronno\b/, "amaretto"],
  [/\bbaileys\b/, "irish cream"],
  [/\bmalibu\b/, "coconut rum"],
  [/\bsoda\b$/, "soda water"],
];
const aliased = (core: string) => ALIASES.reduce((c, [re, to]) => (re.test(c) ? `${c} ${to}` : c), core);

const words = (s: string) => s.split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w)).map((w) => w.replace(/(es|s)$/, ""));

/** True when a list line (or a house syrup) stands for this ingredient. */
export function matches(ingredient: string, lineNames: string[]): boolean {
  const core = aliased(coreName(ingredient));
  if (!core) return true;
  const ws = words(core);
  for (const raw of lineNames) {
    const line = coreName(raw);
    if (!line) continue;
    if (line === core || line.includes(core) || core.includes(line)) return true;
    const lw = words(line);
    if (ws.some((w) => lw.includes(w))) return true;
  }
  return false;
}

/**
 * The recipe ingredients the list does not have. Mocktail follow ups carry no
 * recipe, so they have nothing to check. One entry per drink and ingredient.
 */
export function unmatchedIngredients(recipes: { name: string; ingredients: string[] }[], lineNames: string[]): Unmatched[] {
  const out: Unmatched[] = [];
  const seen = new Set<string>();
  for (const r of recipes) {
    for (const ing of r.ingredients ?? []) {
      const core = coreName(String(ing ?? ""));
      if (!core || KIT_OR_METHOD.test(core)) continue;
      if (matches(String(ing), lineNames)) continue;
      const key = `${r.name}|${core}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ drink: r.name, ingredient: core });
    }
  }
  return out;
}
