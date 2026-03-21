interface SignatureDrink {
  name: string;
  base_spirit: string;
  ingredients: string[] | string;
  garnish: string;
  method?: string;
  is_mocktail?: boolean;
}

interface EventData {
  guest_count: number;
  drinking_pace: string;
  package: string;
  signature_drinks: SignatureDrink[] | undefined;
  beer: boolean;
  wine: boolean;
  extra_bottles?: string;
  age_range?: string;
}

/** Normalize ingredients to always be a string array */
function normalizeIngredients(ingredients: string[] | string | undefined): string[] {
  if (!ingredients) return [];
  if (Array.isArray(ingredients)) return ingredients;
  if (typeof ingredients === "string") {
    return ingredients.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export interface ShoppingListItem {
  category: string;
  item: string;
  quantity: string;
  notes?: string;
}

/**
 * Returns the number of guests per bottle for a given pace.
 * Moderate: ~1 bottle per 25 guests, Heavy: ~1 per 17, Light: ~1 per 30.
 */
function guestsPerBottle(pace: string): number {
  const rates: Record<string, number> = {
    light: 30,
    moderate: 25,
    heavy: 17,
    mixed: 25,
  };
  return rates[pace?.toLowerCase()] ?? 25;
}

/** Collect unique spirits from all signature drinks */
function getSpiritBottles(
  drinks: SignatureDrink[],
  guestCount: number,
  pace: string,
  ageRange?: string
): ShoppingListItem[] {
  const spirits = new Set<string>();

  for (const drink of drinks) {
    const spirit = drink.base_spirit?.toLowerCase()?.trim();
    if (spirit) spirits.add(spirit);
  }

  const brandRecs: Record<string, { top: string; moderate: string }> = {
    tequila: { top: "Clase Azul Plata", moderate: "Espolon Blanco" },
    vodka: { top: "Grey Goose", moderate: "Titos" },
    bourbon: { top: "Woodford Reserve", moderate: "Bulleit" },
    whiskey: { top: "Makers Mark", moderate: "Jack Daniels" },
    rum: { top: "Diplomatico Reserva", moderate: "Bacardi Superior" },
    gin: { top: "Hendricks", moderate: "Tanqueray" },
    "triple sec": { top: "Cointreau", moderate: "DeKuyper" },
  };

  const perBottle = guestsPerBottle(pace);
  const isYoungCrowd = ageRange?.includes("21") || ageRange?.includes("21-30") || ageRange?.toLowerCase().includes("young");
  const isHeavy = pace?.toLowerCase() === "heavy";

  const items: ShoppingListItem[] = [];
  for (const spirit of Array.from(spirits)) {
    let bottles = Math.max(1, Math.ceil(guestCount / perBottle));

    // Tequila gets an extra bottle for shots if heavy pace or young crowd
    const isTequila = spirit === "tequila";
    let notes: string | undefined;
    const rec = brandRecs[spirit];
    notes = rec
      ? `Top shelf: ${rec.top} or Moderate: ${rec.moderate}`
      : "Mid-range brand recommended";

    if (isTequila && (isHeavy || isYoungCrowd)) {
      bottles += 1;
      notes += " (Extra bottle for shots)";
    }

    const label = spirit.charAt(0).toUpperCase() + spirit.slice(1);
    items.push({
      category: "Spirits",
      item: label,
      quantity: `${bottles} bottle${bottles === 1 ? "" : "s"} (750 ml)`,
      notes,
    });
  }

  return items;
}

/** Collect mixer/ingredient needs from all drinks */
function getMixersAndIngredients(
  drinks: SignatureDrink[],
  guestCount: number
): ShoppingListItem[] {
  const seen = new Set<string>();
  const items: ShoppingListItem[] = [];

  for (const drink of drinks) {
    const ingredients = normalizeIngredients(drink.ingredients);
    for (const ing of ingredients) {
      const key = ing.toLowerCase().trim();
      if (seen.has(key)) continue;
      // Skip the base spirit — it's already counted above
      if (
        key.includes(drink.base_spirit?.toLowerCase() ?? "__none__")
      )
        continue;
      seen.add(key);
      items.push({
        category: "Mixers & Ingredients",
        item: ing,
        quantity: guestCount <= 50 ? "1 to 2 units" : "2 to 3 units",
      });
    }
  }

  return items;
}

function getGarnishNotes(garnish: string): string | undefined {
  const key = garnish.toLowerCase();
  if (key.includes("lime")) return "Sam's Club (15 to 18 ct) or individual from Walmart";
  if (key.includes("lemon")) return "Sam's Club (7 to 10 ct) or individual from Walmart";
  if (key.includes("orange")) return "Sam's Club (8 to 12 ct) or individual from Walmart";
  if (key.includes("mint")) return "Fresh mint 0.5 oz clamshell from Walmart";
  if (key.includes("basil")) return "Fresh basil 0.5 oz clamshell from Walmart";
  if (key.includes("rosemary")) return "Fresh rosemary 0.5 oz clamshell from Walmart";
  if (key.includes("dried flower") || key.includes("dried lavender")) return "Specialty, order from Amazon";
  if (key.includes("maraschino")) return "GV maraschino cherries 10 oz jar from Walmart";
  return undefined;
}

function getGarnishes(drinks: SignatureDrink[]): ShoppingListItem[] {
  const seen = new Set<string>();
  const items: ShoppingListItem[] = [];

  for (const drink of drinks) {
    const g = typeof drink.garnish === "string" ? drink.garnish.trim() : "";
    if (!g || seen.has(g.toLowerCase())) continue;
    seen.add(g.toLowerCase());
    items.push({
      category: "Garnishes",
      item: g,
      quantity: "1 pack or bundle",
      notes: getGarnishNotes(g),
    });
  }

  return items;
}

function getSupplies(guestCount: number): ShoppingListItem[] {
  const cups = Math.ceil(guestCount * 3);
  return [
    {
      category: "Supplies",
      item: "Tossware 12 oz round bottom cups",
      quantity: `${cups} cups`,
      notes: "Buy from Tossware or Amazon",
    },
    {
      category: "Supplies",
      item: "Napkins",
      quantity: `${Math.ceil(guestCount * 3)} napkins`,
    },
    {
      category: "Supplies",
      item: "Agave cocktail straws",
      quantity: `${cups} straws`,
      notes: "Buy in bulk (1,000 to 2,000 ct)",
    },
    {
      category: "Supplies",
      item: "Ice",
      quantity: `${Math.ceil(guestCount * 1.5)} lbs`,
      notes: "Twice the Ice or Polar Ice location recommended. Reimburse up to $20.",
    },
  ];
}

/**
 * Generates a shopping list based on event data and package type.
 *
 * - Beer and Wine Package: returns empty array (no shopping list)
 * - Bartender Only: everything (spirits, mixers, garnishes, supplies)
 * - Essentials / Full / Premium: alcohol only
 */
export function generateShoppingList(eventData: EventData): ShoppingListItem[] {
  const pkg = (eventData.package ?? "").toLowerCase();

  // Beer and Wine — no shopping list
  if (pkg.includes("beer") && pkg.includes("wine") && !pkg.includes("bartender") && !pkg.includes("essentials") && !pkg.includes("full") && !pkg.includes("premium")) {
    return [];
  }

  const items: ShoppingListItem[] = [];

  const sigDrinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];

  // Spirits from signature drinks
  if (sigDrinks.length > 0) {
    items.push(
      ...getSpiritBottles(
        sigDrinks,
        eventData.guest_count ?? 50,
        eventData.drinking_pace ?? "moderate",
        eventData.age_range
      )
    );
  }

  // Beer
  if (eventData.beer) {
    const cases = Math.ceil(eventData.guest_count / 10);
    items.push({
      category: "Beer & Wine",
      item: "Beer (variety pack or client preference)",
      quantity: `${cases} case${cases === 1 ? "" : "s"}`,
    });
  }

  // Wine
  if (eventData.wine) {
    const wineBottles = Math.ceil(eventData.guest_count / 5);
    items.push({
      category: "Beer & Wine",
      item: "Wine (mix of red and white)",
      quantity: `${wineBottles} bottle${wineBottles === 1 ? "" : "s"}`,
    });
  }

  const isBartenderOnly = pkg.includes("bartender");

  // Bartender Only gets mixers, garnishes, and supplies too
  if (isBartenderOnly && sigDrinks.length > 0) {
    items.push(
      ...getMixersAndIngredients(sigDrinks, eventData.guest_count)
    );
    items.push(...getGarnishes(sigDrinks));

    items.push(...getSupplies(eventData.guest_count));
  }

  // Extra bottles
  if (eventData.extra_bottles) {
    items.push({
      category: "Spirits",
      item: eventData.extra_bottles,
      quantity: "1 bottle (750 ml)",
      notes: "Extra bottle requested by client",
    });
  }

  return items;
}

/** Compute mixer quantities using Natalie's exact formulas */
function getNatalieMixerQuantity(ingredient: string, guestCount: number): string {
  const key = ingredient.toLowerCase().trim();

  if (key.includes("simple syrup")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 33));
    return `${bottles} liter bottle${bottles === 1 ? "" : "s"} (make from cane sugar, 10 lb bag from Sam's Club)`;
  }

  if (key.includes("lime juice")) {
    const sets = Math.max(1, Math.ceil(guestCount / 50));
    const bottles = sets * 2;
    return `${bottles} x 32oz bottle${bottles === 1 ? "" : "s"} (RealLime from Sam's Club or Walmart)`;
  }

  if (key.includes("lemon juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 50));
    return `${bottles} x 48oz bottle${bottles === 1 ? "" : "s"} (RealLemon from Sam's Club or Walmart)`;
  }

  if (key.includes("club soda") || key.includes("soda water")) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} liters (GV soda water 1L from Walmart)`;
  }

  if (key.includes("tonic")) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} liters (GV tonic water 1L from Walmart)`;
  }

  if (key.includes("ginger beer")) {
    const cans = Math.max(12, Math.ceil(guestCount / 2));
    return `${cans} cans (Goslings ginger beer 12 oz, Sam's Club 24 ct or Walmart 12 ct)`;
  }

  if (key.includes("ginger ale")) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} liters`;
  }

  if (key.includes("cranberry")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} bottle${bottles === 1 ? "" : "s"} (2 x 96 oz from Sam's Club)`;
  }

  if (key.includes("orange juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} bottle${bottles === 1 ? "" : "s"} (2 x 54 oz from Sam's Club or Simply Orange 46 oz from Walmart)`;
  }

  if (key.includes("pineapple juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} bottle${bottles === 1 ? "" : "s"} (Dole 46 oz from Walmart)`;
  }

  if (key.includes("pomegranate")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} bottle${bottles === 1 ? "" : "s"} (POM Wonderful 60 oz from Sam's Club or 48 oz from Walmart)`;
  }

  if (key.includes("coconut cream") || key.includes("coconut milk") || key.includes("cream of coconut")) {
    const cans = Math.max(1, Math.ceil(guestCount / 25));
    return `${cans} can${cans === 1 ? "" : "s"} (REAL Brand Cream of Coconut 16.9 oz from Specs)`;
  }

  if (key.includes("grenadine")) {
    return `1 bottle (Finest Call 1L from Specs)`;
  }

  if (key.includes("passion") || key.includes("passionfruit")) {
    return `1 bottle (Finest Call Passionfruit Puree 1L from Specs)`;
  }

  if (key.includes("mango puree") || key.includes("mango")) {
    return `1 bottle (Finest Call Mango Puree 1L from Specs or REAL Brand 16.9 oz)`;
  }

  if (key.includes("peach puree") || key.includes("peach")) {
    return `1 bottle (Finest Call Peach Puree 1L from Specs or REAL Brand 16.9 oz)`;
  }

  if (key.includes("strawberry puree") || key.includes("strawberry")) {
    return `1 bottle (Finest Call Strawberry Puree 1L from Specs)`;
  }

  if (key.includes("lychee")) {
    return `1 bottle (REAL Brand Lychee Puree 16.9 oz from Specs)`;
  }

  if (key.includes("pumpkin")) {
    return `1 bottle (REAL Brand Pumpkin Spice Puree 16.9 oz from Specs)`;
  }

  if (key.includes("prickly pear")) {
    return `1 bottle (Finest Call Prickly Pear Syrup 1L or REAL Brand 16.9 oz from Specs)`;
  }

  if (key.includes("black cherry") || key.includes("cherry")) {
    return `1 bottle (REAL Brand Black Cherry Puree 16.9 oz from Specs) plus GV cocktail cherries 11 oz from Walmart`;
  }

  if (key.includes("agave")) {
    return `1 bottle (Kirkland agave 2 x 36 oz from Sam's Club or Wholesome 36 oz from Walmart)`;
  }

  if (key.includes("honey")) {
    return `1 bottle (48 oz from Sam's Club or Bettergoods hot honey 12 oz from Walmart)`;
  }

  if (key.includes("lavender") && key.includes("syrup")) {
    return `1 bottle (specialty, order from Amazon)`;
  }

  if (key.includes("butterscotch") && key.includes("syrup")) {
    return `1 bottle (specialty, order from Amazon)`;
  }

  if (key.includes("elderflower")) {
    return `1 bottle (specialty, order from Amazon or liquor store)`;
  }

  if (key.includes("bitters") || key.includes("angostura")) {
    return `1 bottle (Angostura bitters 4 oz from Walmart)`;
  }

  if (key.includes("lemonade")) {
    return `1 jug (Milo's lemonade 128 oz from Walmart)`;
  }

  const units = Math.max(1, Math.ceil(guestCount / 25));
  return `${units} unit${units === 1 ? "" : "s"}`;
}

/**
 * Generates Natalie's supply list — everything she needs to know to prep and shop.
 *
 * Includes:
 * 1. Signature drink recipes (name, base spirit, ingredients, garnish, method)
 * 2. Mixers & ingredients with exact quantity formulas
 * 3. Garnishes
 * 4. Supplies (cups, napkins, straws, ice)
 * 5. Base spirits labeled as "Client is purchasing" with brand recommendations
 */
export function generateNatalieSupplyList(eventData: EventData): string {
  console.log("[generateNatalieSupplyList] eventData received:", JSON.stringify(eventData, null, 2));

  const guestCount = eventData.guest_count ?? 50;
  const drinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];
  const pace = eventData.drinking_pace ?? "moderate";

  const lines: string[] = ["NATALIE'S SUPPLY LIST", ""];

  // --- Section 1: Signature Drink Recipes ---
  if (drinks.length > 0) {
    lines.push("SIGNATURE DRINKS:");
    for (const drink of drinks) {
      const ingredients = normalizeIngredients(drink.ingredients);
      lines.push(`  ${drink.name ?? "Unnamed Drink"} (Base Spirit: ${drink.base_spirit ?? "N/A"})`);
      lines.push(`    Ingredients: ${ingredients.length > 0 ? ingredients.join(", ") : "N/A"}`);
      lines.push(`    Garnish: ${drink.garnish ?? "None"}`);
      lines.push(`    Method: ${drink.method ?? "Shake and strain"}`);
      lines.push("");
    }
  }

  // --- Section 2: Mixers & Ingredients (with exact formulas) ---
  const seenMixers = new Set<string>();
  const mixerItems: { item: string; quantity: string }[] = [];

  for (const drink of drinks) {
    const ingredients = normalizeIngredients(drink.ingredients);
    for (const ing of ingredients) {
      const key = ing.toLowerCase().trim();
      if (!key) continue;
      if (seenMixers.has(key)) continue;
      // Skip the base spirit — listed separately below
      if (key.includes(drink.base_spirit?.toLowerCase() ?? "__none__")) continue;
      seenMixers.add(key);
      mixerItems.push({
        item: ing,
        quantity: getNatalieMixerQuantity(ing, guestCount),
      });
    }
  }

  if (mixerItems.length > 0) {
    lines.push("MIXERS & INGREDIENTS:");
    for (const m of mixerItems) {
      lines.push(`  - ${m.item}: ${m.quantity}`);
    }
    lines.push("");
  }

  // --- Section 3: Garnishes ---
  const seenGarnishes = new Set<string>();
  const garnishItems: string[] = [];
  for (const drink of drinks) {
    const g = typeof drink.garnish === "string" ? drink.garnish.trim() : "";
    if (!g || seenGarnishes.has(g.toLowerCase())) continue;
    seenGarnishes.add(g.toLowerCase());
    garnishItems.push(g);
  }
  if (garnishItems.length > 0) {
    lines.push("GARNISHES:");
    for (const g of garnishItems) {
      lines.push(`   ${g} (fresh from Sam's Club or Walmart, or specialty from Amazon)`);
    }
    lines.push("");
  }

  // --- Section 4: Supplies ---
  const cups = Math.ceil(guestCount * 3);
  lines.push("SUPPLIES:");
  lines.push(`  - Tossware 12 oz round bottom cups: ${cups} cups (Buy from Tossware or Amazon)`);
  lines.push(`  - Napkins: ${Math.ceil(guestCount * 3)} napkins`);
  lines.push(`  - Agave cocktail straws: ${cups} straws (Buy in bulk, 1,000 to 2,000 ct)`);
  lines.push(
    `  - Ice: ${Math.ceil(guestCount * 1.5)} lbs (Twice the Ice or Polar Ice location recommended. Reimburse up to $20.)`
  );
  lines.push("");

  // --- Section 5: Base Spirits (Client is purchasing) ---
  const spiritItems = getSpiritBottles(drinks, guestCount, pace, eventData.age_range);
  if (spiritItems.length > 0) {
    lines.push("BASE SPIRITS (Client is purchasing — do NOT buy these):");
    for (const s of spiritItems) {
      let line = `  - ${s.item}: ${s.quantity}`;
      if (s.notes) line += ` (${s.notes})`;
      lines.push(line);
    }
    lines.push("");
  }

  // Beer & Wine if applicable
  const beerWineLines: string[] = [];
  if (eventData.beer) {
    const cases = Math.ceil(guestCount / 10);
    beerWineLines.push(
      `  - Beer (variety pack or client preference): ${cases} case${cases === 1 ? "" : "s"}`
    );
  }
  if (eventData.wine) {
    const wineBottles = Math.ceil(guestCount / 5);
    beerWineLines.push(
      `  - Wine (mix of red and white): ${wineBottles} bottle${wineBottles === 1 ? "" : "s"}`
    );
  }
  if (beerWineLines.length > 0) {
    lines.push("BEER & WINE (Client is purchasing):");
    lines.push(...beerWineLines);
    lines.push("");
  }

  return lines.join("<br>").trim();
}

/**
 * Formats the shopping list into a human-readable text string grouped by category.
 */
export function formatShoppingList(items: ShoppingListItem[]): string {
  if (items.length === 0) return "";

  const grouped = new Map<string, ShoppingListItem[]>();
  for (const item of items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  const lines: string[] = ["SHOPPING LIST", ""];

  for (const [category, categoryItems] of grouped) {
    lines.push(category.toUpperCase());
    for (const it of categoryItems) {
      let line = `  - ${it.item}: ${it.quantity}`;
      if (it.notes) line += ` (${it.notes})`;
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("<br>").trim();
}
