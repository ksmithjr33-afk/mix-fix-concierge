// Part 2: the Dive Bar set menu. Concierge prompt, the recorded menu, the
// shopping lists, update mode, GHL fields, and the bartender page.
// Run: node --no-warnings scripts/test-dive.mts

import { check, done, src } from "./team-harness.mts";

const dive = await import("../lib/dive-menu.ts");
const { SYSTEM_PROMPT, DRINK_MENU_RULES } = await import("../lib/system-prompt.ts");
const { buildUpdatePrompt } = await import("../lib/update-prompt.ts");
const diff = await import("../lib/event-diff.ts");
const list = await import("../lib/shopping-list.ts");
const { allowedMenus } = await import("../lib/menu-markers.ts");
const { buildEventFields } = await import("../lib/ghl-payload.ts");
const view = await import("../lib/team/event-view.ts");

const FIVE = "Margarita,Old Fashioned,Cosmopolitan,Lemon Drop,Moscow Mule";
const ELEVEN = ["Espresso Martini", "French Connection", "Aperol Spritz", "Mojito", "Mint Julep", "Bloody Mary", "Mai Tai", "Sidecar", "Bellini", "Amaretto Sour", "Hurricane"];
const LINE = "Dive Bar comes with a set menu of five favorites: Margarita, Old Fashioned, Cosmopolitan, Lemon Drop and Moscow Mule. Your guests can also order any other classic you would find at a dive bar.";
const lines = SYSTEM_PROMPT.split("\n");
const flow = lines.find((l) => l.startsWith("Dive Bar Package: LOGISTICS")) ?? "";

// ----- Concierge -----
check("The set menu line is exactly as written", dive.DIVE_SET_MENU_LINE === LINE);
check("The Dive Bar flow tells the client the set menu line once", flow.includes(`Once, during or right after logistics, tell the client exactly: "${LINE}"`), flow.slice(0, 300));
check("The Dive Bar flow never asks about a signature cocktail menu", flow.includes("Do NOT ask whether they want a signature cocktail menu") && !SYSTEM_PROMPT.includes("Would you like us to build a signature cocktail menu"));
check("The Dive Bar flow skips drink selection, naming, and menu design", flow.includes("SKIP Phase 3 (drink selection), creative naming, Phase 3B (menu design)"));
check("The Dive Bar flow still collects logistics, allergies, day of contact, and payment", flow.includes("Phase 1 logistics as normal") && flow.includes("allergies and the day of contact") && flow.includes("the PAYMENT STEP"));
check("Phase 3 is skipped on Dive Bar", SYSTEM_PROMPT.includes("PHASE 3 COCKTAIL MENU: Skip this entire phase if the client booked the Beer and Wine Package or the Dive Bar Package"));
check("Phase 3B asks nothing on Dive Bar", /PHASE 3B MENU DESIGN \(REQUIRED for all packages except Beer and Wine and Dive Bar; [^)]*ask nothing about menu design\)/.test(SYSTEM_PROMPT));
check("The old open bar question and three classics flow are gone", !SYSTEM_PROMPT.includes("keep it open bar style") && !SYSTEM_PROMPT.includes("three classics are confirmed") && !SYSTEM_PROMPT.includes("on Dive Bar suggest an Old Fashioned"));
check("No more signature only drinks on Dive Bar", !SYSTEM_PROMPT.includes("only available if you pick it as a signature drink"));
const autoFill = lines.find((l) => l.startsWith("AUTO FILL BY PACKAGE:")) ?? "";
for (const d of ELEVEN) check(`${d} is never available on Dive Bar`, new RegExp(`eleven drinks are NEVER available on Dive Bar[^.]*\\b${d}\\b`).test(autoFill));
check("The excluded drinks get the same flat answer", autoFill.includes('say "That one is not part of the Dive Bar package" and offer drinks from the CLASSICS section instead. Do not ask for a recipe.'));
check("Drink sourcing names the five and the classics", SYSTEM_PROMPT.includes("Dive Bar: SET MENU, NO DRINK SELECTION.") && SYSTEM_PROMPT.includes("Margarita, Old Fashioned, Cosmopolitan, Lemon Drop, and Moscow Mule"));
check("No menu pictures on Dive Bar", allowedMenus("Dive Bar").length === 0 && allowedMenus("Dive Bar", true).length === 0 && SYSTEM_PROMPT.includes("Dive Bar: never, it has its set menu."));
check("Other packages keep their menu pictures", allowedMenus("Full Bar").join() === "specialty,classics" && allowedMenus("Essentials Bar").join() === "specialty");
check("The submit tool tells the model to leave Dive Bar drinks empty", SYSTEM_PROMPT.includes("an empty array for Beer and Wine Package and Dive Bar, since the system records the Dive Bar set menu itself"));

// ----- The recorded menu -----
const classics = dive.classicRecipes();
const drinks = dive.diveSetMenuDrinks();
check("The set menu is the five", drinks.map((d) => d.name).join() === FIVE);
for (const d of drinks) {
  const c = classics.find((x) => x.name === d.name)!;
  check(`${d.name} uses the CLASSICS recipe`, !!c && [...d.ingredients, d.garnish].filter(Boolean).every((part) => c.recipe.includes(part)) && d.ingredients.every((i) => /oz|top with|dash/i.test(i)), JSON.stringify(d));
}
check("Base spirits: tequila, whiskey, vodka", drinks.map((d) => d.base_spirit).join() === "tequila,whiskey,vodka,vodka,vodka");
const submitted = dive.applyDiveSetMenu({ package: "Dive Bar", signature_drinks: [{ name: "Mojito", base_spirit: "rum", ingredients: ["2 oz rum"] }], dive_menu_requested: true });
check("At submit, Dive Bar records the five, whatever the model sent", (submitted.signature_drinks as { name: string }[]).map((d) => d.name).join() === FIVE && submitted.dive_set_menu === true && submitted.dive_menu_requested === false);
const full = { package: "Full Bar", signature_drinks: [{ name: "Mojito" }] };
check("Other packages are untouched at submit", dive.applyDiveSetMenu(full) === full);
const chat = src("app/api/chat/route.ts");
check("The chat route records the set menu at submit", chat.includes("const eventData = applyDiveSetMenu(toolUse.input as Record<string, unknown>);"));
const also = dive.diveAlsoAvailable().map((c) => c.name);
check("Also available leaves out the five and the eleven", !also.some((n) => FIVE.split(",").includes(n) || ELEVEN.includes(n)) && also.includes("Pina Colada") && also.includes("Paloma"));

// ----- Shopping list: the well covers all five -----
const ed = (extra: Record<string, unknown> = {}, guests = 100) => ({
  package: "Dive Bar",
  guest_count: guests,
  drinking_pace: "moderate",
  beer: false,
  wine: false,
  bar_service_start: "6:00 PM",
  bar_service_end: "10:00 PM",
  event_type: "birthday",
  event_date: "2026-12-12",
  signature_drinks: [],
  ...extra,
});
const setEvent = dive.applyDiveSetMenu(ed()) as ReturnType<typeof ed>;
const mute = console.log;
console.log = () => {};
const items = list.generateShoppingList(setEvent as never);
const supply = list.generateNatalieSupplyList(setEvent as never);
const order = list.generateOrderTeamEmail(items, setEvent as never);
const note = list.formatShoppingListForNote(items, setEvent as never);
const spirits = new Map(items.filter((i) => i.category === "Spirits").map((i) => [i.item.toLowerCase(), Number(i.quantity.match(/^(\d+)/)?.[1])]));
console.log = mute;
const has = (text: string, word: string) => text.toLowerCase().includes(word.toLowerCase());
for (const spirit of ["tequila", "whiskey", "vodka", "triple sec"]) check(`The alcohol list has ${spirit}`, spirits.has(spirit), [...spirits.keys()].join());
for (const word of ["lime juice", "lemon juice", "simple syrup", "bitters", "cranberry juice", "ginger beer", "salt", "sugar", "oranges"]) {
  check(`The supply list has ${word}`, has(supply, word));
}
for (const word of ["lime juice", "lemon juice", "simple syrup", "bitters", "cranberry juice", "ginger beer", "salt", "sugar"]) {
  check(`The order email has ${word}`, has(order, word));
  check(`The shopping note has ${word}`, has(note, word));
}
check("The well still stocks the other classics (rum, gin, vermouth, prosecco)", ["rum", "gin", "dry vermouth", "sweet vermouth", "prosecco"].every((k) => spirits.has(k)));
check("Spirits weight toward tequila, whiskey, and vodka", Math.min(spirits.get("tequila")!, spirits.get("whiskey")!, spirits.get("vodka")!) > Math.max(spirits.get("rum")!, spirits.get("gin")!));
check("100 guests: 6 vodka, 5 tequila, 5 whiskey, 2 rum, 2 gin, 3 triple sec", [["vodka", 6], ["tequila", 5], ["whiskey", 5], ["rum", 2], ["gin", 2], ["triple sec", 3]].every(([k, n]) => spirits.get(k as string) === n), JSON.stringify([...spirits]));
check("Cranberry is sized for Cosmopolitans: 3 bottles for 100 guests", /Cranberry juice — 3 x 32 oz bottles/.test(supply) && /Cranberry juice — 3 x 32 oz bottles/.test(order));
check("Ginger beer is listed once in the order email", (order.match(/Ginger beer —/g) ?? []).length === 1);
check("The supply list has the five recipes for the bartender", FIVE.split(",").every((n) => supply.includes(`<b>${n}</b>`)));
console.log = () => {};
const oldNoMenu = list.generateShoppingList(ed() as never);
console.log = mute;
check("A Dive Bar booking from before the set menu (no drinks) gets the same well", JSON.stringify(oldNoMenu) === JSON.stringify(items));

// ----- Existing Dive Bar events that picked drinks keep them -----
const picked = ed({ signature_drinks: [{ name: "Paloma", base_spirit: "tequila", ingredients: ["2 oz tequila", "0.5 oz lime juice", "top with grapefruit soda"], garnish: "tajin rim" }], dive_menu_requested: true });
check("An older Dive Bar event with picked drinks does not use the set menu", !dive.usesDiveSetMenu(picked));
console.log = () => {};
const pickedItems = list.generateShoppingList(picked as never);
console.log = mute;
check("Its alcohol list still follows its own recipes", pickedItems.some((i) => /tequila/i.test(i.item)) && !pickedItems.some((i) => /vodka|whiskey/i.test(i.item)), JSON.stringify(pickedItems.map((i) => i.item)));
const pickedView = view.buildStaffEventView({ id: "x", event_data: picked } as never);
check("Its bartender page shows the drinks it picked, not the set menu", pickedView.drinks.map((d) => d.name).join() === "Paloma" && !pickedView.setMenu && pickedView.classics === null);

// ----- Update mode -----
const NOW = new Date("2026-11-01T17:00:00Z");
const far = diff.computeDeadlines("2026-12-12", NOW);
const stored = { ...setEvent, guest_count: 100 };
const swap = diff.planUpdate(stored, { signature_drinks: [drinks[0], drinks[1], { name: "Paloma", base_spirit: "tequila", ingredients: ["2 oz tequila"] }, drinks[3], drinks[4]] }, { deadlines: far });
check("A Dive Bar client cannot change the drink menu, even weeks out", swap.diveMenuSet && swap.applied === null && JSON.stringify(swap.next.signature_drinks) === JSON.stringify(stored.signature_drinks));
const add = diff.planUpdate(stored, { signature_drinks: [...drinks, { name: "Paloma" }] }, { deadlines: far });
check("A Dive Bar client cannot add drinks either", add.diveMenuSet && add.requests === null && add.applied === null);
const mixed = diff.planUpdate(stored, { guest_count: 120, signature_drinks: [] }, { deadlines: far });
check("Other changes in the same update still apply", mixed.diveMenuSet && mixed.applied?.changes.map((c) => c.field).join() === "guest_count");
const toDive = diff.planUpdate({ package: "Full Bar", signature_drinks: [{ name: "French Martini" }] }, { package: "Dive Bar" }, { deadlines: far });
check("Switching to Dive Bar brings the set menu", (toDive.next.signature_drinks as { name: string }[]).map((d) => d.name).join() === FIVE && toDive.next.dive_set_menu === true && !toDive.diveMenuSet);
const fromDive = diff.planUpdate(stored, { package: "Full Bar" }, { deadlines: far });
check("Leaving Dive Bar keeps the five as drinks, no longer a set menu", fromDive.next.dive_set_menu === false && (fromDive.next.signature_drinks as unknown[]).length === 5);
check("Full Bar drink changes are not affected", !diff.planUpdate({ package: "Full Bar", signature_drinks: [] }, { signature_drinks: [{ name: "Paloma" }] }, { deadlines: far }).diveMenuSet);
const promptDive = buildUpdatePrompt(stored as never, 2, far);
check("The update prompt says the Dive Bar menu is set", promptDive.includes("DIVE BAR SET MENU") && promptDive.includes(dive.DIVE_MENU_SET_MESSAGE));
check("The update prompt for other packages has no set menu rule", !buildUpdatePrompt({ package: "Full Bar" } as never, 2, far).includes("DIVE BAR SET MENU"));
check("The menu set message names the package", dive.DIVE_MENU_SET_MESSAGE.startsWith("Your drink menu is set for the Dive Bar package"));
check("The chat route answers with the menu set message", (chat.match(/DIVE_MENU_SET_MESSAGE/g) ?? []).length >= 5);

// ----- GHL lists and the designer brief -----
console.log = () => {};
const fields = buildEventFields(setEvent).fields;
console.log = mute;
check("The designer brief has the five for the printed menu", !!fields.graphic_designer_brief && FIVE.split(",").every((n) => fields.graphic_designer_brief!.includes(n)));
check("The GHL drink summary lists the five", FIVE.split(",").every((n) => (fields.signature_drink_summary ?? "").includes(n)));
check("GHL is told this is the set menu", fields.dive_set_menu === true);
check("The GHL shopping note covers the well", !!fields.shopping_list && /salt/i.test(fields.shopping_list) && /vodka/i.test(fields.shopping_list));

// ----- Bartender page -----
const v = view.buildStaffEventView({ id: "x", event_data: setEvent } as never);
const alsoNames = (v.classics ?? []).flatMap((g) => g.drinks.map((d) => d.name));
check("The bartender page shows the five as the set menu, with recipes", v.setMenu && v.drinks.map((d) => d.name).join() === FIVE && v.drinks[0].ingredients[0] === "2 oz tequila blanco");
check("The bartender page lists the other classics as Also available", alsoNames.includes("Pina Colada") && !alsoNames.some((n) => FIVE.split(",").includes(n) || ELEVEN.includes(n)));
const tabs = src("app/team/e/[id]/event-tabs.tsx");
check("The page labels them Dive Bar set menu and Also available", tabs.includes('v.setMenu ? "Dive Bar set menu" : "Signature drinks"') && tabs.includes(">Also available</h3>"));
check("The CLASSICS section still has every recipe the five need", FIVE.split(",").every((n) => new RegExp(`^${n}: `, "m").test(DRINK_MENU_RULES)));

done("dive bar");
