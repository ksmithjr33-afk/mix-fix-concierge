// Isabel Summary Formatter
// Generates the event summary in the exact format Isabel uses for her notes.
//
// Format example:
//
// Event: Graduation Party
// Hours: 3:30 PM to 6:30 PM
// Location: 202 Lunar Loop, Austin, TX 78737 | private residence
// POC: Tarrah 501-209-0567
// Bar: bar needed
// Parking: Parking lot with general parking
// Theme: From the wrestling mat to med school
// Colors: maroon and black
//
// Cocktails:
// Mat to Medicine:
// Vanilla vodka with raspberry liqueur and pineapple juice
//
// Champion's Mojito:
// White rum with fresh mint, lime juice, simple syrup, and soda water
//
// Victory Lemonade (Mocktail):
// Fresh lemonade with muddled blackberries, mint, and sparkling water
//
// Notes: beer & wine will be provided by client

interface SignatureDrink {
  name?: string;
  base_spirit?: string;
  flavor_profile?: string;
  description?: string;
  ingredients?: string[];
  method?: string;
  garnish?: string;
  is_mocktail?: boolean;
}

interface EventData {
  event_type?: string;
  event_name?: string;
  bar_service_start?: string;
  bar_service_end?: string;
  event_address?: string;
  venue_type?: string;
  bar_details?: string;
  bar_on_site?: boolean | string;
  parking_info?: string;
  theme?: string;
  event_colors?: string;
  package?: string;
  signature_drinks?: SignatureDrink[];
  beer_and_wine_details?: string;
  beer?: boolean;
  wine?: boolean;
  allergies?: string[] | string;
  special_requests?: string;
  day_of_contact_name?: string;
  day_of_contact_phone?: string;
  client_name?: string;
  email?: string;
}

/**
 * Convert ingredient list with oz measurements into a conversational
 * recipe description matching Isabel's style.
 *
 * Input: ["2 oz vanilla vodka", "0.5 oz raspberry liqueur", "Top with pineapple juice"]
 * Output: "Vanilla vodka with raspberry liqueur and pineapple juice"
 */
function ingredientsToRecipe(ingredients: string[] | undefined): string {
  if (!ingredients || ingredients.length === 0) return "";

  // Strip measurements, counts, and "Top with" prefix to get clean ingredient names
  const cleaned = ingredients
    .map((ing) => {
      let s = ing.trim();
      // Remove leading oz measurements like "2 oz", "0.75 oz", "1.5 oz", etc
      s = s.replace(/^[\d.\/]+\s*oz\s+/i, "");
      // Remove leading whole counts like "8 fresh mint leaves" -> "fresh mint leaves"
      // or "3 lime wedges" -> "lime wedges"
      s = s.replace(/^[\d.\/]+\s+/, "");
      // Remove "Top with " prefix
      s = s.replace(/^top\s+with\s+/i, "");
      // Remove trailing parens like "(2 oz)" if any slipped through
      s = s.replace(/\s*\([^)]*\)\s*$/, "");
      // Lowercase words like "leaves" attached to herbs are fine; just trim
      return s.trim();
    })
    .filter((s) => s.length > 0);

  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) {
    return capitalize(cleaned[0]);
  }
  if (cleaned.length === 2) {
    // No oxford comma when only 2 items
    return capitalize(`${cleaned[0]} with ${cleaned[1]}`);
  }
  if (cleaned.length === 3) {
    // 3 ingredients: "First with second and third" (no oxford comma, matches Isabel's style)
    return capitalize(`${cleaned[0]} with ${cleaned[1]} and ${cleaned[2]}`);
  }
  // 4+: "First with second, third, and fourth" (use oxford comma for 4+)
  const first = cleaned[0];
  const rest = cleaned.slice(1);
  const last = rest.pop();
  return capitalize(`${first} with ${rest.join(", ")}, and ${last}`);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTime(t: string | undefined): string {
  if (!t) return "";
  return t.trim();
}

function formatVenueType(venueType: string | undefined): string {
  if (!venueType) return "";
  if (venueType === "private_residence") return "private residence";
  if (venueType === "venue") return "venue";
  return venueType;
}

function formatBar(eventData: EventData): string {
  // Logic: if bar is on site at venue, the venue provides the bar
  // If bar is not on site, Mix Fix needs to bring one
  const onSite = eventData.bar_on_site;
  if (onSite === true || onSite === "true" || onSite === "yes") {
    return "bar on site";
  }
  if (onSite === false || onSite === "false" || onSite === "no") {
    return "bar needed";
  }
  // Fallback to bar_details if available
  if (eventData.bar_details) return eventData.bar_details;
  return "bar needed";
}

function formatPOC(eventData: EventData): string {
  const name = eventData.day_of_contact_name || eventData.client_name || "";
  const phone = eventData.day_of_contact_phone || "";
  if (name && phone) return `${name} ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return "";
}

function formatNotes(eventData: EventData): string {
  const parts: string[] = [];

  const pkg = (eventData.package || "").toLowerCase();
  const isBeerAndWinePackage =
    pkg.includes("beer") &&
    pkg.includes("wine") &&
    !pkg.includes("essentials") &&
    !pkg.includes("full") &&
    !pkg.includes("premium");

  // Beer and Wine arrangements (only relevant for non-Beer-and-Wine packages
  // since Beer and Wine package skips this whole formatter via the early return)
  if (!isBeerAndWinePackage) {
    if (eventData.beer_and_wine_details) {
      const details = String(eventData.beer_and_wine_details).trim();
      if (details) parts.push(details);
    } else if (eventData.beer || eventData.wine) {
      const items: string[] = [];
      if (eventData.beer) items.push("beer");
      if (eventData.wine) items.push("wine");
      parts.push(`${items.join(" & ")} requested`);
    }
  }

  // Allergies
  if (eventData.allergies) {
    const allergyList = Array.isArray(eventData.allergies)
      ? eventData.allergies
      : [eventData.allergies];
    const filtered = allergyList
      .map((a) => String(a).trim())
      .filter((a) => a && a.toLowerCase() !== "none" && a.toLowerCase() !== "no");
    if (filtered.length > 0) {
      parts.push(`allergies: ${filtered.join(", ")}`);
    }
  }

  // Special requests
  if (eventData.special_requests) {
    const sr = String(eventData.special_requests).trim();
    if (sr && sr.toLowerCase() !== "none" && sr.toLowerCase() !== "no") {
      parts.push(sr);
    }
  }

  return parts.join(" | ");
}

/**
 * Generate Isabel's formatted event summary.
 * Returns null for Beer and Wine package (no cocktails to list).
 */
export function generateIsabelSummary(eventData: EventData): string | null {
  if (!eventData) return null;

  // Skip Beer and Wine package per requirements
  const pkg = (eventData.package || "").toLowerCase();
  const isBeerAndWinePackage =
    pkg.includes("beer") &&
    pkg.includes("wine") &&
    !pkg.includes("essentials") &&
    !pkg.includes("full") &&
    !pkg.includes("premium");

  if (isBeerAndWinePackage) return null;

  const lines: string[] = [];

  // Header block
  const eventTypeOrName = eventData.event_name || eventData.event_type || "";
  if (eventTypeOrName) {
    lines.push(`Event: ${eventTypeOrName}`);
  }

  const start = formatTime(eventData.bar_service_start);
  const end = formatTime(eventData.bar_service_end);
  if (start && end) {
    lines.push(`Hours: ${start} to ${end}`);
  } else if (start) {
    lines.push(`Hours: ${start}`);
  }

  const address = eventData.event_address || "";
  const venueType = formatVenueType(eventData.venue_type);
  if (address && venueType) {
    lines.push(`Location: ${address} | ${venueType}`);
  } else if (address) {
    lines.push(`Location: ${address}`);
  }

  const poc = formatPOC(eventData);
  if (poc) {
    lines.push(`POC: ${poc}`);
  }

  lines.push(`Bar: ${formatBar(eventData)}`);

  if (eventData.parking_info) {
    lines.push(`Parking: ${eventData.parking_info}`);
  }

  if (eventData.theme) {
    lines.push(`Theme: ${eventData.theme}`);
  }

  if (eventData.event_colors) {
    lines.push(`Colors: ${eventData.event_colors}`);
  }

  // Cocktails block
  const drinks = Array.isArray(eventData.signature_drinks)
    ? eventData.signature_drinks
    : [];

  if (drinks.length > 0) {
    lines.push(""); // blank line before Cocktails section
    lines.push("Cocktails:");

    drinks.forEach((drink, idx) => {
      if (!drink) return;
      const name = drink.name || `Drink ${idx + 1}`;
      const mocktailLabel = drink.is_mocktail ? " (Mocktail)" : "";
      const recipe = ingredientsToRecipe(drink.ingredients);

      // Each drink is preceded by a blank line (except the first one which sits under "Cocktails:")
      if (idx > 0) lines.push("");
      lines.push(`${name}${mocktailLabel}:`);
      if (recipe) {
        lines.push(recipe);
      } else if (drink.description) {
        lines.push(drink.description);
      } else if (drink.flavor_profile) {
        lines.push(drink.flavor_profile);
      }
    });
  }

  // Notes block
  const notes = formatNotes(eventData);
  if (notes) {
    lines.push(""); // blank line before Notes
    lines.push(`Notes: ${notes}`);
  }

  return lines.join("\n");
}
