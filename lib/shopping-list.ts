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
  event_date?: string;
  bar_service_start?: string;
  bar_service_end?: string;
  theme?: string;
  event_colors?: string;
  special_requests?: string;
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
 * Returns drinks per guest based on drinking pace (over a 4-hour base).
 */
function drinksPerGuest(pace: string): number {
  const rates: Record<string, number> = {
    light: 2,
    moderate: 4,
    heavy: 6,
    mixed: 4,
  };
  return rates[pace?.toLowerCase()] ?? 4;
}

/**
 * Returns a multiplier based on hours booked to adjust total drinks.
 */
function hoursMultiplier(hours: number): number {
  if (hours <= 3) return 0.8;
  if (hours === 4) return 1.0;
  if (hours === 5) return 1.15;
  if (hours === 6) return 1.3;
  if (hours >= 7) return 1.45;
  return 1.0;
}

/**
 * Parse oz amount from an ingredient string like "2 oz vodka" or "0.75 oz lime juice".
 * Returns the oz amount or 0 if not found.
 */
function parseOz(ingredient: string): number {
  const match = ingredient.match(/^(\d+(?:\.\d+)?)\s*oz\b/i);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Check if an ingredient string refers to a specific spirit type.
 */
function ingredientMatchesSpirit(ingredient: string, spirit: string): boolean {
  const ingLower = ingredient.toLowerCase();
  const spiritLower = spirit.toLowerCase();
  // Strip oz prefix for matching
  const ingName = ingLower.replace(/^[\d.]+\s*oz\s*/i, "").trim();
  return ingName.includes(spiritLower);
}

/** Recipe-based spirit bottle calculation from actual drink recipes */
function getSpiritBottles(
  drinks: SignatureDrink[],
  guestCount: number,
  pace: string,
  barHours?: number
): ShoppingListItem[] {
  const hours = barHours ?? 4;
  const dpg = drinksPerGuest(pace);
  const hMult = hoursMultiplier(hours);
  const totalDrinks = guestCount * dpg * hMult;

  // Count alcoholic drinks only for splitting
  const alcoholicDrinks = drinks.filter(d => !d.is_mocktail);
  const numAlcoholicDrinks = alcoholicDrinks.length || 1;
  const drinksPerCocktail = totalDrinks / numAlcoholicDrinks;

  // Accumulate total oz needed per spirit across all drinks
  const spiritOzTotals = new Map<string, number>();
  // Track which spirits we find
  const spiritNames = new Map<string, string>(); // lowercase -> display name

  const brandRecs: Record<string, { top: string; moderate: string }> = {
    tequila: { top: "Clase Azul Plata", moderate: "Espolon Blanco" },
    vodka: { top: "Grey Goose", moderate: "Titos" },
    bourbon: { top: "Woodford Reserve", moderate: "Bulleit" },
    whiskey: { top: "Makers Mark", moderate: "Jack Daniels" },
    rum: { top: "Diplomatico Reserva", moderate: "Bacardi Superior" },
    gin: { top: "Hendricks", moderate: "Tanqueray" },
    cognac: { top: "Hennessy VS", moderate: "Courvoisier VS" },
    "spiced rum": { top: "Diplomatico Reserva", moderate: "Captain Morgan" },
    "coconut rum": { top: "Malibu", moderate: "Malibu" },
    "reposado": { top: "Clase Azul Reposado", moderate: "Espolon Reposado" },
    "tequila reposado": { top: "Clase Azul Reposado", moderate: "Espolon Reposado" },
    "tequila blanco": { top: "Clase Azul Plata", moderate: "Espolon Blanco" },
  };

  for (const drink of alcoholicDrinks) {
    const baseSpirit = drink.base_spirit?.toLowerCase()?.trim() || "";
    if (!baseSpirit || baseSpirit === "none" || baseSpirit === "n/a") continue;

    const ingredients = normalizeIngredients(drink.ingredients);

    // Find spirit ingredients in the recipe and sum oz
    for (const ing of ingredients) {
      const oz = parseOz(ing);
      if (oz <= 0) continue;

      const ingName = ing.replace(/^[\d.]+\s*oz\s*/i, "").trim().toLowerCase();

      // Check if this ingredient is a spirit (matches base spirit or known spirit names)
      const isSpirit = isLikelySpirit(ingName, baseSpirit);
      if (!isSpirit) continue;

      // Normalize spirit name for grouping
      const spiritKey = normalizeSpiritName(ingName, baseSpirit);
      const currentOz = spiritOzTotals.get(spiritKey) ?? 0;
      spiritOzTotals.set(spiritKey, currentOz + oz * drinksPerCocktail);

      if (!spiritNames.has(spiritKey)) {
        spiritNames.set(spiritKey, spiritKey.charAt(0).toUpperCase() + spiritKey.slice(1));
      }
    }
  }

  const items: ShoppingListItem[] = [];
  const isHeavy = pace?.toLowerCase() === "heavy";

  for (const [spiritKey, totalOz] of spiritOzTotals) {
    // Apply 0.65 factor (not all guests drink cocktails)
    const adjustedOz = totalOz * 0.65;
    let bottles = Math.ceil(adjustedOz / 25.4);
    bottles = Math.max(1, bottles);

    // Tequila gets extra bottle for shots if heavy pace
    const isTequila = spiritKey.includes("tequila") || spiritKey === "reposado";
    let notes: string | undefined;
    const rec = brandRecs[spiritKey] ?? brandRecs[spiritKey.split(" ")[0]];
    notes = rec
      ? `Top shelf: ${rec.top} or Moderate: ${rec.moderate}`
      : "Mid-range brand recommended";

    if (isTequila && isHeavy) {
      bottles += 1;
      notes += " (Extra bottle for shots)";
    }

    const low = Math.max(1, bottles - 1);
    const high = bottles;
    const label = spiritNames.get(spiritKey) ?? spiritKey.charAt(0).toUpperCase() + spiritKey.slice(1);
    items.push({
      category: "Spirits",
      item: label,
      quantity: `${low} to ${high} bottles (750 ml)`,
      notes,
    });
  }

  return items;
}

/** Check if an ingredient name is likely a spirit (not a mixer/syrup/juice) */
function isLikelySpirit(ingName: string, baseSpirit: string): boolean {
  const spiritKeywords = [
    "vodka", "tequila", "whiskey", "bourbon", "rum", "gin", "cognac", "brandy",
    "reposado", "blanco", "mezcal", "scotch", "aperol", "campari",
    "malibu", "spiced rum", "coconut rum", "gold rum", "dark rum",
    "jamaican rum", "empress gin",
  ];
  // Check if it matches the base spirit
  if (ingName.includes(baseSpirit.toLowerCase())) return true;
  // Check if it's a known spirit
  return spiritKeywords.some(kw => ingName.includes(kw));
}

/** Normalize spirit names so the same spirit from different drinks groups together */
function normalizeSpiritName(ingName: string, baseSpirit: string): string {
  const lower = ingName.toLowerCase();
  // Map specific variants to base names
  if (lower.includes("tequila blanco") || lower.includes("tequila reposado")) return lower;
  if (lower.includes("reposado") && !lower.includes("tequila")) return "tequila reposado";
  if (lower.includes("blanco") && !lower.includes("tequila")) return "tequila blanco";
  if (lower.includes("spiced rum")) return "spiced rum";
  if (lower.includes("coconut rum") || lower.includes("malibu")) return "coconut rum";
  if (lower.includes("gold rum")) return "gold rum";
  if (lower.includes("jamaican rum")) return "jamaican rum";
  if (lower.includes("empress gin")) return "gin";
  if (lower.includes("bourbon")) return "bourbon";
  // Fall back to base spirit
  return baseSpirit.toLowerCase();
}

/** Count how many signature drinks contain ginger beer */
function countGingerBeerDrinks(drinks: SignatureDrink[]): number {
  let count = 0;
  for (const drink of drinks) {
    const ingredients = normalizeIngredients(drink.ingredients);
    if (ingredients.some(ing => ing.toLowerCase().includes("ginger beer"))) {
      count++;
    }
  }
  return count;
}

/** Collect mixer/ingredient needs from all drinks */
function getMixersAndIngredients(
  drinks: SignatureDrink[],
  guestCount: number
): ShoppingListItem[] {
  const seen = new Set<string>();
  const items: ShoppingListItem[] = [];
  const gbDrinkCount = countGingerBeerDrinks(drinks);

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
        quantity: getClientMixerQuantity(ing, guestCount, gbDrinkCount),
      });
    }
  }

  return items;
}

/** Return real-packaging quantities for the client shopping list (no store sourcing) */
function getClientMixerQuantity(ingredient: string, guestCount: number, gingerBeerDrinkCount?: number): string {
  const key = ingredient.toLowerCase().trim();

  if (key.includes("simple syrup")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 33));
    return `${bottles} x 1 liter bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("lime juice")) {
    const sets = Math.max(1, Math.ceil(guestCount / 50));
    return `${sets * 2} x 32 oz bottle${sets * 2 === 1 ? "" : "s"}`;
  }
  if (key.includes("lemon juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 50));
    return `${bottles} x 48 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("club soda") || key.includes("soda water")) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} x 1 liter bottles`;
  }
  if (key.includes("tonic")) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} x 1 liter bottles`;
  }
  if (key.includes("ginger beer")) {
    const drinkCount = gingerBeerDrinkCount ?? 1;
    const cans = Math.max(12, Math.ceil((guestCount / 100) * 24 * drinkCount));
    return `${cans} x Goslings ginger beer 12 oz cans`;
  }
  if (key.includes("ginger ale")) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} x 1 liter bottles`;
  }
  if (key.includes("cranberry")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 96 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("orange juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 46 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("pineapple juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 46 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("pomegranate")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 48 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("coconut cream") || key.includes("coconut milk") || key.includes("cream of coconut")) {
    const cans = Math.max(1, Math.ceil(guestCount / 25));
    return `${cans} x 16.9 oz can${cans === 1 ? "" : "s"}`;
  }
  if (key.includes("grenadine")) return "1 x 1 liter bottle";
  if (key.includes("passion") || key.includes("passionfruit")) return "1 x 1 liter bottle";
  if (key.includes("mango puree") || key.includes("mango")) return "1 x 1 liter bottle";
  if (key.includes("peach puree") || key.includes("peach")) return "1 x 1 liter bottle";
  if (key.includes("strawberry puree") || key.includes("strawberry")) return "1 x 1 liter bottle";
  if (key.includes("lychee")) return "1 x 16.9 oz bottle";
  if (key.includes("pumpkin")) return "1 x 16.9 oz bottle";
  if (key.includes("prickly pear")) return "1 x 1 liter bottle";
  if (key.includes("black cherry") || key.includes("cherry")) return "1 x 16.9 oz bottle plus 1 x 11 oz jar cocktail cherries";
  if (key.includes("agave")) return "1 x 36 oz bottle";
  if (key.includes("honey")) return "1 x 48 oz bottle";
  if (key.includes("lavender") && key.includes("syrup")) return "1 bottle";
  if (key.includes("butterscotch") && key.includes("syrup")) return "1 bottle";
  if (key.includes("elderflower")) return "1 bottle";
  if (key.includes("bitters") || key.includes("angostura")) return "1 x 4 oz bottle";
  if (key.includes("lemonade")) return "1 x 128 oz jug";

  const units = Math.max(1, Math.ceil(guestCount / 25));
  return `${units} bottle${units === 1 ? "" : "s"}`;
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
  const barHours = calculateHours(eventData.bar_service_start, eventData.bar_service_end);

  // Spirits from signature drinks (recipe-based calculation)
  if (sigDrinks.length > 0) {
    items.push(
      ...getSpiritBottles(
        sigDrinks,
        eventData.guest_count ?? 50,
        eventData.drinking_pace ?? "moderate",
        barHours
      )
    );
  }

  // Beer (case-based guidelines)
  if (eventData.beer) {
    const gc = eventData.guest_count;
    let beerQty: string;
    if (gc <= 50) beerQty = "2 to 3 cases";
    else if (gc <= 100) beerQty = "3 to 5 cases";
    else if (gc <= 150) beerQty = "4 to 6 cases";
    else beerQty = "5 to 8 cases";
    items.push({
      category: "Beer & Wine",
      item: "Beer (variety pack or client preference)",
      quantity: beerQty,
    });
  }

  // Wine (case-based guidelines)
  if (eventData.wine) {
    const gc = eventData.guest_count;
    let wineQty: string;
    if (gc <= 50) wineQty = "1 to 2 cases";
    else if (gc <= 100) wineQty = "2 to 3 cases";
    else if (gc <= 150) wineQty = "3 to 4 cases";
    else wineQty = "3 to 5 cases";
    items.push({
      category: "Beer & Wine",
      item: "Wine (mix of red and white)",
      quantity: wineQty,
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

/** Compute mixer quantities for Natalie's supply list — clean format with sizes, no store sourcing */
function getNatalieMixerQuantity(ingredient: string, guestCount: number, gingerBeerDrinkCount?: number): string {
  const key = ingredient.toLowerCase().trim();

  if (key.includes("simple syrup")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 33));
    return `${bottles} x 1 liter bottle${bottles === 1 ? "" : "s"}`;
  }

  if (key.includes("lime juice")) {
    const sets = Math.max(1, Math.ceil(guestCount / 50));
    const bottles = sets * 2;
    return `${bottles} x 32 oz bottle${bottles === 1 ? "" : "s"}`;
  }

  if (key.includes("lemon juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 50));
    return `${bottles} x 48 oz bottle${bottles === 1 ? "" : "s"}`;
  }

  if (key.includes("club soda") || key.includes("soda water")) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} x 1 liter bottles`;
  }

  if (key.includes("tonic")) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} x 1 liter bottles`;
  }

  if (key.includes("ginger beer")) {
    const drinkCount = gingerBeerDrinkCount ?? 1;
    const cans = Math.max(12, Math.ceil((guestCount / 100) * 24 * drinkCount));
    return `${cans} cans (Goslings 12 oz, Sam's Club 24 ct or Walmart 12 ct)`;
  }

  if (key.includes("ginger ale")) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} x 1 liter bottles`;
  }

  if (key.includes("cranberry")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 96 oz bottle${bottles === 1 ? "" : "s"}`;
  }

  if (key.includes("orange juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 46 oz bottle${bottles === 1 ? "" : "s"}`;
  }

  if (key.includes("pineapple juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 46 oz bottle${bottles === 1 ? "" : "s"}`;
  }

  if (key.includes("pomegranate")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 48 oz bottle${bottles === 1 ? "" : "s"}`;
  }

  if (key.includes("coconut cream") || key.includes("coconut milk") || key.includes("cream of coconut")) {
    const cans = Math.max(1, Math.ceil(guestCount / 25));
    return `${cans} x 16.9 oz can${cans === 1 ? "" : "s"}`;
  }

  if (key.includes("grenadine")) return "1 x 1 liter bottle";
  if (key.includes("passion") || key.includes("passionfruit")) return "1 x 1 liter bottle";
  if (key.includes("mango puree") || key.includes("mango")) return "1 x 1 liter bottle";
  if (key.includes("peach puree") || key.includes("peach")) return "1 x 1 liter bottle";
  if (key.includes("strawberry puree") || key.includes("strawberry")) return "1 x 1 liter bottle";
  if (key.includes("lychee")) return "1 x 16.9 oz bottle";
  if (key.includes("pumpkin")) return "1 x 16.9 oz bottle";
  if (key.includes("prickly pear")) return "1 x 1 liter bottle";
  if (key.includes("black cherry") || key.includes("cherry")) return "1 x 16.9 oz bottle plus 1 x 11 oz jar cocktail cherries";
  if (key.includes("agave")) return "1 x 36 oz bottle";
  if (key.includes("honey")) return "1 x 48 oz bottle";
  if (key.includes("lavender") && key.includes("syrup")) return "1 x 12.7 oz bottle";
  if (key.includes("butterscotch") && key.includes("syrup")) return "1 x 12.7 oz bottle";
  if (key.includes("elderflower")) return "1 x 750 ml bottle";
  if (key.includes("bitters") || key.includes("angostura")) return "1 x 4 oz bottle";
  if (key.includes("lemonade")) return "1 x 128 oz jug";
  if (key.includes("triple sec")) return "1 x 750 ml bottle";
  if (key.includes("gulkand")) return "1 x 16 oz jar";

  const units = Math.max(1, Math.ceil(guestCount / 25));
  return `${units} x 1 liter bottle${units === 1 ? "" : "s"}`;
}

/** Parse garnish descriptions from all drinks and calculate real produce quantities */
function calculateProduceFromGarnishes(drinks: SignatureDrink[], guestCount: number): { item: string; quantity: string }[] {
  // Count how many drinks use each type of garnish
  const garnishCounts: Record<string, number> = {};

  for (const drink of drinks) {
    const g = typeof drink.garnish === "string" ? drink.garnish.toLowerCase().trim() : "";
    if (!g) continue;

    if (g.includes("lime")) garnishCounts["lime"] = (garnishCounts["lime"] || 0) + 1;
    if (g.includes("lemon")) garnishCounts["lemon"] = (garnishCounts["lemon"] || 0) + 1;
    if (g.includes("orange")) garnishCounts["orange"] = (garnishCounts["orange"] || 0) + 1;
    if (g.includes("mint")) garnishCounts["mint"] = (garnishCounts["mint"] || 0) + 1;
    if (g.includes("basil")) garnishCounts["basil"] = (garnishCounts["basil"] || 0) + 1;
    if (g.includes("rosemary")) garnishCounts["rosemary"] = (garnishCounts["rosemary"] || 0) + 1;
    if (g.includes("pineapple")) garnishCounts["pineapple"] = (garnishCounts["pineapple"] || 0) + 1;
    if (g.includes("watermelon")) garnishCounts["watermelon"] = (garnishCounts["watermelon"] || 0) + 1;
    if (g.includes("cucumber")) garnishCounts["cucumber"] = (garnishCounts["cucumber"] || 0) + 1;
    if (g.includes("jalapeno") || g.includes("jalapeño")) garnishCounts["jalapeno"] = (garnishCounts["jalapeno"] || 0) + 1;
    if (g.includes("habanero")) garnishCounts["habanero"] = (garnishCounts["habanero"] || 0) + 1;
    if (g.includes("tajin") || g.includes("chili salt") || g.includes("chile salt")) garnishCounts["tajin"] = (garnishCounts["tajin"] || 0) + 1;
    if (g.includes("cherry") || g.includes("cherries") || g.includes("maraschino")) garnishCounts["cherry"] = (garnishCounts["cherry"] || 0) + 1;
    if (g.includes("blackberr")) garnishCounts["blackberry"] = (garnishCounts["blackberry"] || 0) + 1;
    if (g.includes("strawberr")) garnishCounts["strawberry"] = (garnishCounts["strawberry"] || 0) + 1;
    if (g.includes("dried flower") || g.includes("edible flower") || g.includes("dried lavender")) garnishCounts["dried flower"] = (garnishCounts["dried flower"] || 0) + 1;
    if (g.includes("cinnamon")) garnishCounts["cinnamon"] = (garnishCounts["cinnamon"] || 0) + 1;
    if (g.includes("star anise")) garnishCounts["star anise"] = (garnishCounts["star anise"] || 0) + 1;
    if (g.includes("ginger") && !g.includes("ginger beer")) garnishCounts["ginger"] = (garnishCounts["ginger"] || 0) + 1;
  }

  const items: { item: string; quantity: string }[] = [];
  // Servings per item: assume each drink serves ~1/3 of guests (3 drinks split evenly)
  const numDrinks = drinks.filter(d => !d.is_mocktail).length || 1;

  for (const [garnish, drinkCount] of Object.entries(garnishCounts)) {
    // Portion of guests likely to order drinks with this garnish
    const servings = Math.ceil((guestCount * drinkCount) / numDrinks);

    switch (garnish) {
      case "lime": {
        // ~5 wheels per lime
        const limes = Math.max(10, Math.ceil(servings / 5));
        items.push({ item: "Limes", quantity: `${limes} (wheels)` });
        break;
      }
      case "lemon": {
        const lemons = Math.max(8, Math.ceil(servings / 5));
        items.push({ item: "Lemons", quantity: `${lemons} (wheels)` });
        break;
      }
      case "orange": {
        const oranges = Math.max(6, Math.ceil(servings / 4));
        items.push({ item: "Oranges", quantity: `${oranges} (wheels or slices)` });
        break;
      }
      case "mint": {
        // ~10 sprigs per bunch, ~2 leaves per drink
        const bunches = Math.max(3, Math.ceil(servings / 15));
        items.push({ item: "Mint", quantity: `${bunches} bunches` });
        break;
      }
      case "basil": {
        const bunches = Math.max(2, Math.ceil(servings / 20));
        items.push({ item: "Basil", quantity: `${bunches} bunches` });
        break;
      }
      case "rosemary": {
        const bunches = Math.max(2, Math.ceil(servings / 20));
        items.push({ item: "Rosemary", quantity: `${bunches} bunches` });
        break;
      }
      case "pineapple": {
        const pineapples = Math.max(2, Math.ceil(servings / 30));
        items.push({ item: "Pineapple", quantity: `${pineapples} whole (wedges)` });
        break;
      }
      case "watermelon": {
        const melons = Math.max(1, Math.ceil(servings / 50));
        items.push({ item: "Watermelon", quantity: `${melons} whole (wedges)` });
        break;
      }
      case "cucumber": {
        const cukes = Math.max(3, Math.ceil(servings / 15));
        items.push({ item: "Cucumbers", quantity: `${cukes} (sliced)` });
        break;
      }
      case "jalapeno": {
        const peppers = Math.max(5, Math.ceil(servings / 10));
        items.push({ item: "Jalapeno peppers", quantity: `${peppers} peppers (sliced)` });
        break;
      }
      case "habanero": {
        const peppers = Math.max(5, Math.ceil(servings / 10));
        items.push({ item: "Habanero peppers", quantity: `${peppers} peppers (sliced)` });
        break;
      }
      case "tajin":
        items.push({ item: "Tajin or chili salt", quantity: "1 large container" });
        break;
      case "cherry":
        items.push({ item: "Cocktail cherries", quantity: "1 x 10 oz jar" });
        break;
      case "blackberry": {
        const pints = Math.max(2, Math.ceil(servings / 30));
        items.push({ item: "Blackberries", quantity: `${pints} pints` });
        break;
      }
      case "strawberry": {
        const pints = Math.max(2, Math.ceil(servings / 20));
        items.push({ item: "Strawberries", quantity: `${pints} pints` });
        break;
      }
      case "dried flower":
        items.push({ item: "Dried edible flowers", quantity: "1 pack" });
        break;
      case "cinnamon":
        items.push({ item: "Cinnamon sticks", quantity: "1 container" });
        break;
      case "star anise":
        items.push({ item: "Star anise", quantity: "1 pack" });
        break;
      case "ginger": {
        const roots = Math.max(2, Math.ceil(servings / 30));
        items.push({ item: "Fresh ginger", quantity: `${roots} roots` });
        break;
      }
    }
  }

  return items;
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

  // Only generate for Essentials Bar, Full Bar, and Premium Bar packages
  const pkg = (eventData.package ?? "").toLowerCase();
  const isBeerAndWine = pkg.includes("beer") && pkg.includes("wine") && !pkg.includes("essentials") && !pkg.includes("full") && !pkg.includes("premium");
  const isBartenderOnly = pkg.includes("bartender");
  if (isBeerAndWine || isBartenderOnly) {
    return "";
  }

  const guestCount = eventData.guest_count ?? 50;
  const drinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];
  const pace = eventData.drinking_pace ?? "moderate";

  const parts: string[] = [];

  // --- LINE 1: Event header ---
  const packageLabel = eventData.package ?? "Full Bar";
  const eventDate = formatNatalieDate(eventData.event_date);
  const hours = calculateHours(eventData.bar_service_start, eventData.bar_service_end);
  parts.push(`<b style="color:#8B4513;">${eventDate} (${packageLabel}) ${guestCount} guests, ${hours} hours</b>`);

  // --- LINE 2: Theme ---
  const theme = eventData.theme || "No specific theme";
  parts.push(`Theme: ${theme}`);

  // --- LINE 3: Colors ---
  const colors = eventData.event_colors || "No specific colors";
  parts.push(`Colors: ${colors}`);

  // Blank line
  parts.push("");

  // --- SECTION 1: SPIRITS (client purchases, Natalie sees for reference) ---
  const spiritItems = getSpiritBottles(drinks, guestCount, pace, hours);
  if (spiritItems.length > 0) {
    parts.push("<b>SPIRITS</b>");
    for (const s of spiritItems) {
      const brandNote = s.notes ? ` ${s.notes.replace(/Top shelf: /, "").replace(/ or Moderate: /, " or ")}` : "";
      parts.push(`${s.item} — ${s.quantity}${brandNote}`);
    }
    parts.push("");
  }

  // --- SECTION 2: PUREES JUICES AND SYRUPS ---
  const pureeJuiceSyrupItems: { item: string; quantity: string }[] = [];
  const sodaItems: { item: string; quantity: string }[] = [];
  const seenMixers = new Set<string>();
  const gbDrinkCount = countGingerBeerDrinks(drinks);

  for (const drink of drinks) {
    const ingredients = normalizeIngredients(drink.ingredients);
    for (const ing of ingredients) {
      // Strip oz amounts to get the ingredient name for categorization
      const ingName = ing.replace(/^[\d.]+\s*oz\s*/i, "").trim();
      const key = ingName.toLowerCase();
      if (!key) continue;
      if (seenMixers.has(key)) continue;
      const baseSpirit = drink.base_spirit?.toLowerCase() ?? "__none__";
      if (baseSpirit && key.includes(baseSpirit)) continue;
      seenMixers.add(key);

      const quantity = getNatalieMixerQuantity(ingName, guestCount, gbDrinkCount);

      if (isSodaOrGingerBeer(key)) {
        sodaItems.push({ item: ingName, quantity });
      } else if (isPureeJuiceOrSyrup(key)) {
        pureeJuiceSyrupItems.push({ item: ingName, quantity });
      }
    }
  }

  if (pureeJuiceSyrupItems.length > 0) {
    parts.push("<b>PUREES JUICES AND SYRUPS</b>");
    for (const m of pureeJuiceSyrupItems) {
      const label = m.item.charAt(0).toUpperCase() + m.item.slice(1);
      parts.push(`${label} — ${m.quantity}`);
    }
    parts.push("");
  }

  // --- SECTION 3: GINGER BEER AND SODA ---
  // Add any extras requested by client (Diet Coke, Sprite, etc.)
  const extraSodas = parseExtraSodas(eventData.special_requests);
  for (const extra of extraSodas) {
    if (!seenMixers.has(extra.toLowerCase())) {
      seenMixers.add(extra.toLowerCase());
      sodaItems.push({ item: extra, quantity: "1 case (24 pack cans) (requested extras)" });
    }
  }

  if (sodaItems.length > 0) {
    parts.push("<b>GINGER BEER AND SODA</b>");
    for (const s of sodaItems) {
      const label = s.item.charAt(0).toUpperCase() + s.item.slice(1);
      parts.push(`${label} — ${s.quantity}`);
    }
    parts.push("");
  }

  // --- SECTION 4: PRODUCE AND GARNISH ---
  const produceItems = calculateProduceFromGarnishes(drinks, guestCount);
  if (produceItems.length > 0) {
    parts.push("<b>PRODUCE AND GARNISH</b>");
    for (const p of produceItems) {
      parts.push(`${p.item} — ${p.quantity}`);
    }
    parts.push("");
  }

  // --- SECTION 5: ICE & BAR SUPPLIES ---
  const iceLbs = guestCount * 1.5;
  const iceBags = Math.ceil(iceLbs / 18);
  const cups = Math.ceil(guestCount * 1.5);
  parts.push("<b>ICE & BAR SUPPLIES</b>");
  parts.push(`Ice — ${iceBags} x 18 lb bags`);
  parts.push(`12 oz cups — ${cups}`);
  parts.push("");

  // --- SECTION 6: BASELINE MIXERS ---
  parts.push("<b>BASELINE MIXERS</b>");
  parts.push("Cranberry juice — 1 x 32 oz bottle");
  parts.push("Pineapple juice — 1 x 32 oz bottle");
  parts.push("Orange juice — 1 x 32 oz bottle");
  parts.push("Tonic — 2 x 1 liter bottles");
  parts.push("Club soda — 2 x 1 liter bottles");
  parts.push("");

  // --- SECTION 7: SIGNATURE DRINK RECIPES ---
  if (drinks.length > 0) {
    parts.push("<b>SIGNATURE DRINK RECIPES</b>");
    parts.push("");
    for (const drink of drinks) {
      const mocktailLabel = drink.is_mocktail ? " (Mocktail)" : "";
      const drinkTitle = drink.is_mocktail
        ? `<b>${drink.name ?? "Unnamed Drink"}:</b> ${drink.name ?? ""}${mocktailLabel} - 12 oz cup`
        : `<b>${drink.name ?? "Unnamed Drink"}</b> - 12 oz cup`;
      parts.push(drinkTitle);

      const ingredients = normalizeIngredients(drink.ingredients);
      for (const ing of ingredients) {
        parts.push(ing);
      }

      if (drink.garnish) {
        parts.push(`<b>Garnish:</b> ${drink.garnish}`);
      }
      parts.push("");
    }
  }

  return parts.join("<br>");
}

/** Format event date as M/D/YY */
function formatNatalieDate(dateStr?: string): string {
  if (!dateStr) return "TBD";
  const cleaned = dateStr.replace(/(st|nd|rd|th)/gi, "").trim();
  let parsed = new Date(cleaned);
  if (isNaN(parsed.getTime())) {
    const withYear = cleaned + " " + new Date().getFullYear();
    parsed = new Date(withYear);
  }
  if (!isNaN(parsed.getTime())) {
    const month = parsed.getMonth() + 1;
    const day = parsed.getDate();
    const year = String(parsed.getFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
  }
  return dateStr;
}

/** Calculate hours between start and end time strings */
function calculateHours(start?: string, end?: string): number {
  if (!start || !end) return 5; // default
  try {
    const startH = parseTimeToHours(start);
    const endH = parseTimeToHours(end);
    let diff = endH - startH;
    if (diff <= 0) diff += 24;
    return Math.round(diff);
  } catch {
    return 5;
  }
}

function parseTimeToHours(time: string): number {
  const cleaned = time.toLowerCase().replace(/\s+/g, "");
  const pmMatch = cleaned.includes("pm");
  const amMatch = cleaned.includes("am");
  const nums = cleaned.replace(/[^\d:]/g, "");
  const [hStr, mStr] = nums.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr ? parseInt(mStr, 10) : 0;
  if (pmMatch && h < 12) h += 12;
  if (amMatch && h === 12) h = 0;
  return h + m / 60;
}

/** Check if ingredient is a soda or ginger beer */
function isSodaOrGingerBeer(key: string): boolean {
  return (
    key.includes("ginger beer") ||
    key.includes("ginger ale") ||
    key.includes("club soda") ||
    key.includes("soda water") ||
    key.includes("tonic") ||
    key.includes("cola") ||
    key.includes("coke") ||
    key.includes("sprite") ||
    key.includes("lemon lime") ||
    key.includes("7up") ||
    key.includes("dr pepper")
  );
}

/** Check if ingredient is a puree, juice, or syrup */
function isPureeJuiceOrSyrup(key: string): boolean {
  return (
    key.includes("puree") ||
    key.includes("juice") ||
    key.includes("syrup") ||
    key.includes("simple") ||
    key.includes("grenadine") ||
    key.includes("agave") ||
    key.includes("honey") ||
    key.includes("bitters") ||
    key.includes("triple sec") ||
    key.includes("elderflower") ||
    key.includes("lemonade") ||
    key.includes("cream of coconut") ||
    key.includes("coconut cream") ||
    key.includes("coconut milk")
  );
}

/** Parse special requests for extra sodas like Diet Coke, Sprite, etc. */
function parseExtraSodas(specialRequests?: string): string[] {
  if (!specialRequests) return [];
  const extras: string[] = [];
  const lower = specialRequests.toLowerCase();
  const sodaKeywords = [
    { match: "diet coke", label: "Diet Coke" },
    { match: "diet cola", label: "Diet Coke" },
    { match: "sprite", label: "Sprite" },
    { match: "dr pepper", label: "Dr Pepper" },
    { match: "ginger ale", label: "Ginger ale" },
    { match: "lemon lime", label: "Lemon lime soda" },
    { match: "7up", label: "7UP" },
    { match: "coca cola", label: "Coca Cola" },
    { match: "coke", label: "Coca Cola" },
    { match: "root beer", label: "Root beer" },
  ];
  for (const soda of sodaKeywords) {
    if (lower.includes(soda.match)) {
      extras.push(soda.label);
    }
  }
  return extras;
}

/**
 * Formats the shopping list into an HTML string matching Isabel's style.
 *
 * - Essentials / Full / Premium Bar (client buys alcohol only):
 *   Single "Liquor" section with spirits, beer, and wine as bullet points.
 *
 * - Bartender Only (client buys everything):
 *   Sections: Liquor, Mixers, Extras, Ice & Bar Supplies.
 */
export function formatShoppingList(items: ShoppingListItem[]): string {
  if (items.length === 0) return "";

  // Group items by category
  const grouped = new Map<string, ShoppingListItem[]>();
  for (const item of items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  const isBartenderOnly =
    grouped.has("Mixers & Ingredients") ||
    grouped.has("Garnishes") ||
    grouped.has("Supplies");

  const lines: string[] = [];

  // --- Format a single item line ---
  function formatItem(it: ShoppingListItem): string {
    let brandRec = "";
    if (it.notes) {
      // Convert "Top shelf: X or Moderate: Y" to "X or Y"
      const match = it.notes.match(/Top shelf:\s*(.+?)\s+or\s+Moderate:\s*(.+?)(?:\s*\(|$)/);
      if (match) {
        brandRec = ` ${match[1]} or ${match[2]}`;
      } else if (it.notes === "Mid-range brand recommended") {
        // skip generic note
      } else if (it.notes.includes("Extra bottle requested")) {
        brandRec = ` (${it.notes})`;
      }
    }
    return `• ${it.item} — ${it.quantity}${brandRec}`;
  }

  if (isBartenderOnly) {
    // --- LIQUOR ---
    const spirits = grouped.get("Spirits") ?? [];
    const beerWine = grouped.get("Beer & Wine") ?? [];
    if (spirits.length > 0 || beerWine.length > 0) {
      lines.push("<b>Liquor</b>");
      for (const it of spirits) lines.push(formatItem(it));
      for (const it of beerWine) lines.push(formatItem(it));
      lines.push("");
    }

    // --- MIXERS ---
    const mixers = grouped.get("Mixers & Ingredients") ?? [];
    if (mixers.length > 0) {
      lines.push("<b>Mixers</b>");
      for (const it of mixers) {
        lines.push(`• ${it.item.replace(/^[\d.]+\s*oz\s*/i, "").trim()} — ${it.quantity}`);
      }
      lines.push("");
    }

    // --- EXTRAS ---
    const garnishes = grouped.get("Garnishes") ?? [];
    if (garnishes.length > 0) {
      lines.push("<b>Extras</b>");
      for (const it of garnishes) {
        const note = it.notes ? ` ${it.notes}` : "";
        lines.push(`• ${it.item} — ${it.quantity}${note}`);
      }
      lines.push("");
    }

    // --- ICE & BAR SUPPLIES ---
    const supplies = grouped.get("Supplies") ?? [];
    if (supplies.length > 0) {
      lines.push("<b>Ice & Bar Supplies</b>");
      for (const it of supplies) {
        lines.push(`• ${it.item} — ${it.quantity}`);
      }
      lines.push("");
    }
  } else {
    // Essentials / Full / Premium — alcohol only
    const spirits = grouped.get("Spirits") ?? [];
    const beerWine = grouped.get("Beer & Wine") ?? [];
    lines.push("<b>Liquor</b>");
    for (const it of spirits) lines.push(formatItem(it));
    for (const it of beerWine) lines.push(formatItem(it));
    lines.push("");
  }

  // Join with <br>, trim trailing breaks
  return lines.join("<br>").replace(/(<br>)+$/, "");
}
