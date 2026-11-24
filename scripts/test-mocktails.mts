// The concierge never creates a drink, mocktails included. With no mocktail
// menu loaded, a mocktail request becomes a follow up: written to the client
// ("Our team will send you mocktail options."), a team note, and a placeholder
// that holds the drink spot with no recipe and no ingredients. Enforced on the
// server for new submissions and new updates; saved events are never changed.
// Once a mocktail menu is loaded, mocktails come from it and the follow up
// path turns off by itself. The read only review list of upcoming events.
// Run: node --no-warnings scripts/test-mocktails.mts

import { check, done, src } from "./team-harness.mts";

const mm = await import("../lib/mocktail-menu.ts");
const plan = await import("../lib/intake-plan.ts");
const diff = await import("../lib/event-diff.ts");
const sp = await import("../lib/system-prompt.ts");
const review = await import("../lib/team/mocktail-review.ts");

const MENU = `Strawberry Fields: strawberry, lemonade, fizzy. Recipe: 1 oz strawberry puree, 4 oz lemonade, Top with club soda.
Cucumber Cooler: cucumber, lime, mint. Recipe: 1 oz cucumber syrup, 0.75 oz lime juice, 6 mint leaves, Top with sparkling water.`;

// The Emily Wilcox corporate event shape: Full Bar, three drinks, the concierge built a peppermint mocktail.
const peppermint = { name: "Peppermint Mocktail", base_spirit: "", description: "Cool peppermint and cream", ingredients: ["2 oz peppermint syrup", "2 oz cream", "Top with club soda"], garnish: "candy cane", is_mocktail: true };
const mule = { name: "Mule", menu_name: "Moscow Mule", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.5 oz lime juice", "Top with ginger beer"], garnish: "lime" };
const paloma = { name: "Paloma", menu_name: "Paloma", base_spirit: "tequila", ingredients: ["2 oz tequila", "0.5 oz lime juice", "Top with grapefruit soda"], garnish: "lime" };
const corporate = { client_name: "Emily Wilcox", event_type: "Corporate", package: "Full Bar", special_requests: "", signature_drinks: [mule, paloma, peppermint] };

// ----- 1. There is no mocktail menu loaded today -----
check("No mocktail menu is loaded", !mm.hasMocktailMenu() && mm.mocktailMenu().length === 0);

// ----- 2. How the session got around the rule: the prompt told it to make mocktails up -----
const prompt = sp.buildIntakePrompt(null);
check("The prompt no longer says it can create original mocktails", !/create original mocktail/i.test(prompt) && !/KEEP MOCKTAIL RECIPES SIMPLE/.test(prompt) && !/suggest 3 mocktail options/.test(prompt));
check("The prompt says there is no mocktail menu and never to build one", /There is no mocktail menu yet, so you never suggest, name, describe, or build a mocktail/.test(prompt) && /never write mocktail ingredients or a recipe/.test(prompt));
check("It tells the client plainly: Our team will send you mocktail options.", prompt.includes('exactly: "Our team will send you mocktail options."'));
check("The mocktail holds an included drink spot, never an extra drink", /still takes one of their included signature drink spots/.test(prompt) && /Never offer an additional drink or quote \$50 in its place/.test(prompt));
check("The CONDUCT RULE still says never invent a drink", prompt.includes("Never invent a drink or a recipe."));
check("Most popular mocktails names none while there is no menu", sp.popularSection({ cocktails: ["French Martini"], mocktails: ["Victory Lemonade", "Peppermint Fizz"] }).includes("MOST POPULAR MOCKTAILS: none on file yet"));
check("The update concierge gets the same rules (it reads the intake drink rules)", src("lib/update-prompt.ts").includes("DRINK_MENU_RULES") || src("lib/update-prompt.ts").includes("drinkRules"));

// ----- 3. New intake submissions: the server check -----
const c = plan.checkDrinks(structuredClone(corporate), "Full Bar");
const drinks = c.data.signature_drinks as Record<string, unknown>[];
const ph = drinks[2];
check("The invented peppermint mocktail is not saved: no recipe, no ingredients", !JSON.stringify(c.data).includes("peppermint") && Array.isArray(ph.ingredients) && (ph.ingredients as unknown[]).length === 0);
check("A placeholder holds its drink spot (three drinks, the package count)", drinks.length === 3 && ph.mocktail_followup === true && ph.name === "Mocktail (options coming)" && ph.is_mocktail === true);
check("Written to the client in special requests", String(c.data.special_requests).includes("Our team will send you mocktail options."));
check("A team note to follow up with mocktail options", /Follow up with mocktail options/.test(String(c.data.team_notes)) && !String(c.data.special_requests).includes("Follow up"));
check("It is not counted as an unfinished drink or an extra drink", !c.notFinalized && c.unconfirmed.length === 0 && !c.data.drinks_not_finalized);
check("The cocktails are untouched", JSON.stringify(drinks[0]) === JSON.stringify(mule) && JSON.stringify(drinks[1]) === JSON.stringify(paloma));
const unflagged = plan.checkDrinks({ ...structuredClone(corporate), signature_drinks: [mule, paloma, { name: "Virgin Mojito", ingredients: ["8 mint leaves", "1 oz lime juice", "Top with soda"] }] }, "Full Bar");
check("A mocktail the model forgot to flag is caught by its name", (unflagged.data.signature_drinks as Record<string, unknown>[])[2].mocktail_followup === true);
const asked = plan.checkDrinks({ ...structuredClone(corporate), signature_drinks: [mule, paloma, mm.followupDrink()] }, "Full Bar");
check("The placeholder the concierge sends is kept, with the client line and team note", (asked.data.signature_drinks as Record<string, unknown>[])[2].mocktail_followup === true && String(asked.data.special_requests).includes("Our team will send you mocktail options."));
const ess = plan.checkDrinks({ ...structuredClone(corporate), package: "Essentials Bar", signature_drinks: [mule, paloma, peppermint] }, "Essentials Bar");
check("Essentials Bar: no mocktails at all, the request is noted to the client", (ess.data.signature_drinks as unknown[]).length === 2 && String(ess.data.special_requests).includes("not part of your package menu") && !JSON.stringify(ess.data).includes("peppermint"));

// ----- 4. New updates: the same check, and saved events are never changed -----
const deadlines = { withinSixDays: false } as never;
const savedOld = { ...structuredClone(corporate) }; // saved before this check, with its mocktail
const keep = diff.planUpdate(savedOld, { signature_drinks: [mule, paloma, peppermint] }, { deadlines });
check("An update that resends a saved mocktail unchanged leaves it alone", !keep.applied || !keep.applied.changes.some((ch) => ch.field.startsWith("signature_drinks")));
const swap = diff.planUpdate(savedOld, { guest_count: 80 }, { deadlines });
check("Other updates never touch the saved mocktail", JSON.stringify((swap.next.signature_drinks as unknown[])[2]) === JSON.stringify(peppermint));
const fresh = { ...structuredClone(corporate), signature_drinks: [mule, paloma] };
const add = diff.planUpdate(fresh, { signature_drinks: [mule, paloma, { name: "Candy Cane Spritz", is_mocktail: true, ingredients: ["2 oz peppermint syrup", "Top with Sprite"] }] }, { deadlines });
const added = (add.next.signature_drinks as Record<string, unknown>[])[2];
check("A new mocktail in an update becomes the follow up, no recipe", added.mocktail_followup === true && (added.ingredients as unknown[]).length === 0 && !JSON.stringify(add.next).includes("peppermint syrup"));
check("...with the client line and the team note", String(add.next.special_requests).includes("Our team will send you mocktail options.") && /Follow up with mocktail options/.test(String(add.next.team_notes)));
const changed = diff.planUpdate(savedOld, { signature_drinks: [mule, paloma, { ...peppermint, ingredients: ["2 oz peppermint syrup", "Top with soda"] }] }, { deadlines });
check("Changing a saved mocktail's recipe is a new mocktail: it becomes the follow up", ((changed.next.signature_drinks as Record<string, unknown>[])[2]).mocktail_followup === true);

// ----- 5. Once a mocktail menu is loaded -----
check("A menu in the documented format loads", mm.mocktailMenu(MENU).length === 2 && mm.mocktailMenu(MENU)[0].ingredients.join("|") === "1 oz strawberry puree|4 oz lemonade|Top with club soda");
const withMenu = mm.guardMocktails([{ name: "Berry Bliss", menu_name: "Strawberry Fields", is_mocktail: true, ingredients: ["made up"] }, peppermint], { allowsMocktails: true, menuText: MENU });
const kept = withMenu.drinks[0] as Record<string, unknown>;
check("A menu mocktail saves with the menu's own recipe", kept.menu_name === "Strawberry Fields" && (kept.ingredients as string[]).join("|") === "1 oz strawberry puree|4 oz lemonade|Top with club soda" && kept.mocktail_followup === undefined);
check("A mocktail not on the menu still becomes the follow up", (withMenu.drinks[1] as Record<string, unknown>).mocktail_followup === true);
const menuRules = sp.mocktailRules(MENU);
check("The prompt switches by itself: offer only from the menu, no follow up path", menuRules.includes("MOCKTAIL MENU:") && menuRules.includes("Strawberry Fields: strawberry, lemonade, fizzy. Recipe: 1 oz strawberry puree") && !menuRules.includes("There is no mocktail menu yet") && /Never invent a mocktail/.test(menuRules));
check("The menu file says exactly how to load it", src("lib/mocktail-menu.ts").includes("export const MOCKTAIL_MENU_TEXT = ``;") && src("lib/mocktail-menu.ts").includes("Name: short description for the client. Recipe:"));

// ----- 6. The read only review list -----
const rows = review.upcomingMocktails(
  [
    { id: "past", status: "submitted", event_data: { event_date: "2026-11-01", signature_drinks: [peppermint] } },
    { id: "emily", status: "submitted", event_data: { event_name: "Wilcox Holiday Party", event_date: "2026-12-12", package: "Full Bar", signature_drinks: [mule, peppermint] } },
    { id: "plain", status: "submitted", event_data: { event_date: "2026-12-13", signature_drinks: [mule] } },
    { id: "follow", status: "submitted", event_data: { event_date: "2026-12-06", signature_drinks: [mm.followupDrink()] } },
    { id: "draft", status: "in_progress", event_data: { event_date: "2026-12-06", signature_drinks: [peppermint] } },
  ],
  "2026-11-24"
);
check("Upcoming submitted events with a mocktail, soonest first; past, drafts and no mocktail left out", rows.map((r) => r.sessionId).join() === "follow,emily");
check("Each shows the mocktail and its ingredients, or that options are coming", rows[1].mocktails[0].name === "Peppermint Mocktail" && rows[1].mocktails[0].ingredients.length === 3 && rows[0].mocktails[0].followup);
const page = src("app/team/admin/mocktails/page.tsx");
check("The page is admins and managers only, and read only", page.includes('requireAdmin("/team/admin/mocktails")') && !/\.update\(|\.insert\(|\.delete\(|<form|onClick/.test(page) && src("app/team/admin/staff/page.tsx").includes('href="/team/admin/mocktails"'));

done("mocktail");
