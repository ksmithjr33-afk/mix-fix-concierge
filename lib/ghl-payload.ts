// Fields derived from event_data for the GHL webhook payload: shopping list
// note and email, designer brief, order team email, Isabel summary, and the
// date, time, and ice fields. Shared by the intake webhook and the update
// webhook so both send the same custom fields.

import {
  generateShoppingList,
  formatShoppingListForNote,
  generateClientShoppingListEmail,
  generateGraphicDesignerBrief,
  generateOrderTeamEmail,
  generateNatalieSupplyList,
} from "@/lib/shopping-list";
import { toIsoEventDate } from "@/lib/event-date";
import { generateIsabelSummary } from "@/lib/isabel-summary";

// event_data is the model's tool input, so it is loosely typed by nature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseEventData = Record<string, any>;

export function buildEventFields(eventData: LooseEventData) {
  let shoppingListNote = "";
  let shoppingListEmail = "";
  let graphicDesignerBrief = "";
  let orderTeamEmail = "";
  const pkgLower = ((eventData.package as string) ?? "").toLowerCase();
  // Dive Bar's printed menu is its set menu (or the drinks an older booking picked).
  const diveMenuRequested = eventData.dive_menu_requested === true;
  const includeMenuDesign = !pkgLower.includes("dive") || diveMenuRequested || eventData.dive_set_menu === true;
  try {
    const shoppingListItems = generateShoppingList(eventData as Parameters<typeof generateShoppingList>[0]);
    shoppingListNote = formatShoppingListForNote(shoppingListItems, eventData as Parameters<typeof formatShoppingListForNote>[1]);

    // Extract client first name for email greeting
    const fullName = (eventData.client_name as string) || (eventData.name as string) || "";
    const firstName = fullName.split(" ")[0] || "";
    shoppingListEmail = generateClientShoppingListEmail(shoppingListItems, eventData as Parameters<typeof generateClientShoppingListEmail>[1], firstName);

    // Generate graphic designer menu brief (skipped for Beer and Wine package,
    // and for Dive Bar unless the client requested a printed menu)
    if (includeMenuDesign) {
      graphicDesignerBrief = generateGraphicDesignerBrief(eventData as Parameters<typeof generateGraphicDesignerBrief>[0]);
    }

    // Generate order team email for Natalie (skipped for Bartender Only)
    orderTeamEmail = generateOrderTeamEmail(shoppingListItems, eventData as Parameters<typeof generateOrderTeamEmail>[1]);
  } catch (err) {
    console.log("generateShoppingList/formatShoppingList failed:", err);
  }

  const guestCount = Number(eventData.guest_count) || 50;
  const iceLbs = guestCount * 1.5;
  const iceBags = Math.ceil(iceLbs / 18);
  const iceAmount = `${iceBags} x 18lb bags`;

  // Build signature drink summary (drink names and brief descriptions)
  let signatureDrinkSummary = "";
  if (Array.isArray(eventData.signature_drinks) && eventData.signature_drinks.length > 0) {
    signatureDrinkSummary = eventData.signature_drinks
      .map((drink: { name?: string; base_spirit?: string; description?: string; flavor_profile?: string; is_mocktail?: boolean }) => {
        const name = drink.name || "Unnamed Drink";
        const desc = drink.description || drink.flavor_profile || "";
        const mocktail = drink.is_mocktail ? " (Mocktail)" : "";
        return desc ? `${name}${mocktail}: ${desc}` : `${name}${mocktail}`;
      })
      .join(" | ");
  }

  // Remove fields that GHL does not need
  const { age_range: _age, menu_style: _ms, menu_notes: _mn, menu_design_preference: _mdp, ...cleanEventData } = eventData;

  // Generate Isabel-style event summary (skip Beer and Wine package)
  let isabelSummary: string | null = null;
  try {
    isabelSummary = generateIsabelSummary(eventData);
  } catch (err) {
    console.error("generateIsabelSummary failed:", err);
  }

  return {
    cleanEventData,
    fields: {
      shopping_list: shoppingListNote || null,
      shopping_list_email: shoppingListEmail || null,
      graphic_designer_brief: graphicDesignerBrief || null,
      order_team_email: orderTeamEmail || null,
      bar_floor_access: eventData.bar_floor_access || null,
      signature_drink_summary: signatureDrinkSummary || null,
      menu_colors: includeMenuDesign ? eventData.menu_colors || null : null,
      menu_reference_photos: includeMenuDesign ? eventData.menu_reference_photos || null : null,
      dive_menu_requested: diveMenuRequested,
      dive_set_menu: pkgLower.includes("dive") && eventData.dive_set_menu === true,
      ice_amount: iceAmount,
      actual_event_date: toIsoEventDate(eventData.event_date),
      event_start_time: eventData.bar_service_start || null,
      event_end_time: eventData.bar_service_end || null,
      event_notes: isabelSummary,
      isabel_summary: isabelSummary,
    },
  };
}

/** Natalie's supply list, empty for Bartender Only and Tailored Bar. */
export function buildNatalieSupplyList(eventData: LooseEventData): string {
  try {
    return generateNatalieSupplyList(eventData as Parameters<typeof generateNatalieSupplyList>[0]);
  } catch (err) {
    console.log("generateNatalieSupplyList failed:", err);
    return "";
  }
}
