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
      notes += " — Extra bottle for shots";
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
    });
  }

  return items;
}

function getSupplies(guestCount: number): ShoppingListItem[] {
  const cups = Math.ceil(guestCount * 3); // 3 cups per guest
  return [
    {
      category: "Supplies",
      item: "Plastic cups (16 oz)",
      quantity: `${cups} cups`,
    },
    {
      category: "Supplies",
      item: "Napkins",
      quantity: `${Math.ceil(guestCount * 3)} napkins`,
    },
    {
      category: "Supplies",
      item: "Straws",
      quantity: `${cups} straws`,
    },
    {
      category: "Supplies",
      item: "Ice",
      quantity: `${Math.ceil(guestCount * 1.5)} lbs`,
      notes: "Bagged ice from grocery store",
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

  // Simple syrup: 1 liter bottle per 33 guests
  if (key.includes("simple syrup")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 33));
    return `${bottles} liter bottle${bottles === 1 ? "" : "s"}`;
  }

  // Lime juice: 2 x 32oz bottles per 50 guests
  if (key.includes("lime juice")) {
    const sets = Math.max(1, Math.ceil(guestCount / 50));
    const bottles = sets * 2;
    return `${bottles} x 32oz bottle${bottles === 1 ? "" : "s"}`;
  }

  // Lemon juice: 1 x 48oz bottle per 50 guests
  if (key.includes("lemon juice")) {
    const bottles = Math.max(1, Math.ceil(guestCount / 50));
    return `${bottles} x 48oz bottle${bottles === 1 ? "" : "s"}`;
  }

  // Club soda / tonic / ginger beer: 2 liters per 20 guests
  if (
    key.includes("club soda") ||
    key.includes("soda water") ||
    key.includes("tonic") ||
    key.includes("ginger beer") ||
    key.includes("ginger ale")
  ) {
    const liters = Math.max(2, Math.ceil(guestCount / 20) * 2);
    return `${liters} liters`;
  }

  // Cranberry / orange / pineapple juice: 1 bottle (64oz) per 25 guests
  if (
    key.includes("cranberry") ||
    key.includes("orange juice") ||
    key.includes("pineapple juice")
  ) {
    const bottles = Math.max(1, Math.ceil(guestCount / 25));
    return `${bottles} bottle${bottles === 1 ? "" : "s"} (64oz)`;
  }

  // Coconut cream / coconut milk: 1 can per 25 guests
  if (key.includes("coconut cream") || key.includes("coconut milk")) {
    const cans = Math.max(1, Math.ceil(guestCount / 25));
    return `${cans} can${cans === 1 ? "" : "s"}`;
  }

  // Any other mixer: 1 unit per 25 guests
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
      lines.push(`  - ${g}: 1 pack or bundle`);
    }
    lines.push("");
  }

  // --- Section 4: Supplies ---
  const cups = Math.ceil(guestCount * 3);
  lines.push("SUPPLIES:");
  lines.push(`  - Plastic cups (16 oz): ${cups} cups`);
  lines.push(`  - Napkins: ${Math.ceil(guestCount * 3)} napkins`);
  lines.push(`  - Straws: ${cups} straws`);
  lines.push(
    `  - Ice: ${Math.ceil(guestCount * 1.5)} lbs (Bagged ice from grocery store)`
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
