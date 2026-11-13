// Checks the menu text the bot reads and the shopping lines those drinks produce.
// Run: npm run test:menu   (plain node, Node 22.6+ strips the types)
// Exits 1 if any check fails.

import { registerHooks } from "node:module";

// lib/ imports use the "@/" path alias, which plain node does not know.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const url = new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href;
      return nextResolve(url, context);
    }
    return nextResolve(specifier, context);
  },
});

const { DRINK_MENU_RULES, SYSTEM_PROMPT: DRINK_SOURCING_AND_PACKAGE_TEXT } = await import("../lib/system-prompt.ts");
const list = await import("../lib/shopping-list.ts");

let failed = 0;
let total = 0;
function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}

const lines = DRINK_MENU_RULES.split("\n");

/** The lines of a menu section, from its === or plain heading to the next heading. */
function section(start: string, end: string): string[] {
  const from = lines.findIndex((l: string) => l.startsWith(start));
  const to = lines.findIndex((l: string, i: number) => i > from && l.startsWith(end));
  return from < 0 || to < 0 ? [] : lines.slice(from, to);
}

function otherLine(spirit: string, nextSpirit: string, drink: string): string | undefined {
  const s = section(`=== ${spirit} ===`, `=== ${nextSpirit} ===`);
  return s.slice(s.indexOf("OTHER:")).find((l) => l.startsWith(`${drink}:`));
}

// ----- Menu text -----
const classicsRum = section("RUM AND COGNAC", "BUBBLY");
const pina = classicsRum.find((l) => l.startsWith("Pina Colada:")) ?? "";
const daiquiri = classicsRum.find((l) => l.startsWith("Daiquiri:")) ?? "";
check(
  "Pina Colada is in CLASSICS under rum with its recipe",
  pina === "Pina Colada: 2 oz rum, 1.5 oz coconut cream, 2 oz pineapple juice, shaken and served on the rocks, pineapple wedge garnish",
  pina
);
check("Pina Colada recipe says on the rocks", pina.includes("on the rocks"));
check("Daiquiri recipe says on the rocks", daiquiri.includes("0.5 oz simple syrup") && daiquiri.includes("on the rocks"), daiquiri);

const mojito = otherLine("RUM", "GIN", "Mojito") ?? "";
check(
  "Mojito is a rum OTHER drink with its recipe",
  mojito.includes("Recipe: 2 oz rum, 0.75 oz lime juice, 0.5 oz simple syrup, muddled mint, top with soda water") && mojito.includes("mint garnish"),
  mojito
);
const julep = otherLine("WHISKEY", "RUM", "Mint Julep") ?? "";
check(
  "Mint Julep is a whiskey OTHER drink with its recipe",
  julep.includes("Recipe: 2 oz bourbon, 0.5 oz simple syrup, muddled mint, crushed ice") && julep.includes("mint garnish"),
  julep
);
const bloody = otherLine("VODKA", "TEQUILA", "Bloody Mary") ?? "";
check(
  "Bloody Mary is a vodka OTHER drink with its recipe",
  bloody.includes("Recipe: 1.5 oz vodka, 4 oz tomato juice, dash Worcestershire, dash hot sauce, 0.5 oz lemon juice, salt, pepper") && bloody.includes("celery garnish"),
  bloody
);
check("None of the three is listed in CLASSICS", !section("=== CLASSICS", "Only a drink").some((l) => /^(Mojito|Mint Julep|Bloody Mary):/.test(l)));

check("The old exclusion line is gone", !DRINK_MENU_RULES.includes("are NOT classics and are not auto filled"));
check("Only drinks on neither menu are excluded", DRINK_MENU_RULES.includes("Only a drink on neither the craft menu nor the CLASSICS section is excluded."));
check(
  "Mai Tai craft menu rule is kept",
  /Mai Tai are on the craft menu[^\n]*\(Essentials Bar, The Big Day Bar, Full Bar, Premium Bar\)[^\n]*normal menu drink/.test(DRINK_MENU_RULES) &&
    !!otherLine("RUM", "GIN", "Mai Tai")
);

const NOT_ON_DIVE = "That one is not part of the Dive Bar package";
const autoFill = lines.find((l: string) => l.startsWith("AUTO FILL BY PACKAGE:")) ?? "";
for (const drink of ["Espresso Martini", "Mojito", "Mint Julep", "Bloody Mary", "Mai Tai"]) {
  check(`${drink} gets the flat answer on Dive Bar`, new RegExp(`NEVER available on Dive Bar[^.]*\\b${drink}\\b`).test(autoFill), autoFill.slice(0, 200));
}
check("Dive Bar flat answer offers classics and asks for no recipe", autoFill.includes(`"${NOT_ON_DIVE}" and offer drinks from the CLASSICS section instead. Do not ask for a recipe.`));
const neitherLine = lines.find((l: string) => l.startsWith("Only a drink on neither")) ?? "";
check("Exclusion line gives Dive Bar the flat answer", neitherLine.includes(NOT_ON_DIVE) && neitherLine.includes("Do not ask for a recipe."), neitherLine);
check("Exclusion line no longer sends these drinks off list on Dive Bar", !neitherLine.includes("handled as an off list drink"));
check(
  "Dive Bar package flow never offers the eleven excluded drinks",
  DRINK_SOURCING_AND_PACKAGE_TEXT.includes("Never offer Espresso Martini, French Connection, Aperol Spritz, Mojito, Mint Julep, Bloody Mary, Mai Tai, Sidecar, Bellini, Amaretto Sour, and Hurricane")
);

const frozen = lines.find((l: string) => l.startsWith("ON THE ROCKS, NEVER FROZEN:")) ?? "";
check("Frozen rule names both drinks", frozen.includes("Pina Colada and Daiquiri are served on the rocks, never frozen"), frozen);
check("Frozen rule gives the answer", frozen.includes("We serve that one on the rocks, we do not do frozen drinks."));
check("Frozen rule notes special_requests only if the client still wants to discuss it", frozen.includes("unless the client still wants to discuss it"));

// ----- Shopping lines -----
const event = (pkg: string, drinks: object[], guest_count = 100) => ({
  package: pkg,
  guest_count,
  drinking_pace: "moderate",
  beer: false,
  wine: false,
  bar_service_start: "6:00 PM",
  bar_service_end: "10:00 PM",
  event_type: "wedding",
  signature_drinks: drinks,
});

const PINA = { name: "Pina Colada", base_spirit: "rum", ingredients: ["2 oz rum", "1.5 oz coconut cream", "2 oz pineapple juice"], method: "shaken, on the rocks", garnish: "pineapple wedge" };
const MOJITO = { name: "Mojito", base_spirit: "rum", ingredients: ["2 oz rum", "0.75 oz lime juice", "0.5 oz simple syrup", "muddled mint", "top with soda water"], garnish: "mint" };
const JULEP = { name: "Mint Julep", base_spirit: "bourbon", ingredients: ["2 oz bourbon", "0.5 oz simple syrup", "muddled mint", "crushed ice"], garnish: "mint" };
const BLOODY = { name: "Bloody Mary", base_spirit: "vodka", ingredients: ["1.5 oz vodka", "4 oz tomato juice", "dash Worcestershire", "dash hot sauce", "0.5 oz lemon juice", "salt", "pepper"], garnish: "celery" };
// The way the model may write the same drinks: serving notes and garnishes in the ingredients.
const MESSY = [
  { ...PINA, ingredients: [...PINA.ingredients, "shaken", "on the rocks", "pineapple wedge"], garnish: "" },
  { ...BLOODY, ingredients: ["1.5 oz vodka", "4 oz tomato juice", "dash of Worcestershire", "2 dashes hot sauce", "0.5 oz lemon juice", "salt and pepper", "celery garnish"], garnish: "" },
  { ...JULEP, ingredients: ["2 oz bourbon", "0.5 oz simple syrup", "8 mint leaves", "crushed ice", "mint garnish"], garnish: "" },
];

const quiet = console.log;
function lists(e: ReturnType<typeof event>): Record<string, string> {
  console.log = () => {};
  try {
    const items = list.generateShoppingList(e);
    return {
      "supply list": list.generateNatalieSupplyList(e),
      "order email": list.generateOrderTeamEmail(items, e),
    };
  } finally {
    console.log = quiet;
  }
}

const lineWith = (text: string, word: string) =>
  text.split(/<br>|\n/).find((l) => l.toLowerCase().includes(word.toLowerCase())) ?? "";

const full = lists(event("Full Bar", [PINA, MOJITO, BLOODY]));
const expected: [string, RegExp][] = [
  ["coconut cream", /coconut cream — 4 x 16\.9 oz cans/i],
  ["fresh mint", /fresh mint — 4 bunches/i],
  ["tomato juice", /tomato juice — 3 x 46 oz cans/i],
  ["worcestershire", /worcestershire — 1 x 10 oz bottle/i],
  ["hot sauce", /hot sauce — 1 x 5 oz bottle/i],
  ["celery", /celery — 3 bunches/i],
];
for (const [name, text] of Object.entries(full)) {
  for (const [word, pattern] of expected) {
    check(`${name} has ${word}`, pattern.test(text), lineWith(text, word) || "no line");
  }
}

const order = full["order email"];
const storeOf = (word: string) => {
  const before = order.slice(0, order.toLowerCase().indexOf(word));
  return [...before.matchAll(/<b>([^<]+)<\/b>|^([A-Z][^\n:]*):?$/gm)].at(-1)?.[0] ?? "";
};
check("Coconut cream is bought at Specs", /spec/i.test(storeOf("coconut cream")), storeOf("coconut cream"));
for (const word of ["fresh mint", "celery", "worcestershire", "hot sauce"]) {
  check(`${word} is bought at Walmart`, /walmart/i.test(storeOf(word)), storeOf(word));
}

const countBunches = (drinks: object[]) =>
  Number(lineWith(lists(event("Full Bar", drinks, 300))["supply list"], "fresh mint").match(/(\d+) bunches/)?.[1]);
check("Fresh mint grows with the number of mint drinks", countBunches([MOJITO, JULEP, BLOODY]) > countBunches([MOJITO, PINA, BLOODY]));
check(
  "Muddled mint with no garnish still gets a mint line",
  /fresh mint/i.test(lists(event("Full Bar", [{ ...MOJITO, garnish: "" }]))["supply list"])
);

const mintBunches = (drinks: object[]) =>
  Number(lineWith(lists(event("Full Bar", drinks))["supply list"], "fresh mint").match(/(\d+) bunches/)?.[1]);
const GARNISH_MINT = { name: "Garnish only", base_spirit: "rum", ingredients: ["2 oz rum", "0.75 oz lime juice"], garnish: "mint" };
const MARGARITA = { name: "Margarita", base_spirit: "tequila", ingredients: ["2 oz tequila blanco", "1 oz lime juice"], garnish: "lime" };
const NO_MINT = { name: "No mint", base_spirit: "gin", ingredients: ["2 oz gin", "0.75 oz lemon juice"], garnish: "" };
check("Mojito for 100 guests at the 3 drink split is 4 to 5 bunches", [4, 5].includes(mintBunches([MOJITO, NO_MINT, BLOODY])), String(mintBunches([MOJITO, NO_MINT, BLOODY])));
check("Garnish only mint stays at the garnish rate", mintBunches([GARNISH_MINT, NO_MINT, BLOODY]) === 3, String(mintBunches([GARNISH_MINT, NO_MINT, BLOODY])));
check("Muddled and garnish mint drinks add up", mintBunches([MOJITO, GARNISH_MINT, BLOODY]) === 6, String(mintBunches([MOJITO, GARNISH_MINT, BLOODY])));

const wrongLine = /(ice|rocks|shaken|wedge|celery|pepper|garnish|mint)[^<\n—]*— \d+ x 1 liter bottle/i;
for (const [name, text] of Object.entries(lists(event("Full Bar", [JULEP, ...MESSY])))) {
  check(`${name} prints no liter bottle of ice, garnish, or serving notes`, !wrongLine.test(text), text.match(wrongLine)?.[0]);
  check(`${name} sizes the dash ingredients when written other ways`, /worcestershire — 1 x 10 oz/i.test(text) && /hot sauce — 1 x 5 oz/i.test(text));
  check(`${name} has mint and celery when written in the ingredients`, /fresh mint —/i.test(text) && /celery —/i.test(text));
}

for (const [name, text] of Object.entries(lists(event("Dive Bar", [])))) {
  check(`Dive Bar no menu ${name} has 1 bottle coconut cream`, /coconut cream — 1 bottle/i.test(text), lineWith(text, "coconut cream") || "no line");
}
check(
  "Dive Bar well stays at 1 bottle coconut cream for a big party",
  /coconut cream — 1 bottle/i.test(lists(event("Dive Bar", [], 300))["supply list"])
);

for (const [guests, whole] of [[25, 1], [50, 1], [100, 2], [300, 6]]) {
  for (const [name, text] of Object.entries(lists(event("Dive Bar", [], guests)))) {
    check(`Dive Bar no menu ${name} has ${whole} pineapple for ${guests} guests`, new RegExp(`pineapple — ${whole} whole`, "i").test(text), lineWith(text, "pineapple —") || "no line");
  }
}
check("Dive Bar with a menu and no Pina Colada gets no pineapple line", !/pineapple — \d+ whole/i.test(lists(event("Dive Bar", [MARGARITA]))["supply list"]));
for (const [guests, whole] of [[25, 1], [100, 2], [300, 6]]) {
  const text = lists(event("Dive Bar", [PINA, MARGARITA, NO_MINT], guests))["supply list"];
  check(`Dive Bar signature Pina Colada supply list has ${whole} pineapple for ${guests} guests`, new RegExp(`pineapple — ${whole} whole`, "i").test(text), lineWith(text, "pineapple —") || "no line");
}

// ----- Update mode: changes apply right away, drinks lock inside 6 days -----
const diff = await import("../lib/event-diff.ts");
const pricing = await import("../lib/pricing.ts");
const priceChange = await import("../lib/price-change.ts");
const notes = await import("../lib/update-notes.ts");
const { buildUpdatePrompt } = await import("../lib/update-prompt.ts");
const { CHANGE_DEADLINES } = await import("../lib/system-prompt.ts");
const { CHANGE_REQUEST_MESSAGE } = await import("../lib/client-list.ts");
const { readFileSync } = await import("node:fs");

// 9 PM in Dallas on Nov 9 is already Nov 10 in UTC: the cutoff counts Dallas days.
const NOW = new Date("2026-11-10T03:00:00Z");
const d6 = diff.computeDeadlines("2026-11-15", NOW);
const d5 = diff.computeDeadlines("2026-11-14", NOW);
check("Cutoff counts days in America/Chicago", d6.today === "2026-11-09", d6.today);
check("6 days before the event is not within six days", d6.daysUntil === 6 && !d6.withinSixDays, JSON.stringify(d6));
check("5 days before the event is within six days", d5.daysUntil === 5 && d5.withinSixDays, JSON.stringify(d5));
check("Last drink change day is 6 days before the event", d6.lastDrinkChangeDay === "2026-11-09", String(d6.lastDrinkChangeDay));
check("An unreadable event date never locks the drink menu", !diff.computeDeadlines(null, NOW).withinSixDays);

const stored = {
  event_date: "2026-11-14",
  package: "Full Bar",
  guest_count: 100,
  bar_service_start: "6:00 PM",
  bar_service_end: "10:00 PM",
  hours_booked: 4,
  day_of_contact_name: "Sam",
  signature_drinks: [MARGARITA, NO_MINT, BLOODY],
};
const swapped = [PINA, NO_MINT, BLOODY];
const inside = diff.planUpdate(stored, { guest_count: 120, signature_drinks: swapped, day_of_contact_name: "Jordan" }, { deadlines: d5 });
check("Inside 6 days a drink change is set aside as a request, not applied", inside.cutoffChanges.some((c) => c.field.startsWith("signature_drinks")) && !inside.applied!.changes.some((c) => c.field.startsWith("signature_drinks")));
check("Inside 6 days the drinks on file stay the same", (inside.next.signature_drinks as { name: string }[])[0].name === "Margarita");
check("Inside 6 days other changes still apply now", inside.next.guest_count === 120 && inside.next.day_of_contact_name === "Jordan" && inside.applied!.applied);
check("A drink change request is not a manager request", inside.requests === null);
const insideExtra = diff.planUpdate(stored, { signature_drinks: [...stored.signature_drinks, PINA] }, { deadlines: d5 });
check("Inside 6 days extra drinks are relayed to a manager like any other day, never refused", insideExtra.requests !== null && insideExtra.cutoffChanges.length === 0 && insideExtra.applied === null);
const insideDive = diff.planUpdate(stored, { dive_menu_requested: true }, { deadlines: d5 });
check("Inside 6 days a Dive Bar menu request becomes a request", insideDive.cutoffChanges.some((c) => c.field === "dive_menu_requested") && insideDive.applied === null);

const outside = diff.planUpdate(stored, { signature_drinks: swapped, event_date: "2026-11-21", guest_count: 150 }, { deadlines: d6 });
check("6 or more days out a drink change applies", outside.cutoffChanges.length === 0 && (outside.next.signature_drinks as { name: string }[])[0].name === "Pina Colada");
check("Date and guest count apply now, nothing held", outside.next.event_date === "2026-11-21" && outside.next.guest_count === 150 && outside.applied!.applied);
check("No pending change or change order fields are left in the plan", !("pendingChanges" in outside) && !("changeOrder" in outside));

// Pricing a change against what the client booked.
const basis = { package: "Full Bar", guests: 100, hours: 4, isWedding: false, bartenders: 2, tipJar: true, woodenBar: true };
const engine = pricing.priceEvent(basis)!;
const booked = {
  package_price: engine.packagePrice, gratuity: engine.gratuity, total: engine.total, bartenders: 2, promo_code: null,
  custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: 150, source: "create-session" as const, basis,
};
const quote = (changes: { field: string; old: unknown; new: unknown }[]) =>
  priceChange.buildPriceChange({
    booked, original: basis, stored, nextEvent: diff.applyChanges(stored, changes), session: {}, changes,
  });
const more = quote([{ field: "guest_count", old: 100, new: 150 }]);
const after150 = pricing.priceEvent({ ...basis, guests: 150, bartenders: Math.max(2, pricing.staffingFor(150)) })!;
check("More guests: difference comes from the pricing engine", more.amount !== null && more.amount > 0 && more.new_total === booked.total + more.amount, JSON.stringify({ amount: more.amount, total: more.new_total }));
check("More guests: new total matches the engine total", more.new_total === Math.max(booked.total, after150.total) || more.new_total === booked.total + (after150.packagePrice - engine.packagePrice) + Math.max(0, after150.gratuity - engine.gratuity), `${more.new_total} vs ${after150.total}`);
check("Price text states the difference and the new total", more.price_text.includes(priceChange.money(more.amount!)) && more.price_text.includes(priceChange.money(more.new_total!)), more.price_text);
const shift = quote([{ field: "bar_service_start", old: "6:00 PM", new: "7:00 PM" }, { field: "bar_service_end", old: "10:00 PM", new: "11:00 PM" }]);
check("Time shift with the same hours is no change in price", shift.amount === 0 && shift.price_text.startsWith("No change in price"), shift.price_text);
const longer = quote([{ field: "bar_service_end", old: "10:00 PM", new: "11:00 PM" }]);
check("A longer service prices the extra hour and implies the new hours", (longer.amount ?? 0) > 0 && longer.implied!.some((c) => c.field === "hours_booked" && c.new === 5));
const fewer = quote([{ field: "guest_count", old: 100, new: 60 }]);
check("Fewer guests is a credit or no change, never a charge", (fewer.amount ?? 1) <= 0, String(fewer.amount));
const moved = priceChange.bookedAfter(booked, more, 3, "2026-11-09T00:00:00Z");
check("Booked price moves to the new total", moved.total === more.new_total && moved.source === "update" && moved.basis?.guests === 150);

// Webhook payload for an applied price change.
const applied = { ...stored, guest_count: 150, event_date: "2026-11-14" };
const session = {
  id: "s1", name: "Test", email: "t@example.com", event_date: "2026-11-14", package_type: "Full Bar", guest_count: "150",
  event_name: null, hours_booked: "4", status: "submitted" as const, event_data: applied, version: 3,
  submitted_at: null, updated_at: null, booked_price: moved,
};
const row = {
  id: "r1", session_id: "s1", version: 3, created_at: NOW.toISOString(), source: "concierge" as const,
  changes: [{ field: "guest_count", old: 100, new: 150 }], summary: null, within_deadline: true, applied: true,
  change_order: more,
};
console.log = () => {};
const payload = notes.buildUpdatePayload(session, row);
const note = notes.buildUpdateNote(row, session);
console.log = quiet;
check("Payload: event_update_applied is true", payload.event_update_applied === true);
check("Payload: needs_change_order is always false", payload.needs_change_order === false);
check("Payload: pending_change_amount and new total carry the price change", payload.pending_change_amount === more.amount && payload.pending_change_new_total === more.new_total);
check("Payload: price text and payment preference are sent", payload.pending_change_price_text === more.price_text && "payment_preference" in payload);
check("Payload: within_six_days is true inside the cutoff", payload.within_six_days === true);
check("Payload: booked total is the new total", payload.booked_total === more.new_total);
check("Payload: changed booking fields are named", payload.pending_change_fields === "guest_count" && payload.pending_change_guest_count === "150");
const farRow = { ...row, created_at: "2026-11-01T18:00:00Z", change_order: null, changes: [{ field: "day_of_contact_name", old: "Sam", new: "Jordan" }] };
console.log = () => {};
const farPayload = notes.buildUpdatePayload(session, farRow);
console.log = quiet;
check("Payload: within_six_days is false 6 or more days out", farPayload.within_six_days === false);
check("Payload: no price change sends empty money keys", farPayload.pending_change_amount === null && farPayload.pending_change_price_text === "");
check("Note says the update applied and has no signing wording", note.startsWith("EVENT UPDATE v3") && !/sign|change order/i.test(note), note);
check("Note flags an update within 6 days", note.includes("Within 6 days of the event"));

// Prompts and pages.
const NO_SIGNING = /\b(to sign|sign (it|the|a)|signing|signed|signature to)\b|change order|take effect|takes effect|taking effect/i;
const promptOpen = buildUpdatePrompt(stored, 3, d6, { booked });
const promptLocked = buildUpdatePrompt(stored, 3, d5, { booked, recap: { lines: ["Guest count: from 100 to 150"], totalBefore: 1749, totalAfter: 2100 } });
check("Update prompt has no signing or change order wording", !NO_SIGNING.test(promptOpen), promptOpen.match(NO_SIGNING)?.[0]);
check("Intake change deadline copy has no signing wording", !NO_SIGNING.test(CHANGE_DEADLINES));
check("Intake change deadline copy uses the 6 day rule", CHANGE_DEADLINES.includes("Up to 6 days before your event they save right away") && CHANGE_DEADLINES.includes("sent to our team for approval"));
check("Intake change deadline copy never says drinks cannot change", !/except your drink menu|cannot change|locked/i.test(CHANGE_DEADLINES));
check("Update prompt carries the exact request message", promptLocked.includes(CHANGE_REQUEST_MESSAGE));
check("Request message says it went to our team and is not confirmed, never saved", CHANGE_REQUEST_MESSAGE.includes("sent this change to our team for approval") && CHANGE_REQUEST_MESSAGE.includes("not confirmed yet") && !/\bsaved\b/i.test(CHANGE_REQUEST_MESSAGE));
check("Prompt inside 6 days says drink changes are requests", promptLocked.includes("WITHIN 6 DAYS") && promptLocked.includes("REQUEST FOR APPROVAL") && !promptLocked.includes("drink menu is LOCKED"));
check("Prompt no longer says drinks cannot change inside 6 days", !/everything can still be changed except drinks|is refused\. Do NOT confirm it/.test(promptLocked));
check("Prompt tells the bot never to call a request saved", promptLocked.includes("Never say a request was saved"));
check("Open prompt says the drink menu is open", promptOpen.includes("drink menu is OPEN"));
check("Prompt tells the bot to quote with the pricing engine before saving", promptOpen.includes("quote_price_change") && promptOpen.includes("quoted_new_total"));
check("Prompt says a time shift with the same hours is no change in price", promptOpen.includes("There is no change in price."));
check("Prompt sends a drink change inside 6 days with the complete drinks array", promptOpen.includes("call update_event_data with the COMPLETE signature_drinks array exactly like a normal drink change"));
check("Prompt recap lists the chat's changes", promptLocked.includes("Guest count: from 100 to 150") && promptLocked.includes("Total: from $1,749 to $2,100"));
check("Prompt has no Monday or Wednesday drink deadline", !/Monday before|Wednesday before/.test(promptOpen + CHANGE_DEADLINES));

const recap = diff.recapLines([
  { field: "guest_count", old: 100, new: 120 },
  { field: "guest_count", old: 120, new: 150 },
  { field: "day_of_contact_name", old: "Sam", new: "Jordan" },
  { field: "signature_drinks[0]", old: MARGARITA, new: PINA },
  { field: "special_requests", old: "", new: "We will provide the cups." },
  { field: "theme", old: "Gold", new: "Gold" },
]);
check("Recap: one line per field, first old value to last new value", recap.includes("Guest count: from 100 to 150") && !recap.some((l) => l.includes("120")), recap.join(" | "));
check("Recap: drinks by name, no oz amounts", recap.includes("Drink 1: from Margarita to Pina Colada") && !recap.some((l) => /\boz\b/.test(l)), recap.join(" | "));
check("Recap: notes show what was added", recap.some((l) => l.startsWith('Special requests: added "We will provide the cups."')));
check("Recap: unchanged fields drop out", !recap.some((l) => l.startsWith("Theme")));

const completePage = readFileSync(new URL("../app/complete/page.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
const updatePage = readFileSync(new URL("../app/s/update-mode.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
for (const [name, text] of [["Completion page", completePage], ["Update page", updatePage]]) {
  check(`${name} has the 6 day deadline copy`, text.includes("up to 6 days before your event") && /sent to our team for\s+approval/.test(text) && !text.includes("except your drink menu"));
  check(`${name} has no signing or old deadline wording`, !NO_SIGNING.test(text.replace(/signature_drinks|Signature Drinks|signature menu/gi, "")) && !/Monday before|Wednesday before/.test(text));
}
check("Update page sends the chat start version for the recap", updatePage.includes("chatStartVersion"));
check("Update page refreshes event details on save", /parsed\.event === "updated"[^}]*setEventData/.test(updatePage));

if (failed > 0) {
  console.error(`\n${failed} of ${total} menu checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} menu checks pass.`);
