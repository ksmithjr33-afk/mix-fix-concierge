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
  pace: string
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
  const isHeavy = pace?.toLowerCase() === "heavy";

  const items: ShoppingListItem[] = [];
  for (const spirit of Array.from(spirits)) {
    let bottles = Math.max(1, Math.ceil(guestCount / perBottle));

    // Tequila gets an extra bottle for shots if heavy pace
    const isTequila = spirit === "tequila";
    let notes: string | undefined;
    const rec = brandRecs[spirit];
    notes = rec
      ? `Top shelf: ${rec.top} or Moderate: ${rec.moderate}`
      : "Mid-range brand recommended";

    if (isTequila && isHeavy) {
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
        quantity: getClientMixerQuantity(ing, guestCount),
      });
    }
  }

  return items;
}

/** Return real-packaging quantities for the client shopping list (no store sourcing) */
function getClientMixerQuantity(ingredient: string, guestCount: number): string {
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
    const cans = Math.max(12, Math.ceil(guestCount / 2));
    return `${cans} x 12 oz cans`;
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

  // Spirits from signature drinks
  if (sigDrinks.length > 0) {
    items.push(
      ...getSpiritBottles(
        sigDrinks,
        eventData.guest_count ?? 50,
        eventData.drinking_pace ?? "moderate"
      )
    );
  }

  // Beer
  if (eventData.beer) {
    const totalBeers = Math.ceil(eventData.guest_count * 1.5);
    const twentyFourPacks = Math.floor(totalBeers / 24);
    const remainder = totalBeers - twentyFourPacks * 24;
    const twelvePacks = Math.ceil(remainder / 12);
    const parts: string[] = [];
    if (twentyFourPacks > 0) parts.push(`${twentyFourPacks} x 24-pack${twentyFourPacks === 1 ? "" : "s"}`);
    if (twelvePacks > 0) parts.push(`${twelvePacks} x 12-pack${twelvePacks === 1 ? "" : "s"}`);
    items.push({
      category: "Beer & Wine",
      item: "Beer (variety pack or client preference)",
      quantity: parts.join(" + ") || "1 x 24-pack",
    });
  }

  // Wine
  if (eventData.wine) {
    const wineBottles = Math.ceil(eventData.guest_count / 5);
    const fullCases = Math.floor(wineBottles / 12);
    const loosBottles = wineBottles - fullCases * 12;
    const parts: string[] = [];
    if (fullCases > 0) parts.push(`${fullCases} x 12-bottle case${fullCases === 1 ? "" : "s"}`);
    if (loosBottles > 0) parts.push(`${loosBottles} x 750 ml bottle${loosBottles === 1 ? "" : "s"}`);
    items.push({
      category: "Beer & Wine",
      item: "Wine (mix of red and white)",
      quantity: parts.join(" + ") || "1 x 750 ml bottle",
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
  const spiritItems = getSpiritBottles(drinks, guestCount, pace);
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
  const garnishItems: { item: string; prep?: string }[] = [];
  const seenMixers = new Set<string>();
  const seenGarnishes = new Set<string>();

  for (const drink of drinks) {
    const ingredients = normalizeIngredients(drink.ingredients);
    for (const ing of ingredients) {
      const key = ing.toLowerCase().trim();
      if (!key) continue;
      if (seenMixers.has(key)) continue;
      if (key.includes(drink.base_spirit?.toLowerCase() ?? "__none__")) continue;
      seenMixers.add(key);

      const quantity = getNatalieMixerQuantity(ing, guestCount);

      if (isSodaOrGingerBeer(key)) {
        sodaItems.push({ item: ing, quantity });
      } else if (isPureeJuiceOrSyrup(key)) {
        pureeJuiceSyrupItems.push({ item: ing, quantity });
      }
    }

    // Collect garnishes
    const g = typeof drink.garnish === "string" ? drink.garnish.trim() : "";
    if (g && !seenGarnishes.has(g.toLowerCase())) {
      seenGarnishes.add(g.toLowerCase());
      garnishItems.push({ item: g });
    }
  }

  if (pureeJuiceSyrupItems.length > 0) {
    parts.push("<b>PUREES JUICES AND SYRUPS</b>");
    for (const m of pureeJuiceSyrupItems) {
      const label = m.item.charAt(0).toUpperCase() + m.item.slice(1);
      parts.push(`${label} — ${formatNatalieQuantity(m.item, m.quantity)}`);
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
      parts.push(`${label} — ${formatNatalieQuantity(s.item, s.quantity)}`);
    }
    parts.push("");
  }

  // --- SECTION 4: PRODUCE AND GARNISH ---
  if (garnishItems.length > 0) {
    parts.push("<b>PRODUCE AND GARNISH</b>");
    for (const g of garnishItems) {
      parts.push(`${g.item}`);
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

/** Format Natalie quantity for cleaner display (strip store sourcing) */
function formatNatalieQuantity(item: string, rawQuantity: string): string {
  // Strip store sourcing info in parentheses for cleaner display
  return rawQuantity.replace(/\s*\([^)]*\)/g, "").trim() || rawQuantity;
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
      lines.push(`  - ${it.item}: ${it.quantity}`);
    }
    lines.push("");
  }

  return lines.join("<br>").trim();
}
