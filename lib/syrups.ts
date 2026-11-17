// Syrup recipes on the Shopping list. Pure, no database, no imports, so the
// admin Shopping list, the bartender Supplies tab, and the tests share it.
//
// Nothing here makes up a recipe. The library (syrup_recipes) is what admins
// enter under Syrup recipes. For one event:
//   1. Every house made syrup or prep item the event's drinks use is found in
//      the drinks' ingredient lines (the same recipes the cocktail recipes
//      section shows): any ingredient with "syrup" in it, and any ingredient
//      that is a library recipe's name or alias.
//   2. Each is matched to a library recipe by name or alias.
//   3. A library entry marked "Bought, never made" is always "Store bought"
//      with no recipe, store set or not. A syrup whose Shopping list line has
//      a store set is bought ready made too: "Store bought", no recipe.
//   4. Otherwise it shows the recipe (with this event's edit on top, if any),
//      or "Recipe needed" when the library has none.
//   5. The batch scales the recipe to the amount on its Shopping list line
//      (4 x 1 liter bottles is about 135 oz). No line or no readable amount,
//      no batch. Nothing here works out a quantity of its own.

export interface SyrupIngredient {
  amount: number | null; // null: "a pinch of salt" is shown as is and never scaled
  unit: string; // "cup", "oz", "" for a count
  item: string; // "sugar"
}

export interface SyrupRecipe {
  id: string;
  name: string;
  aliases: string[];
  ingredients: SyrupIngredient[];
  ratio: string; // "1:1 sugar to water, by volume"
  method: string;
  yieldAmount: number | null;
  yieldUnit: string;
  shelfLife: string;
  bought: boolean; // "Bought, never made": Store bought on every event, no recipe
  updatedBy?: string | null;
  updatedAt?: string | null;
}

/** A recipe changed for one event (order_sheet_meta.syrup_edits), everything but the name and aliases. */
export interface SyrupEdit {
  ingredients: SyrupIngredient[];
  ratio: string;
  method: string;
  yieldAmount: number | null;
  yieldUnit: string;
  shelfLife: string;
  by?: string | null;
  at?: string | null;
}

/** A line of the Shopping list, as much as this needs. */
export interface SyrupSheetLine {
  name: string;
  quantity: string;
  size: string;
  text: string; // "Simple syrup — 4 x 1 liter bottles"
  store: string | null;
}

export interface SyrupView {
  key: string; // the syrup's name as a slug, for this event's edit
  name: string; // "Simple syrup"
  drinks: string[]; // the drinks that use it
  status: "recipe" | "needed" | "store";
  storeName: string | null; // for "Store bought"
  libraryId: string | null;
  recipe: {
    ingredients: string[]; // "1 cup sugar"
    ratio: string;
    method: string;
    yield: string; // "about 1.5 cups"
    shelfLife: string;
  } | null;
  edit: SyrupEdit | null; // the raw recipe the editor starts from (this event's edit, or the library's)
  edited: boolean;
  editedBy: string | null;
  batch: { from: string; makes: string; ingredients: string[] } | null;
  batchNote: string; // why there is no batch, when there is none
}

// ----- Names -----

/** "Honey Syrup (house made)" as "honey syrup": lower case, single spaces, no punctuation or house made note. */
export function normalName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\((?:house ?made|homemade|fresh)\)/g, " ")
    .replace(/\b(?:house ?made|homemade)\b/g, " ")
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const syrupKey = (name: string) => normalName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "syrup";

const POUR = /^\s*(?:about\s+)?(?:(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?\s*(?:fl\.?\s*oz|oz|ounces?|ml|cl|dashes|dash|barspoons?|bar spoons?|tsp|teaspoons?|tbsp|tablespoons?|parts?|splash(?:es)?|drops?|cups?)?\.?\s+(?:of\s+)?)?/i;

/** "0.5 oz simple syrup" as "simple syrup". "Top with ginger beer" and the like come back as is. */
export function ingredientName(line: string): string {
  return normalName(line.replace(POUR, "").replace(/,.*$/, ""));
}

function names(r: Pick<SyrupRecipe, "name" | "aliases">): string[] {
  return [r.name, ...r.aliases].map(normalName).filter(Boolean);
}

/** The library recipe for an ingredient name, by name or alias. */
export function matchRecipe(name: string, library: SyrupRecipe[]): SyrupRecipe | null {
  const n = normalName(name);
  return library.find((r) => names(r).includes(n)) ?? null;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The house made syrups and prep items the drinks use, in the order they first
 * appear: anything with "syrup" in it, and any library recipe's name or alias.
 */
export function drinkSyrups(drinks: { name: string; ingredients: string[] }[], library: SyrupRecipe[]): { name: string; drinks: string[]; recipe: SyrupRecipe | null }[] {
  const out = new Map<string, { name: string; drinks: string[]; recipe: SyrupRecipe | null }>();
  for (const d of drinks) {
    for (const line of d.ingredients) {
      const n = ingredientName(line);
      if (!n) continue;
      const recipe = matchRecipe(n, library);
      if (!recipe && !/\bsyrups?\b/.test(n)) continue;
      // Two names for one library recipe ("simple", "simple syrup") are one syrup.
      const key = recipe ? `lib:${recipe.id}` : n;
      const hit = out.get(key) ?? { name: recipe ? recipe.name : capital(n), drinks: [], recipe };
      if (!hit.drinks.includes(d.name)) hit.drinks.push(d.name);
      out.set(key, hit);
    }
  }
  return [...out.values()];
}

/** The Shopping list line for a syrup: its name or any alias. */
export function sheetLineFor(name: string, recipe: SyrupRecipe | null, lines: SyrupSheetLine[]): SyrupSheetLine | null {
  const want = new Set(recipe ? names(recipe) : [normalName(name)]);
  want.add(normalName(name));
  return lines.find((l) => want.has(normalName(l.name))) ?? null;
}

// ----- Amounts -----

/** Fluid ounces in one of each volume unit. Weights and counts are not here, so they are never converted. */
const OZ: Record<string, number> = {
  oz: 1,
  "fl oz": 1,
  ounce: 1,
  ml: 1 / 29.5735,
  cl: 10 / 29.5735,
  l: 33.814,
  liter: 33.814,
  litre: 33.814,
  gallon: 128,
  gal: 128,
  quart: 32,
  qt: 32,
  pint: 16,
  pt: 16,
  cup: 8,
  tbsp: 0.5,
  tablespoon: 0.5,
  tsp: 1 / 6,
  teaspoon: 1 / 6,
};

/** Fluid ounces in one of a volume unit ("Liters", "fl. oz", "cups"), or null for weights, counts, and anything else. */
export function ozPer(unit: string): number | null {
  const k = unit.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (k === "fl oz" || k === "floz" || k === "ounces") return 1;
  for (const c of [k, k.replace(/s$/, ""), k.replace(/es$/, "")]) if (OZ[c] !== undefined) return OZ[c];
  return null;
}

const NUM = "(\\d+(?:\\.\\d+)?)";
const UNIT = "(fl\\.?\\s*oz|oz|ounces?|ml|cl|liters?|litres?|l|gallons?|gal|quarts?|qt|pints?|pt|cups?)";

/**
 * Fluid ounces on a Shopping list line: "4 bottles" of "1 liter" is about
 * 135 oz, "2 x 750 ml bottles" is about 50.7, "64 oz" is 64. Null when the
 * line has no readable volume.
 */
export function lineOunces(line: Pick<SyrupSheetLine, "quantity" | "size">): number | null {
  const q = line.quantity.trim();
  const size = line.size.trim();
  const sizeM = size.match(new RegExp(`^${NUM}\\s*${UNIT}$`, "i"));
  const countM = q.match(/^(\d+(?:\.\d+)?)\b/);
  if (sizeM && countM) {
    const per = ozPer(sizeM[2]);
    if (per !== null) return Number(countM[1]) * Number(sizeM[1]) * per;
  }
  const times = q.match(new RegExp(`^${NUM}\\s*x\\s*${NUM}\\s*${UNIT}\\b`, "i"));
  if (times) {
    const per = ozPer(times[3]);
    if (per !== null) return Number(times[1]) * Number(times[2]) * per;
  }
  const plain = q.match(new RegExp(`^${NUM}\\s*${UNIT}\\b`, "i"));
  if (plain) {
    const per = ozPer(plain[2]);
    if (per !== null) return Number(plain[1]) * per;
  }
  return null;
}

/** 1.5 as "1.5", 0.3333 as "0.33", 12 as "12". */
export function amountText(n: number): string {
  const r = n >= 10 ? Math.round(n * 2) / 2 : n >= 1 ? Math.round(n * 4) / 4 : Math.round(n * 100) / 100;
  return String(Number(r.toFixed(2)));
}

export function ingredientText(i: SyrupIngredient, factor = 1): string {
  if (i.amount === null) return i.item;
  return [amountText(i.amount * factor), i.unit, i.item].filter(Boolean).join(" ");
}

/** "1 1/2 cups sugar", "2 oz honey", "a pinch of salt" as an ingredient. */
export function parseIngredient(line: string): SyrupIngredient | null {
  const s = line.replace(/\s+/g, " ").trim();
  if (!s) return null;
  const m = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+(.*)$/);
  if (!m) return { amount: null, unit: "", item: s.slice(0, 120) };
  const raw = m[1];
  let amount: number;
  if (raw.includes("/")) {
    const parts = raw.split(" ");
    const frac = parts[parts.length - 1].split("/").map(Number);
    amount = (parts.length > 1 ? Number(parts[0]) : 0) + frac[0] / frac[1];
  } else amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return { amount: null, unit: "", item: s.slice(0, 120) };
  const rest = m[2];
  const u = rest.match(/^(fl\.?\s*oz|oz|ounces?|ml|cl|liters?|litres?|l|gallons?|gal|quarts?|qt|pints?|pt|cups?|tbsp|tablespoons?|tsp|teaspoons?|grams?|g|kg|lbs?|pounds?|sticks?|pieces?|whole|large|medium|small)\b\.?\s*(?:of\s+)?(.*)$/i);
  if (u) return { amount, unit: u[1].toLowerCase(), item: u[2].trim().slice(0, 120) || u[1] };
  return { amount, unit: "", item: rest.slice(0, 120) };
}

/** The batch for this event: the recipe scaled to the Shopping list line's volume. */
export function batchFor(recipe: Pick<SyrupEdit, "ingredients" | "yieldAmount" | "yieldUnit">, line: SyrupSheetLine | null): { batch: SyrupView["batch"]; note: string } {
  if (!line) return { batch: null, note: "No line for it on the Shopping list, so no batch amount." };
  const need = lineOunces(line);
  if (need === null) return { batch: null, note: `The Shopping list line (${line.text}) has no amount to scale to.` };
  const per = recipe.yieldAmount && recipe.yieldAmount > 0 ? ozPer(recipe.yieldUnit) : null;
  if (per === null || !recipe.yieldAmount) return { batch: null, note: "Add the recipe's yield as a volume (like 1.5 cups) to scale a batch." };
  const factor = need / (recipe.yieldAmount * per);
  return {
    batch: {
      from: `${line.text}, about ${amountText(need)} oz`,
      makes: `${amountText(recipe.yieldAmount * factor)} ${recipe.yieldUnit}`.trim(),
      ingredients: recipe.ingredients.map((i) => ingredientText(i, factor)),
    },
    note: "",
  };
}

function editOf(v: unknown): SyrupEdit | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    ingredients: Array.isArray(o.ingredients) ? (o.ingredients as SyrupIngredient[]).filter((i) => i && typeof i === "object" && typeof i.item === "string") : [],
    ratio: String(o.ratio ?? ""),
    method: String(o.method ?? ""),
    yieldAmount: typeof o.yieldAmount === "number" && o.yieldAmount > 0 ? o.yieldAmount : null,
    yieldUnit: String(o.yieldUnit ?? ""),
    shelfLife: String(o.shelfLife ?? ""),
    by: typeof o.by === "string" ? o.by : null,
    at: typeof o.at === "string" ? o.at : null,
  };
}

const asEdit = (r: SyrupRecipe): SyrupEdit => ({ ingredients: r.ingredients, ratio: r.ratio, method: r.method, yieldAmount: r.yieldAmount, yieldUnit: r.yieldUnit, shelfLife: r.shelfLife });

/** Every syrup the event's drinks use, each with its recipe, store, or "Recipe needed". */
export function syrupViews(o: {
  drinks: { name: string; ingredients: string[] }[];
  library: SyrupRecipe[];
  lines: SyrupSheetLine[];
  storeName: (id: string) => string;
  edits?: unknown; // order_sheet_meta.syrup_edits
}): SyrupView[] {
  const edits = o.edits && typeof o.edits === "object" ? (o.edits as Record<string, unknown>) : {};
  return drinkSyrups(o.drinks, o.library).map((s) => {
    const key = syrupKey(s.name);
    const line = sheetLineFor(s.name, s.recipe, o.lines);
    const base = { key, name: s.name, drinks: s.drinks, libraryId: s.recipe?.id ?? null };
    if (line?.store || s.recipe?.bought) {
      return { ...base, status: "store" as const, storeName: line?.store ? o.storeName(line.store) || null : null, recipe: null, edit: null, edited: false, editedBy: null, batch: null, batchNote: "" };
    }
    if (!s.recipe) {
      return { ...base, status: "needed" as const, storeName: null, recipe: null, edit: null, edited: false, editedBy: null, batch: null, batchNote: "" };
    }
    const own = Object.prototype.hasOwnProperty.call(edits, key) ? editOf(edits[key]) : null;
    const r = own ?? asEdit(s.recipe);
    const { batch, note } = batchFor(r, line);
    return {
      ...base,
      status: "recipe" as const,
      storeName: null,
      recipe: {
        ingredients: r.ingredients.map((i) => ingredientText(i)),
        ratio: r.ratio,
        method: r.method,
        yield: r.yieldAmount ? `${amountText(r.yieldAmount)} ${r.yieldUnit}`.trim() : "",
        shelfLife: r.shelfLife,
      },
      edit: r,
      edited: !!own,
      editedBy: own?.by ?? null,
      batch,
      batchNote: note,
    };
  });
}

// ----- Cleaning what an admin typed -----

const text = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);
const oneLine = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Ingredient lines from a textarea (one per line) or an array. */
export function cleanIngredients(raw: unknown): SyrupIngredient[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split("\n");
  return list
    .map((x) => (x && typeof x === "object" ? ingredientText(x as SyrupIngredient) : String(x ?? "")))
    .map(parseIngredient)
    .filter((x): x is SyrupIngredient => x !== null)
    .slice(0, 20);
}

function cleanYield(raw: Record<string, unknown>): { amount: number | null; unit: string } | { error: string } {
  const a = String(raw.yieldAmount ?? "").trim();
  const unit = oneLine(raw.yieldUnit, 20);
  if (!a) return { amount: null, unit };
  const n = parseIngredient(`${a} x`)?.amount ?? null;
  if (n === null) return { error: "Enter the yield as a number, like 1.5." };
  return { amount: Math.round(n * 1000) / 1000, unit };
}

export type Clean<T> = { ok: true; value: T } | { ok: false; error: string };

/** A per event edit from the Shopping list form. */
export function cleanSyrupEdit(raw: Record<string, unknown>, noIngredients = false): Clean<SyrupEdit> {
  const ingredients = cleanIngredients(raw.ingredients);
  if (ingredients.length === 0 && !noIngredients) return { ok: false, error: "A recipe needs at least one ingredient." };
  const y = cleanYield(raw);
  if ("error" in y) return { ok: false, error: y.error };
  return { ok: true, value: { ingredients, ratio: oneLine(raw.ratio, 120), method: text(raw.method, 2000), yieldAmount: y.amount, yieldUnit: y.unit, shelfLife: oneLine(raw.shelfLife, 200) } };
}

/** A library recipe from the Syrup recipes form. */
export function cleanSyrupRecipe(raw: Record<string, unknown>): Clean<Omit<SyrupRecipe, "id">> {
  const name = oneLine(raw.name, 80);
  if (!name) return { ok: false, error: "Give the recipe a name, like Simple syrup." };
  const bought = raw.bought === true || raw.bought === "true";
  // Bought, never made: nothing to make, so it needs no ingredients.
  const edit = cleanSyrupEdit(raw, bought);
  if (!edit.ok) return edit;
  const aliases = [...new Set((Array.isArray(raw.aliases) ? raw.aliases.map(String) : String(raw.aliases ?? "").split(/[,\n]/)).map((a) => oneLine(a, 80)).filter((a) => a && normalName(a) !== normalName(name)))].slice(0, 20);
  const { by: _by, at: _at, ...rest } = edit.value;
  void _by;
  void _at;
  return { ok: true, value: { name, aliases, ...rest, bought } };
}

/** True when an event's edit says exactly what the library says, so it is not an edit. */
export function sameSyrup(e: SyrupEdit, r: SyrupRecipe): boolean {
  const ing = (l: SyrupIngredient[]) => l.map((i) => ingredientText(i)).join("\n");
  return ing(e.ingredients) === ing(r.ingredients) && e.ratio === r.ratio && e.method === r.method && e.yieldAmount === r.yieldAmount && e.yieldUnit === r.yieldUnit && e.shelfLife === r.shelfLife;
}

/** Where "Recipe needed" sends an admin: the library, with the name filled in. */
export function addRecipeHref(name: string): string {
  return `/team/admin/syrups?add=${encodeURIComponent(name)}`;
}
