interface SignatureDrink {
  name: string;
  base_spirit: string;
  ingredients: string[];
  garnish: string;
  is_mocktail?: boolean;
}

interface EventData {
  guest_count: number;
  drinking_pace: string;
  package: string;
  signature_drinks: SignatureDrink[];
  beer: boolean;
  wine: boolean;
  extra_bottles?: string;
}

export interface ShoppingListItem {
  category: string;
  item: string;
  quantity: string;
  notes?: string;
}

/**
 * Calculates a drink multiplier based on guest count and drinking pace.
 * Assumes ~3 drinks per guest for moderate pace across the event.
 */
function getDrinkMultiplier(guestCount: number, pace: string): number {
  const paceMultipliers: Record<string, number> = {
    light: 2,
    moderate: 3,
    heavy: 4.5,
    mixed: 3,
  };
  const perGuest = paceMultipliers[pace?.toLowerCase()] ?? 3;
  return guestCount * perGuest;
}

function bottlesNeeded(totalDrinks: number, drinksPerBottle: number): number {
  return Math.ceil(totalDrinks / drinksPerBottle);
}

/** Collect unique spirits from all signature drinks */
function getSpiritBottles(
  drinks: SignatureDrink[],
  totalDrinks: number
): ShoppingListItem[] {
  const spiritMap = new Map<string, number>();

  // Count how many cocktails use each spirit — split evenly across drinks
  const drinksPerCocktail = totalDrinks / (drinks.length || 1);

  for (const drink of drinks) {
    const spirit = drink.base_spirit?.toLowerCase().trim();
    if (!spirit) continue;
    spiritMap.set(spirit, (spiritMap.get(spirit) ?? 0) + drinksPerCocktail);
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

  const items: ShoppingListItem[] = [];
  for (const [spirit, count] of spiritMap) {
    const bottles = bottlesNeeded(count, 16); // ~16 cocktails per 750ml bottle
    const label = spirit.charAt(0).toUpperCase() + spirit.slice(1);
    const rec = brandRecs[spirit];
    const notes = rec
      ? `Top shelf: ${rec.top} or Moderate: ${rec.moderate}`
      : "Mid-range brand recommended";
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
    for (const ing of drink.ingredients ?? []) {
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
    const g = drink.garnish?.trim();
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

  const totalDrinks = getDrinkMultiplier(
    eventData.guest_count ?? 50,
    eventData.drinking_pace ?? "moderate"
  );

  const items: ShoppingListItem[] = [];

  // Spirits from signature drinks
  if (eventData.signature_drinks?.length > 0) {
    items.push(...getSpiritBottles(eventData.signature_drinks, totalDrinks));
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
  if (isBartenderOnly && eventData.signature_drinks?.length > 0) {
    items.push(
      ...getMixersAndIngredients(eventData.signature_drinks, eventData.guest_count)
    );
    items.push(...getGarnishes(eventData.signature_drinks));

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

  return lines.join("\n").trim();
}
