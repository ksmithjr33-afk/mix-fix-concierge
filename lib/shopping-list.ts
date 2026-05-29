interface SignatureDrink {
  name: string;
  base_spirit: string;
  ingredients: string[] | string;
  garnish: string;
  method?: string;
  is_mocktail?: boolean;
}

interface EventData {
  guest_count: number | string;
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
  event_type?: string;
  event_name?: string;
  client_name?: string;
  menu_colors?: string;
  event_location?: string;
  venue_type?: string;
  client_providing_beer_wine?: boolean;
}

/**
 * Parse guest count from any input shape.
 * - Number: returned as-is
 * - String like "100": parsed
 * - String like "50-75" or "50 to 75": takes the HIGH end (75)
 * - null/undefined/invalid: defaults to 50
 */
function parseGuestCount(input: number | string | undefined | null): number {
  if (typeof input === "number" && !isNaN(input) && input > 0) return input;
  if (typeof input === "string") {
    const cleaned = input.trim();
    const rangeMatch = cleaned.match(/^(\d+)\s*(?:-|to|–)\s*(\d+)$/i);
    if (rangeMatch) {
      return parseInt(rangeMatch[2], 10);
    }
    const singleMatch = cleaned.match(/^\d+/);
    if (singleMatch) {
      const n = parseInt(singleMatch[0], 10);
      if (n > 0) return n;
    }
  }
  console.warn("[parseGuestCount] Invalid guest_count, defaulting to 50:", input);
  return 50;
}

/** Check if event is at a private residence (triggers tequila +2 rule) */
function isResidentialEvent(eventData: EventData): boolean {
  // Bot stores this as venue_type ("venue" or "private_residence")
  // but legacy code/older sessions may have it as event_location
  const venueType = (eventData.venue_type ?? "").toLowerCase();
  const loc = (eventData.event_location ?? "").toLowerCase();
  const combined = venueType + " " + loc;
  return combined.includes("residence") || combined.includes("residential") || combined.includes("home") || combined.includes("house");
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
 * Parse oz amount from an ingredient string like "2 oz vodka" or "0.75 oz lime juice".
 * Returns the oz amount or 0 if not found.
 */
function parseOz(ingredient: string): number {
  const match = ingredient.match(/^(\d+(?:\.\d+)?)\s*oz\b/i);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Scale factor for spirit calculation. At larger events, proportionally fewer
 * guests order cocktails, so we don't scale spirits 1:1 with guest count.
 *
 * Calibrated against four real events (Julia 75, Karla 100, Joanne 200, Emeka 500)
 * that Isabel built shopping lists for.
 */
function scaleFactor(guests: number): number {
  if (guests <= 200) return 1.0;
  if (guests <= 400) return 1.0 - (guests - 200) * 0.002; // 1.0 down to 0.6
  return 0.6;
}

/**
 * Count how many alcoholic signature drinks use a given spirit key.
 */
function countDrinksUsingSpirit(drinks: SignatureDrink[], spiritKey: string): number {
  let count = 0;
  for (const drink of drinks) {
    if (drink.is_mocktail) continue;
    const ingredients = normalizeIngredients(drink.ingredients);
    for (const ing of ingredients) {
      const ingName = ing.replace(/^[\d.]+\s*oz\s*/i, "").trim().toLowerCase();
      const baseSpirit = drink.base_spirit?.toLowerCase()?.trim() || "";
      const normalized = normalizeSpiritName(ingName, baseSpirit);
      if (normalized === spiritKey) {
        count++;
        break;
      }
    }
  }
  return Math.max(1, count);
}

/** Recipe-based spirit bottle calculation. New formula calibrated against Isabel's lists. */
function getSpiritBottles(
  drinks: SignatureDrink[],
  guestCount: number,
  pace: string,
  barHours: number | undefined,
  eventData: EventData
): ShoppingListItem[] {
  const alcoholicDrinks = drinks.filter(d => !d.is_mocktail);
  if (alcoholicDrinks.length === 0) return [];

  const sf = scaleFactor(guestCount);
  const SAFETY = 1.25; // safety/over-pour buffer
  const ML_PER_BOTTLE = 25.4; // 750ml = 25.4 oz

  // Map: spirit key -> total oz across all uses
  const spiritOzTotals = new Map<string, number>();
  const spiritNames = new Map<string, string>();

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
    "triple sec": { top: "Cointreau", moderate: "DeKuyper Triple Sec" },
    "grand marnier": { top: "Grand Marnier", moderate: "Grand Marnier" },
    "dry curacao": { top: "Pierre Ferrand Dry Curacao", moderate: "DeKuyper" },
    "blue curacao": { top: "DeKuyper", moderate: "DeKuyper" },
    "aperol": { top: "Aperol", moderate: "Aperol" },
    "campari": { top: "Campari", moderate: "Campari" },
    "coffee liqueur": { top: "Mr Black", moderate: "Kahlua" },
    "raspberry liqueur": { top: "Chambord", moderate: "Giffard" },
    "elderflower liqueur": { top: "St-Germain", moderate: "St-Germain" },
    "amaretto": { top: "Disaronno", moderate: "Disaronno" },
    "lillet blanc": { top: "Lillet Blanc", moderate: "Cocchi Americano" },
    "hibiscus liqueur": { top: "Sorel", moderate: "Sorel" },
    "peach schnapps": { top: "DeKuyper Peachtree", moderate: "DeKuyper Peachtree" },
    "limoncello": { top: "Limoncello di Capri", moderate: "Caravella Limoncello" },
    "irish cream": { top: "Baileys", moderate: "Baileys" },
    "drambuie": { top: "Drambuie", moderate: "Drambuie" },
    "fireball": { top: "Fireball", moderate: "Fireball" },
    "jagermeister": { top: "Jagermeister", moderate: "Jagermeister" },
    "midori": { top: "Midori", moderate: "Midori" },
    "sweet vermouth": { top: "Carpano Antica", moderate: "Martini & Rossi" },
    "dry vermouth": { top: "Dolin Dry", moderate: "Martini & Rossi" },
    "absinthe": { top: "St. George Absinthe Verte", moderate: "Pernod" },
    "viuda de sanchez": { top: "Viuda de Sanchez", moderate: "Viuda de Sanchez" },
    "jack daniels blackberry": { top: "Jack Daniel's Tennessee Blackberry", moderate: "Jack Daniel's Tennessee Blackberry" },
    "frangelico": { top: "Frangelico", moderate: "Frangelico" },
    "sambuca": { top: "Romana Sambuca", moderate: "Romana Sambuca" },
  };

  // Accumulate oz per spirit
  for (const drink of alcoholicDrinks) {
    const baseSpirit = drink.base_spirit?.toLowerCase()?.trim() || "";
    if (!baseSpirit || baseSpirit === "none" || baseSpirit === "n/a") continue;

    const ingredients = normalizeIngredients(drink.ingredients);

    for (const ing of ingredients) {
      const oz = parseOz(ing);
      if (oz <= 0) continue;

      const ingName = ing.replace(/^[\d.]+\s*oz\s*/i, "").trim().toLowerCase();
      if (!isLikelySpirit(ingName, baseSpirit)) continue;

      const spiritKey = normalizeSpiritName(ingName, baseSpirit);
      // For the new formula: store oz per single drink (not multiplied by guests yet)
      const currentOz = spiritOzTotals.get(spiritKey) ?? 0;
      // Use MAX oz, not sum. When two drinks share a spirit, guests pick one
      // or the other, not both. Sizing should reflect the highest pour, not
      // the cumulative total across drinks.
      spiritOzTotals.set(spiritKey, Math.max(currentOz, oz));

      if (!spiritNames.has(spiritKey)) {
        spiritNames.set(spiritKey, spiritKey.charAt(0).toUpperCase() + spiritKey.slice(1));
      }
    }
  }

  const items: ShoppingListItem[] = [];
  const residential = isResidentialEvent(eventData);

  // Post-processing: merge generic "tequila" into a specific variant if one exists.
  // This handles the case where one drink says "2 oz tequila" and another says
  // "1.5 oz tequila blanco" - they should be one line item, not two.
  if (spiritOzTotals.has("tequila")) {
    const genericOz = spiritOzTotals.get("tequila")!;
    // Prefer reposado over blanco if both somehow exist, otherwise use whichever specific variant is present
    let mergeTarget: string | null = null;
    if (spiritOzTotals.has("tequila reposado")) mergeTarget = "tequila reposado";
    else if (spiritOzTotals.has("tequila blanco")) mergeTarget = "tequila blanco";
    if (mergeTarget) {
      const targetOz = spiritOzTotals.get(mergeTarget) ?? 0;
      spiritOzTotals.set(mergeTarget, Math.max(targetOz, genericOz));
      spiritOzTotals.delete("tequila");
      spiritNames.delete("tequila");
    }
  }

  for (const [spiritKey, ozPerDrink] of spiritOzTotals) {
    // NEW FORMULA: bottles = ceil(guests * scaleFactor * oz_per_drink * SAFETY / 25.4)
    let bottles = Math.ceil((guestCount * sf * ozPerDrink * SAFETY) / ML_PER_BOTTLE);
    bottles = Math.max(1, bottles);

    let notes: string | undefined;
    const rec = brandRecs[spiritKey] ?? brandRecs[spiritKey.split(" ")[0]];
    if (rec) {
      // Fix: if top shelf and moderate are the same brand, only show one
      notes = rec.top === rec.moderate ? `${rec.top}` : `Top shelf: ${rec.top} or Moderate: ${rec.moderate}`;
    } else {
      notes = "Mid-range brand recommended";
    }

    // Tequila +1 bottle for residential events (shots rule)
    const isTequila = spiritKey === "tequila" || spiritKey.includes("tequila") || spiritKey === "reposado";
    if (isTequila && residential) {
      bottles += 1;
      notes += " (Extra 1 bottle for residential event shots)";
    }

    const label = spiritNames.get(spiritKey) ?? spiritKey.charAt(0).toUpperCase() + spiritKey.slice(1);
    // Output single number, never a range
    items.push({
      category: "Spirits",
      item: label,
      quantity: `${bottles} bottle${bottles === 1 ? "" : "s"} (750 ml)`,
      notes,
    });
  }

  return items;
}

/** Check if an ingredient name is likely a spirit (not a mixer/syrup/juice) */
function isLikelySpirit(ingName: string, baseSpirit: string): boolean {
  const spiritKeywords = [
    "vodka", "tequila", "whiskey", "bourbon", "rum", "gin", "cognac", "brandy",
    "reposado", "blanco", "mezcal", "scotch",
    "malibu", "spiced rum", "coconut rum", "gold rum", "dark rum",
    "jamaican rum", "empress gin",
    "triple sec", "cointreau", "grand marnier", "dry curacao", "dry curaçao", "curaçao", "curacao",
    "aperol", "campari",
    "kahlua", "kahlúa", "mr black", "coffee liqueur",
    "raspberry liqueur", "chambord", "framboise",
    "elderflower", "st-germain", "st germain",
    "amaretto", "disaronno",
    "lillet", "lillet blanc",
    "hibiscus liqueur",
    "peach schnapps", "schnapps",
    "blue curacao", "blue curaçao",
    "creme de", "crème de",
    "limoncello",
    "sambuca",
    "frangelico",
    "baileys", "irish cream",
    "drambuie",
    "fireball",
    "jagermeister", "jägermeister",
    "midori",
    "sake",
    "vermouth", "sweet vermouth", "dry vermouth",
    "absinthe",
    "viuda de sanchez",
    "jack daniel's", "jack daniels", "jack daniel",
  ];
  if (baseSpirit && ingName.includes(baseSpirit.toLowerCase())) return true;
  return spiritKeywords.some(kw => ingName.includes(kw));
}

/** Normalize spirit names so the same spirit from different drinks groups together */
function normalizeSpiritName(ingName: string, baseSpirit: string): string {
  const lower = ingName.toLowerCase();

  if (lower.includes("triple sec") || lower.includes("cointreau")) return "triple sec";
  if (lower.includes("grand marnier")) return "grand marnier";
  if (lower.includes("dry curacao") || lower.includes("dry curaçao")) return "dry curacao";
  if (lower.includes("blue curacao") || lower.includes("blue curaçao")) return "blue curacao";
  if (lower.includes("aperol")) return "aperol";
  if (lower.includes("campari")) return "campari";
  if (lower.includes("kahlua") || lower.includes("kahlúa") || lower.includes("mr black") || lower.includes("coffee liqueur")) return "coffee liqueur";
  if (lower.includes("chambord") || lower.includes("raspberry liqueur") || lower.includes("framboise")) return "raspberry liqueur";
  if (lower.includes("elderflower") || lower.includes("st-germain") || lower.includes("st germain")) return "elderflower liqueur";
  if (lower.includes("amaretto") || lower.includes("disaronno")) return "amaretto";
  if (lower.includes("lillet")) return "lillet blanc";
  if (lower.includes("hibiscus liqueur")) return "hibiscus liqueur";
  if (lower.includes("peach schnapps")) return "peach schnapps";
  if (lower.includes("limoncello")) return "limoncello";
  if (lower.includes("sambuca")) return "sambuca";
  if (lower.includes("frangelico")) return "frangelico";
  if (lower.includes("baileys") || lower.includes("irish cream")) return "irish cream";
  if (lower.includes("drambuie")) return "drambuie";
  if (lower.includes("fireball")) return "fireball";
  if (lower.includes("jagermeister") || lower.includes("jägermeister")) return "jagermeister";
  if (lower.includes("midori")) return "midori";
  if (lower.includes("sweet vermouth")) return "sweet vermouth";
  if (lower.includes("dry vermouth")) return "dry vermouth";
  if (lower.includes("absinthe")) return "absinthe";
  if (lower.includes("viuda de sanchez")) return "viuda de sanchez";
  if (lower.includes("jack daniel")) return "jack daniels blackberry";

  // Tequila variants: keep blanco and reposado as separate IF both are specified.
  // If recipe just says "tequila" with no qualifier, normalize to base "tequila"
  // so it merges with one specific variant. Post-processing will handle the merge.
  if (lower === "tequila") return "tequila";
  if (lower.includes("tequila blanco")) return "tequila blanco";
  if (lower.includes("tequila reposado")) return "tequila reposado";
  if (lower.includes("reposado") && !lower.includes("tequila")) return "tequila reposado";
  if (lower.includes("blanco") && !lower.includes("tequila")) return "tequila blanco";
  if (lower.includes("tequila")) return "tequila";
  if (lower.includes("spiced rum")) return "spiced rum";
  if (lower.includes("coconut rum") || lower.includes("malibu")) return "coconut rum";
  if (lower.includes("coconut liqueur")) return "coconut liqueur";
  if (lower.includes("gold rum")) return "gold rum";
  if (lower.includes("jamaican rum")) return "jamaican rum";
  if (lower.includes("empress gin")) return "gin";
  if (lower.includes("bourbon")) return "bourbon";

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

/** Count how many signature drinks contain a given ingredient (rough match) */
function countDrinksUsingMixer(drinks: SignatureDrink[], mixerKeyword: string): number {
  let count = 0;
  const kw = mixerKeyword.toLowerCase();
  for (const drink of drinks) {
    const ingredients = normalizeIngredients(drink.ingredients);
    if (ingredients.some(ing => ing.toLowerCase().includes(kw))) {
      count++;
    }
  }
  return count;
}

/** Collect mixer/ingredient needs from all drinks. Used by Bartender Only package. */
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
      const baseSpirit = drink.base_spirit?.toLowerCase() ?? "__none__";
      // Skip the base spirit and modifier liqueurs (covered in spirits section)
      const ingNameOnly = ing.replace(/^[\d.]+\s*oz\s*/i, "").trim().toLowerCase();
      if (isLikelySpirit(ingNameOnly, baseSpirit)) continue;

      // Skip prep-only instructions that have no measurable ingredient
      // ("pinch of salt", "dash of bitters", "muddled basil" are aromatics/garnishes)
      const stripped = ingNameOnly
        .replace(/^(splash of|pinch of|dash of|drop of|squeeze of|muddled?|top with|topped with|garnish with|garnished with|float of)\s+/i, "")
        .trim();

      // If after stripping the prep modifier we are left with very small things (salt, pepper, bitters),
      // skip them - they get covered by the bartender's kit
      const aromaticsOnly = ["salt", "pepper", "bitters", "kosher salt", "sea salt", "black pepper", "white pepper"];
      if (aromaticsOnly.some(a => stripped === a)) continue;

      // Garnish-only items in the ingredients list (mint, basil leaves) should be skipped here
      // since they will be handled by getGarnishes()
      const garnishOnly = ["mint", "basil", "rosemary", "thyme", "cilantro", "mint leaves", "basil leaves", "thyme sprig", "rosemary sprig", "lime wheel", "lemon wheel", "orange peel", "lemon peel"];
      if (garnishOnly.some(g => stripped === g)) continue;

      // Strip prep prefix from the display name and use the cleaned version
      // Detect splash/dash usage to scale quantities down
      const isSplash = /^(splash of|pinch of|dash of|drop of|squeeze of)\s+/i.test(ing);
      const cleanedIng = ing.replace(/^(splash of|pinch of|dash of|drop of|squeeze of|muddled?|top with|topped with|garnish with|garnished with|float of)\s+/i, "").trim();
      const cleanedKey = cleanedIng.toLowerCase().trim();
      if (seen.has(cleanedKey)) continue;
      seen.add(key);
      seen.add(cleanedKey);

      const drinkCountForThis = countDrinksUsingMixer(drinks, ingNameOnly);
      items.push({
        category: "Mixers & Ingredients",
        item: cleanedIng,
        quantity: getMixerQuantity(cleanedIng, guestCount, gbDrinkCount, drinkCountForThis, isSplash),
      });
    }
  }

  return items;
}

/**
 * Return real-packaging quantities for mixers, juices, syrups, sodas.
 * Calibrated from Isabel's actual shopping lists.
 *
 * @param ingredient - the ingredient name (with or without oz prefix)
 * @param guestCount - number of guests
 * @param gingerBeerDrinkCount - how many drinks use ginger beer
 * @param drinkCountForThis - how many drinks use this specific ingredient
 */
function getMixerQuantity(
  ingredient: string,
  guestCount: number,
  gingerBeerDrinkCount?: number,
  drinkCountForThis?: number,
  isSplash?: boolean
): string {
  const key = ingredient.toLowerCase().trim();
  const drinkCount = drinkCountForThis ?? 1;

  // ===== SYRUPS =====
  if (key.includes("simple syrup")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 33));
    return `${bottles} x 1 liter bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("agave")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 60));
    return `${bottles} x 36 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("honey")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 60));
    return `${bottles} x 48 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("grenadine")) return "1 x 1 liter bottle";
  if (key.includes("lavender") && key.includes("syrup")) return "1 x 12.7 oz bottle";
  if (key.includes("butterscotch") && key.includes("syrup")) return "1 x 12.7 oz bottle";
  if (key.includes("ginger syrup")) return "1 x 1 liter bottle";

  // ===== JUICES =====
  if (key.includes("lime juice")) {
    // Scales with drink count: heavier divisor when used in more drinks
    // 100 guests, 3 drinks should give ~4 bottles (not 8)
    const divisor = drinkCount >= 3 ? 25 : drinkCount === 2 ? 33 : 50;
    const bottles = Math.max(2, Math.ceil(guestCount / divisor));
    return `${bottles} x 32 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("lemon juice")) {
    const divisor = drinkCount >= 3 ? 25 : drinkCount === 2 ? 33 : 50;
    const bottles = Math.max(1, Math.ceil(guestCount / divisor));
    return `${bottles} x 48 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("cranberry")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 37));
    return `${bottles} x 64 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("orange juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 20));
    return `${bottles} x 64 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("pineapple juice")) {
    // Central (in 2+ drinks): heavier scaling. Accent: lighter.
    const divisor = drinkCount >= 2 ? 17 : 35;
    const cans = Math.max(1, Math.ceil(guestCount / divisor));
    return `${cans} x 46 oz can${cans === 1 ? "" : "s"}`;
  }
  if (key.includes("pomegranate")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 48 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("grapefruit juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} x 64 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("blackberry juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 15));
    return `${bottles} x 32 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("lemonade")) {
    // Splash use = small amount only. Central use = scales with guest count.
    if (isSplash) {
      const bottles = Math.max(1, Math.ceil(guestCount / 100));
      return `${bottles} x 64 oz bottle${bottles === 1 ? "" : "s"}`;
    }
    // Central scaling: 1 gallon per 18 guests
    const gallons = Math.max(1, Math.ceil(guestCount / 18));
    return `${gallons} gallon${gallons === 1 ? "" : "s"}`;
  }

  // ===== PUREES =====
  if (key.includes("peach puree") || (key.includes("peach") && !key.includes("schnapps"))) {
    const bottles = Math.max(1, Math.ceil(guestCount / 60));
    return `${bottles} x 1 liter bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("strawberry puree") || key.includes("strawberry")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 15));
    return `${bottles} x 16.9 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("dark cherry puree") || key.includes("black cherry puree")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 50));
    return `${bottles} x 16.9 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("mango puree") || key.includes("mango")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 60));
    return `${bottles} x 1 liter bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("passion") || key.includes("passionfruit")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 60));
    return `${bottles} x 1 liter bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("prickly pear")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 60));
    return `${bottles} x 1 liter bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("lychee")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 60));
    return `${bottles} x 16.9 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("pumpkin")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 60));
    return `${bottles} x 16.9 oz bottle${bottles === 1 ? "" : "s"}`;
  }

  // ===== CHERRIES (separate from purees) =====
  if (key.includes("cocktail cherr") || key.includes("maraschino")) {
    const jars = Math.max(1, Math.ceil(guestCount / 60));
    return `${jars} x 11 oz jar${jars === 1 ? "" : "s"}`;
  }

  // ===== SODAS / FIZZY =====
  if (key.includes("club soda") || key.includes("soda water")) {
    // Flat 2 liters when used as accent. Scales when in multiple drinks.
    const liters = drinkCount >= 2 ? Math.max(2, Math.ceil(guestCount / 30) * 2) : 2;
    return `${liters} x 1 liter bottle${liters === 1 ? "" : "s"}`;
  }
  if (key.includes("sparkling water")) {
    const liters = Math.max(2, Math.ceil(guestCount / 30) * 2);
    return `${liters} x 1 liter bottle${liters === 1 ? "" : "s"}`;
  }
  if (key.includes("tonic")) {
    const liters = drinkCount >= 2 ? Math.max(2, Math.ceil(guestCount / 30) * 2) : 2;
    return `${liters} x 1 liter bottle${liters === 1 ? "" : "s"}`;
  }
  if (key.includes("ginger beer")) {
    const drinks = gingerBeerDrinkCount ?? 1;
    const cans = Math.max(12, Math.ceil((guestCount / 100) * 24 * drinks));
    return `${cans} x Goslings ginger beer 12 oz cans`;
  }
  if (key.includes("ginger ale")) {
    const cans = Math.max(12, Math.ceil(guestCount / 4));
    return `${cans} x 12 oz cans`;
  }
  if (key.includes("squirt") || key.includes("grapefruit soda")) {
    const cases = Math.max(1, Math.ceil(guestCount / 125));
    return `${cases} case${cases === 1 ? "" : "s"} (24 pack${cases === 1 ? "" : "s"})`;
  }
  if (key.includes("sprite") || key.includes("7up") || key.includes("lemon lime soda")) {
    const cases = Math.max(1, Math.ceil(guestCount / 125));
    return `${cases} case${cases === 1 ? "" : "s"} (24 pack${cases === 1 ? "" : "s"})`;
  }
  if (key.includes("coke") || key.includes("coca cola") || key.includes("cola")) {
    const cases = Math.max(1, Math.ceil(guestCount / 125));
    return `${cases} case${cases === 1 ? "" : "s"} (24 pack${cases === 1 ? "" : "s"})`;
  }
  if (key.includes("dr pepper")) {
    const cases = Math.max(1, Math.ceil(guestCount / 125));
    return `${cases} case${cases === 1 ? "" : "s"} (24 pack${cases === 1 ? "" : "s"})`;
  }
  if (key.includes("root beer")) {
    const cases = Math.max(1, Math.ceil(guestCount / 125));
    return `${cases} case${cases === 1 ? "" : "s"} (24 pack${cases === 1 ? "" : "s"})`;
  }

  // ===== OTHER =====
  if (key.includes("coconut water")) {
    const bottles = Math.max(2, Math.ceil(guestCount / 20));
    return `${bottles} x 1 liter bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("rose water")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 15));
    return `${bottles} x 8 oz bottle${bottles === 1 ? "" : "s"}`;
  }
  if (key.includes("coconut cream") || key.includes("coconut milk") || key.includes("cream of coconut")) {
    const cans = Math.max(1, Math.ceil(guestCount / 25));
    return `${cans} x 16.9 oz can${cans === 1 ? "" : "s"}`;
  }
  if (key.includes("olive brine") || key.includes("olive juice")) {
    // Olive brine comes from a jar of olives, not a separate bottle
    const jars = Math.max(1, Math.ceil(guestCount / 25));
    return `${jars} jar${jars === 1 ? "" : "s"} (olives)`;
  }
  if (key.includes("elderflower")) return "1 x 750 ml bottle";
  if (key.includes("bitters") || key.includes("angostura")) return "1 x 4 oz bottle";
  if (key.includes("gulkand")) return "1 x 16 oz jar";

  // ===== SPICES & CHILIES =====
  // Handle "X or Y" combo case (client picks one)
  if (key.includes("cayenne") && key.includes("jalape")) {
    return "1 x 2.25 oz container cayenne OR 10 whole jalapeños (your choice)";
  }
  if (key.includes("cayenne")) {
    return "1 x 2.25 oz container";
  }
  if (key.includes("jalape")) {
    const count = Math.max(5, Math.ceil(guestCount / 4));
    return `${count} whole jalapeños`;
  }
  if (key.includes("tajin") || key.includes("chili salt") || key.includes("chili lime")) {
    return "1 x 4.94 oz container";
  }
  if (key.includes("cinnamon") && !key.includes("syrup")) {
    return "1 x 1.5 oz container";
  }
  if (key.includes("nutmeg") && !key.includes("syrup")) {
    return "1 x 1.1 oz container";
  }

  // ===== FALLBACK: don't drop the ingredient, render a default =====
  const units = Math.max(1, Math.ceil(guestCount / 25));
  return `${units} x 1 liter bottle${units === 1 ? "" : "s"}`;
}

/**
 * Backward-compat: client-facing mixer quantities (no store sourcing).
 * Just calls the unified getMixerQuantity now.
 */
function getClientMixerQuantity(ingredient: string, guestCount: number, gingerBeerDrinkCount?: number, drinkCountForThis?: number): string {
  return getMixerQuantity(ingredient, guestCount, gingerBeerDrinkCount, drinkCountForThis);
}

/**
 * Natalie supply mixer quantity (same formula, slightly different ginger beer label).
 */
function getNatalieMixerQuantity(ingredient: string, guestCount: number, gingerBeerDrinkCount?: number, drinkCountForThis?: number, isSplash?: boolean): string {
  const key = ingredient.toLowerCase().trim();
  if (key.includes("ginger beer")) {
    const drinks = gingerBeerDrinkCount ?? 1;
    const cans = Math.max(12, Math.ceil((guestCount / 100) * 24 * drinks));
    return `${cans} cans (Goslings 12 oz, Sam's Club 24 ct or Walmart 12 ct)`;
  }
  return getMixerQuantity(ingredient, guestCount, gingerBeerDrinkCount, drinkCountForThis, isSplash);
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

/**
 * Detect rim ingredients from garnish strings and return as line items.
 * Looks for "salt rim", "sugar rim", "tajin rim", "chili rim".
 */
function getRimIngredients(drinks: SignatureDrink[]): ShoppingListItem[] {
  const seen = new Set<string>();
  const items: ShoppingListItem[] = [];

  for (const drink of drinks) {
    const g = (typeof drink.garnish === "string" ? drink.garnish : "").toLowerCase();
    if (!g) continue;

    if ((g.includes("salt rim") || g.includes("salted rim") || g.includes("rim of salt")) && !seen.has("salt")) {
      seen.add("salt");
      items.push({ category: "Rim", item: "Salt", quantity: "1 large container (for rims)" });
    }
    if ((g.includes("sugar rim") || g.includes("rim of sugar")) && !seen.has("sugar")) {
      seen.add("sugar");
      items.push({ category: "Rim", item: "Sugar", quantity: "1 small container (for rims)" });
    }
    if ((g.includes("tajin") || g.includes("tajín") || g.includes("chili salt") || g.includes("chile salt")) && !seen.has("tajin")) {
      seen.add("tajin");
      items.push({ category: "Rim", item: "Tajin or chili salt", quantity: "1 large container (for rims)" });
    }
  }

  return items;
}

/**
 * Cups, napkins, straws formula.
 *
 * Cups are banded by guest count, with pace adjustment:
 *   Small (<150 guests):   3.0x default, 3.5x heavy pace
 *   Mid (150-300 guests):  2.5x default, 3.0x heavy pace
 *   Large (>300 guests):   2.0x default, 2.5x heavy pace
 *
 * Napkins: 1.5x. Straws: 1.5x.
 */
function getSupplyCounts(guestCount: number, hours: number, pace: string): { cups: number; napkins: number; straws: number } {
  const isHeavy = (pace ?? "").toLowerCase() === "heavy";

  let cupMultiplier: number;
  if (guestCount < 150) {
    cupMultiplier = isHeavy ? 3.5 : 3.0;
  } else if (guestCount <= 300) {
    cupMultiplier = isHeavy ? 3.0 : 2.5;
  } else {
    cupMultiplier = isHeavy ? 2.5 : 2.0;
  }

  return {
    cups: Math.ceil(guestCount * cupMultiplier),
    napkins: Math.ceil(guestCount * 1.5),
    straws: Math.ceil(guestCount * 1.5),
  };
}

/** Ice formula non-linear: 1.5 lbs <=100, 1.2 lbs 101-300, 0.8 lbs >300. 16 lb bags. */
function getIceBags(guestCount: number): number {
  let lbsPerGuest = 1.5;
  if (guestCount > 100 && guestCount <= 300) lbsPerGuest = 1.2;
  if (guestCount > 300) lbsPerGuest = 0.8;
  return Math.ceil((guestCount * lbsPerGuest) / 16);
}

function getSupplies(guestCount: number, hours: number, pace: string): ShoppingListItem[] {
  const { cups, napkins, straws } = getSupplyCounts(guestCount, hours, pace);
  const iceBags = getIceBags(guestCount);
  return [
    {
      category: "Supplies",
      item: "Tossware 12 oz round bottom cups",
      quantity: `${cups} count`,
      notes: "Buy from Tossware or Amazon",
    },
    {
      category: "Supplies",
      item: "Cocktail napkins",
      quantity: `${napkins} count`,
    },
    {
      category: "Supplies",
      item: "Agave cocktail straws",
      quantity: `${straws} count`,
      notes: "Buy in bulk (1,000 to 2,000 ct)",
    },
    {
      category: "Supplies",
      item: "Ice",
      quantity: `${iceBags} x 16 lb bags (estimated for mixing only)`,
    },
  ];
}

/**
 * Beer formula: single number, 1 case (24 pack) per 30 guests.
 */
function getBeerQuantity(guestCount: number): string {
  const cases = Math.max(1, Math.ceil(guestCount / 30));
  return `${cases} case${cases === 1 ? "" : "s"} (24 pack${cases === 1 ? "" : "s"})`;
}

/**
 * Wine formula: bottles, not cases. 1 bottle per 25 guests, min 2.
 */
function getWineQuantity(guestCount: number): string {
  const bottles = Math.max(2, Math.ceil(guestCount / 25));
  return `${bottles} bottle${bottles === 1 ? "" : "s"}`;
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
  const guestCount = parseGuestCount(eventData.guest_count);

  // Beer and Wine — no shopping list
  if (pkg.includes("beer") && pkg.includes("wine") && !pkg.includes("bartender") && !pkg.includes("essentials") && !pkg.includes("full") && !pkg.includes("premium")) {
    return [];
  }

  const items: ShoppingListItem[] = [];

  const sigDrinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];
  const barHours = calculateHours(eventData.bar_service_start, eventData.bar_service_end);
  const pace = eventData.drinking_pace ?? "moderate";

  // Spirits from signature drinks
  if (sigDrinks.length > 0) {
    items.push(
      ...getSpiritBottles(sigDrinks, guestCount, pace, barHours, eventData)
    );
  }

  // Beer (single number)
  if (eventData.beer) {
    items.push({
      category: "Beer & Wine",
      item: "Beer (variety pack or client preference)",
      quantity: getBeerQuantity(guestCount),
      notes: eventData.client_providing_beer_wine ? "You mentioned providing your own; recommended amount above" : undefined,
    });
  }

  // Wine (bottles, single number)
  if (eventData.wine) {
    items.push({
      category: "Beer & Wine",
      item: "Wine (mix of red and white)",
      quantity: getWineQuantity(guestCount),
      notes: eventData.client_providing_beer_wine ? "You mentioned providing your own; recommended amount above" : undefined,
    });
  }

  const isBartenderOnly = pkg.includes("bartender");

  // Bartender Only gets mixers, garnishes, rim ingredients, AND supplies
  if (isBartenderOnly && sigDrinks.length > 0) {
    items.push(...getMixersAndIngredients(sigDrinks, guestCount));
    items.push(...getGarnishes(sigDrinks));
    items.push(...getRimIngredients(sigDrinks));
  }

  // Supplies (cups, napkins, straws, ice) ONLY for Bartender Only
  // Essentials/Full/Premium: The Mix Fix provides supplies
  if (isBartenderOnly) {
    items.push(...getSupplies(guestCount, barHours, pace));
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

/** Calculate hours between start and end time strings */
function calculateHours(start?: string, end?: string): number {
  if (!start || !end) return 5;
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

/** Check if ingredient is a soda or ginger beer (UPDATED with new keywords) */
function isSodaOrGingerBeer(key: string): boolean {
  return (
    key.includes("ginger beer") ||
    key.includes("ginger ale") ||
    key.includes("club soda") ||
    key.includes("soda water") ||
    key.includes("sparkling water") ||
    key.includes("tonic") ||
    key.includes("cola") ||
    key.includes("coke") ||
    key.includes("sprite") ||
    key.includes("lemon lime") ||
    key.includes("7up") ||
    key.includes("dr pepper") ||
    key.includes("squirt") ||
    key.includes("root beer") ||
    key.includes("grapefruit soda")
  );
}

/** Check if ingredient is a puree, juice, or syrup (UPDATED) */
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
    key.includes("lemonade") ||
    key.includes("cream of coconut") ||
    key.includes("coconut cream") ||
    key.includes("coconut milk") ||
    key.includes("coconut water") ||
    key.includes("rose water")
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
 * Generates Natalie's supply list — everything she needs to know to prep and shop.
 */
export function generateNatalieSupplyList(eventData: EventData): string {
  console.log("[generateNatalieSupplyList] eventData received:", JSON.stringify(eventData, null, 2));

  const pkg = (eventData.package ?? "").toLowerCase();
  const isBeerAndWine = pkg.includes("beer") && pkg.includes("wine") && !pkg.includes("essentials") && !pkg.includes("full") && !pkg.includes("premium");
  const isBartenderOnly = pkg.includes("bartender");
  if (isBeerAndWine || isBartenderOnly) {
    return "";
  }

  const guestCount = parseGuestCount(eventData.guest_count);
  const drinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];
  const pace = eventData.drinking_pace ?? "moderate";

  const parts: string[] = [];

  // LINE 1: Event header
  const packageLabel = eventData.package ?? "Full Bar";
  const eventDate = formatNatalieDate(eventData.event_date);
  const hours = calculateHours(eventData.bar_service_start, eventData.bar_service_end);
  parts.push(`<b style="color:#8B4513;">${eventDate} (${packageLabel}) ${guestCount} guests, ${hours} hours</b>`);

  parts.push(`Theme: ${eventData.theme || "No specific theme"}`);
  parts.push(`Colors: ${eventData.event_colors || "No specific colors"}`);
  parts.push("");

  // SPIRITS
  const spiritItems = getSpiritBottles(drinks, guestCount, pace, hours, eventData);
  if (spiritItems.length > 0) {
    parts.push("<b>SPIRITS</b>");
    for (const s of spiritItems) {
      const brandNote = s.notes ? ` ${s.notes.replace(/Top shelf: /, "").replace(/ or Moderate: /, " or ")}` : "";
      parts.push(`${s.item} — ${s.quantity}${brandNote}`);
    }
    parts.push("");
  }

  // Categorize ingredients (with FALLBACK so nothing is dropped)
  const pureeJuiceSyrupItems: { item: string; quantity: string }[] = [];
  const sodaItems: { item: string; quantity: string }[] = [];
  const fallbackItems: { item: string; quantity: string }[] = [];
  const seenMixers = new Set<string>();
  const gbDrinkCount = countGingerBeerDrinks(drinks);

  for (const drink of drinks) {
    const ingredients = normalizeIngredients(drink.ingredients);
    for (const ing of ingredients) {
      // Detect splash usage BEFORE stripping modifiers
      const isSplash = /^(splash of|pinch of|dash of|drop of|squeeze of)\s+/i.test(ing.replace(/^[\d.]+\s*oz\s*/i, ""));
      const ingName = ing
        .replace(/^[\d.]+\s*oz\s*/i, "")
        .replace(/^(splash of|pinch of|dash of|drop of|squeeze of|muddled?|top with|topped with|garnish with|garnished with|float of)\s+/i, "")
        .trim();
      const key = ingName.toLowerCase();
      if (!key) continue;
      if (seenMixers.has(key)) continue;
      // Skip spirits and modifier liqueurs (in SPIRITS section)
      if (isLikelySpirit(key, drink.base_spirit?.toLowerCase() ?? "")) continue;

      // Skip aromatics
      const aromaticsOnly = ["salt", "pepper", "bitters", "kosher salt", "sea salt", "black pepper", "white pepper"];
      if (aromaticsOnly.includes(key)) continue;

      // Skip garnish-only items
      const garnishOnly = ["mint", "basil", "rosemary", "thyme", "cilantro", "mint leaves", "basil leaves", "thyme sprig", "rosemary sprig", "lime wheel", "lemon wheel", "orange peel", "lemon peel"];
      if (garnishOnly.includes(key)) continue;

      seenMixers.add(key);

      const drinkCountForThis = countDrinksUsingMixer(drinks, key);
      const quantity = getNatalieMixerQuantity(ingName, guestCount, gbDrinkCount, drinkCountForThis, isSplash);

      if (isSodaOrGingerBeer(key)) {
        sodaItems.push({ item: ingName, quantity });
      } else if (isPureeJuiceOrSyrup(key)) {
        pureeJuiceSyrupItems.push({ item: ingName, quantity });
      } else {
        // FALLBACK: don't drop the ingredient
        fallbackItems.push({ item: ingName, quantity });
      }
    }
  }

  if (pureeJuiceSyrupItems.length > 0 || fallbackItems.length > 0) {
    parts.push("<b>PUREES JUICES AND SYRUPS</b>");
    for (const m of pureeJuiceSyrupItems) {
      const label = m.item.charAt(0).toUpperCase() + m.item.slice(1);
      parts.push(`${label} — ${m.quantity}`);
    }
    for (const m of fallbackItems) {
      const label = m.item.charAt(0).toUpperCase() + m.item.slice(1);
      parts.push(`${label} — ${m.quantity}`);
    }
    parts.push("");
  }

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

  const produceItems = calculateProduceFromGarnishes(drinks, guestCount);
  if (produceItems.length > 0) {
    parts.push("<b>PRODUCE AND GARNISH</b>");
    for (const p of produceItems) {
      parts.push(`${p.item} — ${p.quantity}`);
    }
    parts.push("");
  }

  // Rim ingredients
  const rimItems = getRimIngredients(drinks);
  if (rimItems.length > 0) {
    for (const r of rimItems) {
      parts.push(`${r.item} — ${r.quantity}`);
    }
    parts.push("");
  }

  // Ice & supplies (unified formula)
  const iceBags = getIceBags(guestCount);
  const { cups, napkins, straws } = getSupplyCounts(guestCount, hours, pace);
  parts.push("<b>ICE & BAR SUPPLIES</b>");
  parts.push(`Ice — ${iceBags} x 16 lb bags`);
  parts.push(`12 oz cups — ${cups} count`);
  parts.push(`Cocktail napkins — ${napkins} count`);
  parts.push(`Straws — ${straws} count`);
  parts.push("");

  parts.push("<b>BASELINE MIXERS</b>");
  parts.push("Cranberry juice — 1 x 32 oz bottle");
  parts.push("Pineapple juice — 1 x 32 oz bottle");
  parts.push("Orange juice — 1 x 32 oz bottle");
  parts.push("Tonic — 2 x 1 liter bottles");
  parts.push("Club soda — 2 x 1 liter bottles");
  parts.push("");

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

/** Parse garnish descriptions and calculate produce quantities */
function calculateProduceFromGarnishes(drinks: SignatureDrink[], guestCount: number): { item: string; quantity: string }[] {
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
    if (g.includes("cherry") || g.includes("cherries") || g.includes("maraschino")) garnishCounts["cherry"] = (garnishCounts["cherry"] || 0) + 1;
    if (g.includes("blackberr")) garnishCounts["blackberry"] = (garnishCounts["blackberry"] || 0) + 1;
    if (g.includes("strawberr")) garnishCounts["strawberry"] = (garnishCounts["strawberry"] || 0) + 1;
    if (g.includes("dried flower") || g.includes("edible flower") || g.includes("dried lavender")) garnishCounts["dried flower"] = (garnishCounts["dried flower"] || 0) + 1;
    if (g.includes("cinnamon")) garnishCounts["cinnamon"] = (garnishCounts["cinnamon"] || 0) + 1;
    if (g.includes("star anise")) garnishCounts["star anise"] = (garnishCounts["star anise"] || 0) + 1;
    if (g.includes("ginger") && !g.includes("ginger beer")) garnishCounts["ginger"] = (garnishCounts["ginger"] || 0) + 1;
  }

  const items: { item: string; quantity: string }[] = [];
  const numDrinks = drinks.filter(d => !d.is_mocktail).length || 1;

  for (const [garnish, drinkCount] of Object.entries(garnishCounts)) {
    const servings = Math.ceil((guestCount * drinkCount) / numDrinks);

    switch (garnish) {
      case "lime": {
        const limes = Math.max(10, Math.ceil(guestCount / 5));
        items.push({ item: "Limes", quantity: `${limes} count` });
        break;
      }
      case "lemon": {
        const lemons = Math.max(8, Math.ceil(guestCount / 5));
        items.push({ item: "Lemons", quantity: `${lemons} count` });
        break;
      }
      case "orange": {
        const oranges = Math.max(6, Math.ceil(guestCount / 12));
        items.push({ item: "Oranges", quantity: `${oranges} count` });
        break;
      }
      case "mint": {
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
        const pineapples = Math.max(1, Math.ceil(servings / 50));
        items.push({ item: "Pineapple", quantity: `${pineapples} whole (for wedges)` });
        break;
      }
      case "watermelon": {
        const melons = Math.max(1, Math.ceil(servings / 50));
        items.push({ item: "Watermelon", quantity: `${melons} whole (wedges)` });
        break;
      }
      case "cucumber": {
        const cukes = Math.max(3, Math.ceil(servings / 15));
        items.push({ item: "Cucumbers", quantity: `${cukes} count` });
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
      case "cherry": {
        const jars = Math.max(1, Math.ceil(guestCount / 60));
        items.push({ item: "Cocktail cherries", quantity: `${jars} x 10 oz jar${jars === 1 ? "" : "s"}` });
        break;
      }
      case "blackberry": {
        const clams = Math.max(2, Math.ceil(servings / 40));
        items.push({ item: "Blackberries", quantity: `${clams} large clamshells` });
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

/**
 * Format the shopping list as a plain text note for GHL.
 */
export function formatShoppingListForNote(
  items: ShoppingListItem[],
  eventData: EventData
): string {
  const pkg = (eventData.package ?? "").toLowerCase();
  const isBeerAndWinePackage =
    pkg.includes("beer") &&
    pkg.includes("wine") &&
    !pkg.includes("bartender") &&
    !pkg.includes("essentials") &&
    !pkg.includes("full") &&
    !pkg.includes("premium");

  if (isBeerAndWinePackage) return "";

  const guestCount = parseGuestCount(eventData.guest_count);
  const drinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];
  const pace = eventData.drinking_pace ?? "moderate";
  const hours = calculateHours(eventData.bar_service_start, eventData.bar_service_end);

  if (items.length === 0 && drinks.length === 0) return "";

  const lines: string[] = [];

  // Header
  const dateStr = formatHeaderDate(eventData.event_date);
  const pkgLabel = formatPackageLabel(eventData.package);
  const headerParts: string[] = [];
  if (dateStr) headerParts.push(dateStr);
  if (pkgLabel) headerParts.push(`(${pkgLabel})`);
  if (guestCount) headerParts.push(`${guestCount} guests, ${hours} hours`);
  if (headerParts.length > 0) lines.push(headerParts.join(" "));

  if (eventData.theme) lines.push(`Theme: ${eventData.theme}`);
  if (eventData.event_colors) lines.push(`Colors: ${eventData.event_colors}`);

  // LIQUOR
  const spiritItems = getSpiritBottles(drinks, guestCount, pace, hours, eventData);
  const grouped = new Map<string, ShoppingListItem[]>();
  for (const item of items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }
  const beerWine = grouped.get("Beer & Wine") ?? [];

  if (spiritItems.length > 0 || beerWine.length > 0) {
    lines.push("");
    lines.push("LIQUOR");
    lines.push("");
    for (const it of spiritItems) lines.push(formatNoteItemLine(it));
    for (const it of beerWine) lines.push(formatNoteItemLine(it));
  }

  // MIXERS AND JUICES (with fallback bucket)
  const pureeJuiceSyrupItems: { item: string; quantity: string }[] = [];
  const sodaItems: { item: string; quantity: string }[] = [];
  const fallbackItems: { item: string; quantity: string }[] = [];
  const seenMixers = new Set<string>();
  const gbDrinkCount = countGingerBeerDrinks(drinks);

  for (const drink of drinks) {
    const ingredients = normalizeIngredients(drink.ingredients);
    for (const ing of ingredients) {
      // Detect splash/dash usage BEFORE stripping modifiers
      const isSplash = /^(splash of|pinch of|dash of|drop of|squeeze of)\s+/i.test(ing.replace(/^[\d.]+\s*oz\s*/i, ""));
      // Strip oz prefix and prep modifiers ("splash of", "muddled", "top with", "pinch of", etc.)
      const ingName = ing
        .replace(/^[\d.]+\s*oz\s*/i, "")
        .replace(/^(splash of|pinch of|dash of|drop of|squeeze of|muddled?|top with|topped with|garnish with|garnished with|float of)\s+/i, "")
        .trim();
      const key = ingName.toLowerCase();
      if (!key) continue;
      if (seenMixers.has(key)) continue;
      if (isLikelySpirit(key, drink.base_spirit?.toLowerCase() ?? "")) continue;

      // Skip aromatics that don't need shopping list quantities
      const aromaticsOnly = ["salt", "pepper", "bitters", "kosher salt", "sea salt", "black pepper", "white pepper"];
      if (aromaticsOnly.includes(key)) continue;

      // Skip garnish-only items (handled by getGarnishes/produce section)
      const garnishOnly = ["mint", "basil", "rosemary", "thyme", "cilantro", "mint leaves", "basil leaves", "thyme sprig", "rosemary sprig", "lime wheel", "lemon wheel", "orange peel", "lemon peel"];
      if (garnishOnly.includes(key)) continue;

      seenMixers.add(key);

      const drinkCountForThis = countDrinksUsingMixer(drinks, key);
      const quantity = getNatalieMixerQuantity(ingName, guestCount, gbDrinkCount, drinkCountForThis, isSplash);

      if (isSodaOrGingerBeer(key)) {
        sodaItems.push({ item: ingName, quantity });
      } else if (isPureeJuiceOrSyrup(key)) {
        pureeJuiceSyrupItems.push({ item: ingName, quantity });
      } else {
        fallbackItems.push({ item: ingName, quantity });
      }
    }
  }

  if (pureeJuiceSyrupItems.length > 0 || sodaItems.length > 0 || fallbackItems.length > 0) {
    lines.push("");
    lines.push("MIXERS AND JUICES");
    lines.push("");
    for (const m of pureeJuiceSyrupItems) {
      const label = m.item.charAt(0).toUpperCase() + m.item.slice(1);
      lines.push(`- ${label} — ${m.quantity}`);
    }
    for (const m of fallbackItems) {
      const label = m.item.charAt(0).toUpperCase() + m.item.slice(1);
      lines.push(`- ${label} — ${m.quantity}`);
    }
    const extraSodas = parseExtraSodas(eventData.special_requests);
    for (const extra of extraSodas) {
      if (!seenMixers.has(extra.toLowerCase())) {
        seenMixers.add(extra.toLowerCase());
        sodaItems.push({ item: extra, quantity: "1 case (24 pack cans) (requested extras)" });
      }
    }
    for (const s of sodaItems) {
      const label = s.item.charAt(0).toUpperCase() + s.item.slice(1);
      lines.push(`- ${label} — ${s.quantity}`);
    }
  }

  // PRODUCE
  const produceItems = calculateProduceFromGarnishes(drinks, guestCount);
  const rimItems = getRimIngredients(drinks);
  if (produceItems.length > 0 || rimItems.length > 0) {
    lines.push("");
    lines.push("PRODUCE AND GARNISHES");
    lines.push("");
    for (const p of produceItems) lines.push(`- ${p.item} — ${p.quantity}`);
    for (const r of rimItems) lines.push(`- ${r.item} — ${r.quantity}`);
  }

  // ICE & BAR SUPPLIES (16 lb bags, unified formula)
  const iceBags = getIceBags(guestCount);
  const { cups, napkins, straws } = getSupplyCounts(guestCount, hours, pace);
  lines.push("");
  lines.push("ICE & BAR SUPPLIES");
  lines.push("");
  lines.push(`- Ice — ${iceBags} x 16 lb bags (estimated for mixing only)`);
  lines.push(`- 12 oz cups — ${cups} count`);
  lines.push(`- Cocktail napkins — ${napkins} count`);
  lines.push(`- Straws — ${straws} count`);

  // BASELINE - only include items not already in the specific mixer list
  lines.push("");
  lines.push("BASELINE MIXERS");
  lines.push("");
  const baseline = [
    { key: "cranberry juice", line: "- Cranberry juice — 1 x 32 oz bottle" },
    { key: "pineapple juice", line: "- Pineapple juice — 1 x 32 oz bottle" },
    { key: "orange juice", line: "- Orange juice — 1 x 32 oz bottle" },
    { key: "tonic", line: "- Tonic — 2 x 1 liter bottles" },
    { key: "club soda", line: "- Club soda — 2 x 1 liter bottles" },
  ];
  for (const b of baseline) {
    if (!seenMixers.has(b.key)) {
      lines.push(b.line);
    }
  }

  // RECIPES
  if (drinks.length > 0) {
    lines.push("");
    lines.push("***Names subject to change by client***");
    for (const drink of drinks) {
      if (!drink) continue;
      lines.push("");
      const mocktailLabel = drink.is_mocktail ? " (Mocktail)" : "";
      lines.push(`${drink.name}${mocktailLabel}`);
      lines.push("");
      const ings = normalizeIngredients(drink.ingredients);
      for (const ing of ings) lines.push(`- ${ing}`);
      if (drink.garnish && drink.garnish.toLowerCase() !== "none" && drink.garnish.toLowerCase() !== "no garnish") {
        lines.push(`Garnish: ${drink.garnish}`);
      }
    }
  }

  return lines.join("\n");
}

function formatNoteItemLine(it: ShoppingListItem): string {
  let brandRec = "";
  if (it.notes) {
    const match = it.notes.match(/Top shelf:\s*(.+?)\s+or\s+Moderate:\s*(.+?)(?:\s*\(|$)/);
    if (match) {
      brandRec = ` — ${match[1]} or ${match[2]}`;
    } else if (it.notes === "Mid-range brand recommended") {
      // skip
    } else if (it.notes.includes("Extra bottle requested")) {
      brandRec = ` (${it.notes})`;
    } else if (it.notes.includes("residential event")) {
      brandRec = ``; // shots note is already in the spirit name context
    } else if (!it.notes.toLowerCase().includes("top shelf")) {
      brandRec = ` — ${it.notes}`;
    }
  }
  return `- ${it.item} — ${it.quantity}${brandRec}`;
}

function formatHeaderDate(eventDate: string | undefined): string {
  if (!eventDate) return "";
  const d = new Date(eventDate);
  if (isNaN(d.getTime())) return eventDate;
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear() % 100;
  return `${month}/${day}/${year}`;
}

function formatPackageLabel(pkg: string | undefined): string {
  if (!pkg) return "";
  const lower = pkg.toLowerCase();
  if (lower.includes("essentials")) return "Essentials Bar";
  if (lower.includes("premium")) return "Premium Bar";
  if (lower.includes("full")) return "Full Bar";
  if (lower.includes("bartender")) return "Bartender Only";
  if (lower.includes("beer") && lower.includes("wine")) return "Beer and Wine";
  return pkg;
}

/**
 * Client-facing shopping list email. Now includes ICE & BAR SUPPLIES for ALL packages
 * (was previously only Bartender Only).
 */
export function generateClientShoppingListEmail(
  items: ShoppingListItem[],
  eventData: EventData,
  clientFirstName: string
): string {
  const pkg = (eventData.package ?? "").toLowerCase();
  const isBeerAndWinePackage =
    pkg.includes("beer") &&
    pkg.includes("wine") &&
    !pkg.includes("bartender") &&
    !pkg.includes("essentials") &&
    !pkg.includes("full") &&
    !pkg.includes("premium");

  if (isBeerAndWinePackage) return "";

  const isBartenderOnly =
    pkg.includes("bartender") &&
    !pkg.includes("essentials") &&
    !pkg.includes("full") &&
    !pkg.includes("premium");

  const guestCount = parseGuestCount(eventData.guest_count);
  const drinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];
  const pace = eventData.drinking_pace ?? "moderate";
  const hours = calculateHours(eventData.bar_service_start, eventData.bar_service_end);

  const dateLong = formatLongDate(eventData.event_date);
  const greeting = clientFirstName ? `Hey ${clientFirstName},` : "Hey,";

  const lines: string[] = [];

  lines.push(greeting);
  lines.push("");
  lines.push(
    `We are very excited to bartend your upcoming celebration! Here is your shopping list for your event on ${dateLong}, for ${guestCount} guests, ${hours} hours:`
  );
  lines.push("");

  // LIQUOR
  const spiritItems = getSpiritBottles(drinks, guestCount, pace, hours, eventData);
  const grouped = new Map<string, ShoppingListItem[]>();
  for (const item of items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }
  const beerWineItems = grouped.get("Beer & Wine") ?? [];

  if (spiritItems.length > 0) {
    lines.push("LIQUOR");
    lines.push("");
    for (const it of spiritItems) lines.push(formatNoteItemLine(it));
    lines.push("");
  }

  if (beerWineItems.length > 0) {
    lines.push("BEER & WINE");
    lines.push("");
    for (const it of beerWineItems) lines.push(formatNoteItemLine(it));
    lines.push("");
  }

  // MIXERS / PRODUCE for Bartender Only
  if (isBartenderOnly) {
    const pureeJuiceSyrupItems: { item: string; quantity: string }[] = [];
    const sodaItems: { item: string; quantity: string }[] = [];
    const fallbackItems: { item: string; quantity: string }[] = [];
    const seenMixers = new Set<string>();
    const gbDrinkCount = countGingerBeerDrinks(drinks);

    for (const drink of drinks) {
      const ingredients = normalizeIngredients(drink.ingredients);
      for (const ing of ingredients) {
        // Detect splash usage BEFORE stripping modifiers
        const isSplash = /^(splash of|pinch of|dash of|drop of|squeeze of)\s+/i.test(ing.replace(/^[\d.]+\s*oz\s*/i, ""));
        // Strip oz prefix AND prep modifiers
        const ingName = ing
          .replace(/^[\d.]+\s*oz\s*/i, "")
          .replace(/^(splash of|pinch of|dash of|drop of|squeeze of|muddled?|top with|topped with|garnish with|garnished with|float of)\s+/i, "")
          .trim();
        const key = ingName.toLowerCase();
        if (!key) continue;
        if (seenMixers.has(key)) continue;
        if (isLikelySpirit(key, drink.base_spirit?.toLowerCase() ?? "")) continue;

        // Skip aromatics (covered by bartender kit)
        const aromaticsOnly = ["salt", "pepper", "bitters", "kosher salt", "sea salt", "black pepper", "white pepper"];
        if (aromaticsOnly.includes(key)) continue;

        // Skip garnish-only items (handled by produce section)
        const garnishOnly = ["mint", "basil", "rosemary", "thyme", "cilantro", "mint leaves", "basil leaves", "thyme sprig", "rosemary sprig", "lime wheel", "lemon wheel", "orange peel", "lemon peel"];
        if (garnishOnly.includes(key)) continue;

        seenMixers.add(key);

        const drinkCountForThis = countDrinksUsingMixer(drinks, key);
        const quantity = getNatalieMixerQuantity(ingName, guestCount, gbDrinkCount, drinkCountForThis, isSplash);

        if (isSodaOrGingerBeer(key)) {
          sodaItems.push({ item: ingName, quantity });
        } else if (isPureeJuiceOrSyrup(key)) {
          pureeJuiceSyrupItems.push({ item: ingName, quantity });
        } else {
          fallbackItems.push({ item: ingName, quantity });
        }
      }
    }

    if (pureeJuiceSyrupItems.length > 0 || sodaItems.length > 0 || fallbackItems.length > 0) {
      lines.push("MIXERS AND JUICES");
      lines.push("");
      for (const m of pureeJuiceSyrupItems) {
        const label = m.item.charAt(0).toUpperCase() + m.item.slice(1);
        lines.push(`- ${label} — ${m.quantity}`);
      }
      for (const m of fallbackItems) {
        const label = m.item.charAt(0).toUpperCase() + m.item.slice(1);
        lines.push(`- ${label} — ${m.quantity}`);
      }
      for (const s of sodaItems) {
        const label = s.item.charAt(0).toUpperCase() + s.item.slice(1);
        lines.push(`- ${label} — ${s.quantity}`);
      }
      lines.push("");
    }

    const produceItems = calculateProduceFromGarnishes(drinks, guestCount);
    const rimItems = getRimIngredients(drinks);
    if (produceItems.length > 0 || rimItems.length > 0) {
      lines.push("PRODUCE AND GARNISHES");
      lines.push("");
      for (const p of produceItems) lines.push(`- ${p.item} — ${p.quantity}`);
      for (const r of rimItems) lines.push(`- ${r.item} — ${r.quantity}`);
      lines.push("");
    }
  }

  // ICE & BAR SUPPLIES — ONLY for Bartender Only package
  // Essentials, Full, and Premium packages: The Mix Fix provides supplies, client only buys alcohol
  if (isBartenderOnly) {
    const iceBags = getIceBags(guestCount);
    const { cups, napkins, straws } = getSupplyCounts(guestCount, hours, pace);
    lines.push("ICE & BAR SUPPLIES");
    lines.push("");
    lines.push(`- Ice — ${iceBags} x 16 lb bags (estimated for mixing only)`);
    lines.push(`- 12 oz Cups — ${cups} count`);
    lines.push(`- Cocktail Napkins — ${napkins} count`);
    lines.push(`- Straws — ${straws} count`);
    lines.push("");
  }

  lines.push(
    "You are welcome to substitute any of these brands for others you prefer, as long as it is the same type of spirit. The options listed above are our recommendations based on quality and pricing. We only open what we use during the event, so any unopened bottles can be returned if you wish. You may choose the lesser amount suggested, but to ensure we do not run out of anything, I recommend going with the greater amount."
  );
  lines.push("");
  lines.push(
    "Please note that the estimated ice quantity provided is intended for mixing drinks only. We do not calculate or supply additional ice needed for chilling beer, wine, sodas, or other beverages. Our coolers and ice supply are reserved strictly for cocktail preparation and bar service use only."
  );
  lines.push("");
  lines.push("Please let us know if you have any questions!");
  lines.push("");
  lines.push("Best regards,");

  return lines.join("\n");
}

function formatLongDate(dateStr: string | undefined): string {
  if (!dateStr) return "TBD";
  const cleaned = String(dateStr).replace(/(st|nd|rd|th)/gi, "").trim();
  let parsed = new Date(cleaned);
  if (isNaN(parsed.getTime())) {
    const withYear = cleaned + " " + new Date().getFullYear();
    parsed = new Date(withYear);
  }
  if (isNaN(parsed.getTime())) return dateStr;

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const month = months[parsed.getMonth()];
  const day = parsed.getDate();
  const year = parsed.getFullYear();
  const suffix = getOrdinalSuffix(day);
  return `${month} ${day}${suffix}, ${year}`;
}

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  const lastDigit = day % 10;
  if (lastDigit === 1) return "st";
  if (lastDigit === 2) return "nd";
  if (lastDigit === 3) return "rd";
  return "th";
}

/**
 * Designer brief — unchanged in logic, but uses parseGuestCount for safety.
 */
export function generateGraphicDesignerBrief(eventData: EventData): string {
  if (!eventData) return "";

  const pkg = (eventData.package ?? "").toLowerCase();
  const isBeerAndWinePackage =
    pkg.includes("beer") &&
    pkg.includes("wine") &&
    !pkg.includes("bartender") &&
    !pkg.includes("essentials") &&
    !pkg.includes("full") &&
    !pkg.includes("premium");

  if (isBeerAndWinePackage) return "";

  const drinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];
  if (drinks.length === 0) return "";

  const lines: string[] = [];

  if (eventData.event_type || eventData.event_name) {
    lines.push(`Event: ${eventData.event_name || eventData.event_type}`);
  }
  const fullName = (eventData.client_name as string) || "";
  if (fullName) lines.push(`Client: ${fullName}`);
  const dateLong = formatLongDate(eventData.event_date);
  if (dateLong && dateLong !== "TBD") lines.push(`Date: ${dateLong}`);
  if (eventData.theme) lines.push(`Theme: ${eventData.theme}`);
  if (eventData.event_colors) lines.push(`Colors: ${eventData.event_colors}`);
  if (eventData.menu_colors) lines.push(`Menu Colors: ${eventData.menu_colors}`);

  lines.push("");
  lines.push("Cocktails:");

  for (const drink of drinks) {
    if (!drink) continue;
    const mocktailLabel = drink.is_mocktail ? " (Mocktail)" : "";
    lines.push("");
    lines.push(`${drink.name}${mocktailLabel}`);
    lines.push("");
    const ings = normalizeIngredients(drink.ingredients);
    for (const ing of ings) lines.push(`- ${ing}`);
    if (drink.garnish && drink.garnish.toLowerCase() !== "none" && drink.garnish.toLowerCase() !== "no garnish") {
      lines.push(`Garnish: ${drink.garnish}`);
    }
  }

  return lines.join("\n");
}

/**
 * Order Team Email for Natalie — routing logic unchanged, formulas updated via shared helpers.
 */
export function generateOrderTeamEmail(
  _items: ShoppingListItem[],
  eventData: EventData
): string {
  if (!eventData) return "";
  const pkg = (eventData.package ?? "").toLowerCase();

  const isBeerAndWine =
    pkg.includes("beer") &&
    pkg.includes("wine") &&
    !pkg.includes("essentials") &&
    !pkg.includes("full") &&
    !pkg.includes("premium");
  const isBartenderOnly = pkg.includes("bartender");

  if (isBeerAndWine || isBartenderOnly) return "";

  const drinks = Array.isArray(eventData.signature_drinks) ? eventData.signature_drinks : [];
  const guestCount = parseGuestCount(eventData.guest_count);
  const hours = calculateHours(eventData.bar_service_start, eventData.bar_service_end);
  const pace = eventData.drinking_pace ?? "moderate";

  let orderByLong = "TBD";
  if (eventData.event_date) {
    try {
      const d = new Date(eventData.event_date + "T12:00:00");
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() - 6);
        orderByLong = formatDateOnly(d);
      }
    } catch {
      orderByLong = "TBD";
    }
  }

  const buckets: Record<string, string[]> = {
    Specs: [],
    "Sam's Club": [],
    Walmart: [],
    Amazon: [],
    Tossware: [],
    Crew: [],
  };

  const seenMixers = new Set<string>();
  const gbDrinkCount = countGingerBeerDrinks(drinks);

  for (const drink of drinks) {
    const ingredients = normalizeIngredients(drink.ingredients);
    for (const ing of ingredients) {
      const isSplash = /^(splash of|pinch of|dash of|drop of|squeeze of)\s+/i.test(ing.replace(/^[\d.]+\s*oz\s*/i, ""));
      const ingName = ing
        .replace(/^[\d.]+\s*oz\s*/i, "")
        .replace(/^(splash of|pinch of|dash of|drop of|squeeze of|muddled?|top with|topped with|garnish with|garnished with|float of)\s+/i, "")
        .trim();
      const key = ingName.toLowerCase();
      if (!key) continue;
      if (seenMixers.has(key)) continue;
      if (isLikelySpirit(key, drink.base_spirit?.toLowerCase() ?? "")) continue;

      const aromaticsOnly = ["salt", "pepper", "bitters", "kosher salt", "sea salt", "black pepper", "white pepper"];
      if (aromaticsOnly.includes(key)) continue;

      const garnishOnly = ["mint", "basil", "rosemary", "thyme", "cilantro", "mint leaves", "basil leaves", "thyme sprig", "rosemary sprig", "lime wheel", "lemon wheel", "orange peel", "lemon peel"];
      if (garnishOnly.includes(key)) continue;

      seenMixers.add(key);

      const drinkCountForThis = countDrinksUsingMixer(drinks, key);
      const quantity = getNatalieMixerQuantity(ingName, guestCount, gbDrinkCount, drinkCountForThis, isSplash);
      const label = ingName.charAt(0).toUpperCase() + ingName.slice(1);

      const store = routeMixerToStore(label);
      const brand = brandPreferenceForItem(label);
      let line = `- ${label} — ${quantity}`;
      if (brand) line += ` (${brand})`;

      if (isSodaOrGingerBeer(key) || isPureeJuiceOrSyrup(key)) {
        buckets[store].push(line);
      } else {
        // fallback: still add it
        buckets[store].push(line);
      }
    }
  }

  const produceItems = calculateProduceFromGarnishes(drinks, guestCount);
  for (const p of produceItems) {
    const store = routeMixerToStore(p.item);
    buckets[store].push(`- ${p.item} — ${p.quantity}`);
  }

  // Rim ingredients
  const rimItems = getRimIngredients(drinks);
  for (const r of rimItems) {
    buckets["Walmart"].push(`- ${r.item} — ${r.quantity}`);
  }

  const iceBags = getIceBags(guestCount);
  const { cups, napkins, straws } = getSupplyCounts(guestCount, hours, pace);
  buckets["Sam's Club"].push(`- Ice — ${iceBags} x 16 lb bags`);
  buckets["Tossware"].push(`- 12 oz cups — ${cups} count`);
  buckets["Amazon"].push(`- Cocktail napkins — ${napkins} count`);
  buckets["Crew"].push(`- Agave cocktail straws — ${straws} count`);

  buckets["Sam's Club"].push("- Cranberry juice — 1 x 32 oz bottle (Kirkland or GV)");
  buckets["Sam's Club"].push("- Pineapple juice — 1 x 32 oz bottle (Kirkland or GV)");
  buckets["Sam's Club"].push("- Orange juice — 1 x 32 oz bottle (Kirkland or GV)");
  buckets["Sam's Club"].push("- Tonic — 2 x 1 liter bottles (Kirkland or GV)");
  buckets["Sam's Club"].push("- Club soda — 2 x 1 liter bottles (Kirkland or GV)");

  const lines: string[] = [];
  lines.push("ORDER LIST FOR NATALIE");
  lines.push("======================");
  lines.push("");

  if (eventData.event_name || eventData.event_type) {
    lines.push(`Event: ${eventData.event_name || eventData.event_type}`);
  }
  const fullName = (eventData.client_name as string) || "";
  if (fullName) lines.push(`Client: ${fullName}`);
  const dateLong = formatLongDate(eventData.event_date);
  if (dateLong && dateLong !== "TBD") lines.push(`Date: ${dateLong}`);
  if (eventData.package) lines.push(`Package: ${eventData.package}`);
  if (guestCount > 0) {
    const hrsStr = hours > 0 ? `, ${hours} hours` : "";
    lines.push(`Guests: ${guestCount} guests${hrsStr}`);
  }

  lines.push("");
  lines.push(`ORDER BY: ${orderByLong} (6 days before the event)`);

  const order: string[] = ["Specs", "Sam's Club", "Walmart", "Amazon", "Tossware", "Crew"];
  for (const store of order) {
    const arr = buckets[store];
    if (!arr || arr.length === 0) continue;
    lines.push("");
    lines.push("------------");
    lines.push(store.toUpperCase());
    lines.push("------------");
    for (const l of arr) lines.push(l);
  }

  lines.push("");
  lines.push("Let us know if anything is unclear or out of stock so we can adjust!");
  lines.push("");
  lines.push("Thanks!");
  lines.push("The Mix Fix Team");

  return lines.join("\n");
}

function routeMixerToStore(itemName: string): string {
  const name = itemName.toLowerCase();

  if (name.includes("straw")) return "Crew";
  if (name.includes("12 oz cup") || name.includes("12oz cup")) return "Tossware";
  if (name.includes("9 oz cup") || name.includes("9oz cup") || name.includes("shot glass")) return "Amazon";
  if (name.includes("napkin")) return "Amazon";
  if (name.includes("lavender syrup") || name.includes("butterscotch") || name.includes("gulkand")) return "Amazon";
  if (name.includes("dried flower") || name.includes("dried lavender") || name.includes("edible flower") || name.includes("edible glitter")) return "Amazon";
  if (name.includes("smoked salt") || name.includes("rim sugar") || name.includes("cocktail rim")) return "Amazon";
  if (name.includes("rose water")) return "Amazon";

  if (name.includes("finest call")) return "Specs";
  if (name.includes("real brand") || name.includes("real ")) return "Specs";
  if (name.includes("mango puree")) return "Specs";
  if (name.includes("passionfruit puree") || name.includes("passion fruit puree")) return "Specs";
  if (name.includes("strawberry puree")) return "Specs";
  if (name.includes("peach puree")) return "Specs";
  if (name.includes("prickly pear")) return "Specs";
  if (name.includes("pumpkin spice")) return "Specs";
  if (name.includes("black cherry puree") || name.includes("dark cherry puree")) return "Specs";
  if (name.includes("lychee")) return "Specs";
  if (name.includes("cream of coconut")) return "Specs";
  if (name.includes("grenadine")) return "Specs";
  if (name.includes("hibiscus") && (name.includes("syrup") || name.includes("agave"))) return "Specs";
  if (name.includes("orgeat")) return "Specs";
  if (name.includes("falernum")) return "Specs";
  if (name.includes("ginger syrup")) return "Specs";

  if (name.includes("bitters") || name.includes("angostura")) return "Walmart";
  if (name.includes("cocktail cherr") || name.includes("maraschino")) return "Walmart";
  if (name.includes("toothpick") || name.includes("pick")) return "Walmart";
  if (name.includes("stir stick") || name.includes("stirrer")) return "Walmart";
  if (name === "mint" || name.includes("fresh mint")) return "Walmart";
  if (name === "basil" || name.includes("fresh basil")) return "Walmart";
  if (name === "rosemary" || name.includes("fresh rosemary")) return "Walmart";
  if (name === "thyme" || name.includes("fresh thyme")) return "Walmart";
  if (name === "salt" || name === "sugar" || name.includes("chili salt") || name.includes("tajin")) return "Walmart";

  if (name.includes("watermelon")) return "Sam's Club";
  if (name.includes("pineapple") && !name.includes("juice")) return "Sam's Club";
  if (name.includes("blackberr")) return "Sam's Club";
  if (name.includes("juice") || name.includes("lemonade")) return "Sam's Club";
  if (name.includes("soda") || name.includes("ginger beer") || name.includes("tonic") || name.includes("sprite") || name.includes("coke") || name.includes("dr pepper") || name.includes("squirt") || name.includes("club soda") || name.includes("sparkling water") || name.includes("coconut water")) return "Sam's Club";
  if (name.includes("simple syrup") || name.includes("honey syrup") || name.includes("agave")) return "Sam's Club";
  if (name.includes("water") && !name.includes("watermelon") && !name.includes("rose water") && !name.includes("coconut water") && !name.includes("sparkling water")) return "Sam's Club";
  if (name.includes("ice")) return "Sam's Club";
  if (name.includes("lime") || name.includes("lemon") || name.includes("orange") || name.includes("strawberr") || name.includes("apple") || name.includes("grapefruit") || name.includes("peach") || name.includes("mango") || name.includes("kiwi")) return "Sam's Club";

  return "Sam's Club";
}

function brandPreferenceForItem(itemName: string): string | null {
  const n = itemName.toLowerCase();

  if (n.includes("lime juice")) return "RealLime brand";
  if (n.includes("lemon juice")) return "RealLemon brand";
  if (n.includes("pomegranate juice")) return "POM Wonderful";
  if (n.includes("ginger beer")) return "Goslings";
  if (n.includes("cranberry juice") || n.includes("orange juice") || n.includes("pineapple juice") || n.includes("grapefruit juice")) {
    return "Kirkland or GV";
  }
  if (n.includes("club soda") || n.includes("tonic")) return "Kirkland or GV";
  if (n.includes("simple syrup") || n.includes("honey syrup")) return "Kirkland or GV";

  return null;
}

function formatDateOnly(d: Date): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const day = d.getDate();
  const suffix = getOrdinalSuffix(day);
  return `${months[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`;
}

/**
 * Legacy HTML formatter — keeping for backward compat but should be deprecated
 * in favor of formatShoppingListForNote and generateClientShoppingListEmail.
 */
export function formatShoppingList(items: ShoppingListItem[]): string {
  if (items.length === 0) return "";
  const grouped = new Map<string, ShoppingListItem[]>();
  for (const item of items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  const lines: string[] = [];

  function formatItem(it: ShoppingListItem): string {
    let brandRec = "";
    if (it.notes) {
      const match = it.notes.match(/Top shelf:\s*(.+?)\s+or\s+Moderate:\s*(.+?)(?:\s*\(|$)/);
      if (match) brandRec = ` ${match[1]} or ${match[2]}`;
    }
    return `• ${it.item} — ${it.quantity}${brandRec}`;
  }

  const spirits = grouped.get("Spirits") ?? [];
  const beerWine = grouped.get("Beer & Wine") ?? [];
  if (spirits.length > 0 || beerWine.length > 0) {
    lines.push("<b>Liquor</b>");
    for (const it of spirits) lines.push(formatItem(it));
    for (const it of beerWine) lines.push(formatItem(it));
    lines.push("");
  }

  const mixers = grouped.get("Mixers & Ingredients") ?? [];
  if (mixers.length > 0) {
    lines.push("<b>Mixers</b>");
    for (const it of mixers) {
      lines.push(`• ${it.item.replace(/^[\d.]+\s*oz\s*/i, "").trim()} — ${it.quantity}`);
    }
    lines.push("");
  }

  const garnishes = grouped.get("Garnishes") ?? [];
  if (garnishes.length > 0) {
    lines.push("<b>Extras</b>");
    for (const it of garnishes) {
      const note = it.notes ? ` ${it.notes}` : "";
      lines.push(`• ${it.item} — ${it.quantity}${note}`);
    }
    lines.push("");
  }

  const supplies = grouped.get("Supplies") ?? [];
  if (supplies.length > 0) {
    lines.push("<b>Ice & Bar Supplies</b>");
    for (const it of supplies) lines.push(`• ${it.item} — ${it.quantity}`);
    lines.push("");
  }

  return lines.join("<br>").replace(/(<br>)+$/, "");
}
