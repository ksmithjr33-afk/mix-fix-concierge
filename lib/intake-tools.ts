// The intake tool the concierge calls to finish a session. Kept out of the
// chat route so tests can check its fields against the tables they land in.

import type Anthropic from "@anthropic-ai/sdk";

// Completion is driven by this tool call, not by a literal marker the model has
// to remember to type after free-form prose. When the model invokes it, the SDK
// hands us the validated, fully-assembled input — there is no string to split or
// JSON to hand-parse, so the session can no longer hang on a forgotten/garbled
// marker.
export const submitEventDataTool: Anthropic.Tool = {
  name: "submit_event_data",
  description:
    "Finalize the planning session. Call this exactly once, after the client has confirmed they have no more changes and you have written your closing message, to submit all collected event details. Calling this tool is what completes the booking and hands the details off to our team. Do not call it before the client confirms they are done.",
  input_schema: {
    type: "object",
    additionalProperties: true,
    properties: {
      client_name: { type: "string" },
      email: { type: "string" },
      event_type: { type: "string" },
      event_name: { type: ["string", "null"] },
      event_date: { type: "string" },
      venue_type: { type: "string", description: "venue or private_residence" },
      bar_service_start: { type: "string" },
      bar_service_end: { type: "string" },
      event_address: { type: "string" },
      indoor_outdoor: { type: "string" },
      bar_on_site: { type: "string" },
      bar_details: { type: "string" },
      parking_info: { type: "string" },
      guest_count: { type: "number" },
      drinks_finalized: {
        type: "boolean",
        description: "false when the client skipped or postponed the drink details (send the drink names they gave in signature_drinks). The plan still submits, marked Drinks not finalized, and our team texts them to finish the menu. Leave it out or true when every drink is complete.",
      },
      extra_drinks_accepted: {
        type: "boolean",
        description: "true only when the client named more drinks than the package includes AND clearly said yes to paying $50 for each extra one. Without it, drinks past the package count are held back for our team to confirm.",
      },
      barback: {
        type: "string",
        enum: ["Included", "Removed"],
        description: 'Full Bar weddings only. "Removed" only when the client asked to remove the barback and clearly said yes to the price you stated. "Included" only when they asked to add it back. Otherwise leave it out.',
      },
      guest_count_quoted_total: {
        type: "number",
        description: "Only when quote_guest_count gave a new total for a different guest count and the client clearly said yes: that new total. The server checks it against the pricing engine before applying the change.",
      },
      drinking_pace: { type: "string" },
      theme: { type: "string" },
      event_colors: { type: "string" },
      allergies: { type: "array", items: { type: "string" } },
      day_of_contact_name: { type: "string" },
      day_of_contact_phone: { type: "string" },
      package: { type: "string" },
      signature_drinks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            name: { type: "string" },
            menu_name: {
              type: "string",
              description: "The exact menu name of the drink this was built from (French Martini, Old Fashioned), before any creative name. Empty for a mocktail or a custom drink.",
            },
            base_spirit: { type: "string" },
            flavor_profile: { type: "string" },
            description: { type: "string" },
            ingredients: {
              type: "array",
              items: { type: "string" },
              description:
                'Each ingredient MUST include the oz amount, e.g. "2 oz vodka", "0.75 oz lime juice", except "Top with" items.',
            },
            method: { type: "string" },
            garnish: { type: "string" },
            is_mocktail: { type: "boolean" },
            mocktail_followup: {
              type: "boolean",
              description: "true only for the mocktail placeholder when there is no mocktail menu (see MOCKTAIL RULES): name \"Mocktail (options coming)\", empty ingredients. Our team sends the client options.",
            },
            is_custom: { type: "boolean" },
          },
        },
      },
      extra_bottles: { type: "string" },
      beer_and_wine_details: { type: ["string", "null"] },
      beer: { type: "boolean" },
      wine: { type: "boolean" },
      client_providing_beer_wine: { type: "boolean" },
      special_requests: { type: "string", description: "Only what the client asked for or told us, written to them in plain words (\"You will provide your own cups.\"). They see it on their event page. Never \"the client\", never a follow up or a staff instruction." },
      team_notes: { type: "string", description: "Anything for our team only: follow ups, what the client says they were promised, instructions to staff. One short line each. The client never sees it." },
      menu_colors: { type: ["string", "null"] },
      menu_reference_photos: { type: ["boolean", "null"] },
      dual_bar_setup: { type: "boolean" },
      dive_menu_requested: { type: "boolean", default: false },
      dive_menu_card: {
        type: "boolean",
        description:
          "Dive Bar only. true only when the client asked for a menu card and picked classics for it (send them in signature_drinks). Otherwise false or left out.",
      },
      payment_preference: {
        type: "string",
        description: 'How the client wants the remaining balance handled, from the PAYMENT STEP. One of: "Auto charge now", "Auto charge on <date>", "Auto charge on due date", "Payment link", "Payment plan: <split>". Empty if they did not answer.',
      },
      change_approval_needed: {
        type: "string",
        enum: ["Yes", "No"],
        description: "Yes if anything was passed along to the management team under the CONDUCT RULE.",
      },
    },
    required: ["client_name", "package"],
  },
};

/** Submit fields the chat route reads and removes: they never land in event_data or the events row. */
export const INTAKE_ONLY_FIELDS = ["guest_count_quoted_total"] as const;

// Prices a guest count that differs from the booked one, with the same engine
// update mode uses, before the event is saved. Offered only when the session
// has a booked guest count.
export const quoteGuestCountTool: Anthropic.Tool = {
  name: "quote_guest_count",
  description:
    "Price a guest count that differs from the booked guest count, with our pricing engine. Saves nothing. Call it as soon as the client gives a different number, then follow the TOOL RESULT exactly.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: { guest_count: { type: "number", description: "The new guest count the client gave. A range is its higher end." } },
    required: ["guest_count"],
  },
};
