// Every saved recipe ingredient lands on the Shopping list. A custom recipe's
// crème de cacao was dropped (no oz-less match, folded into the base spirit),
// and Prosecco was listed as a mixer. Sparkling wine is client provided
// alcohol, never a mixer. Anything the list cannot match is flagged to admins
// only: "Not matched, check this".
// Run: node --no-warnings scripts/test-recipe-coverage.mts

import { check, done, src } from "./team-harness.mts";

const sl = await import("../lib/shopping-list.ts");
const os = await import("../lib/order-sheet.ts");
const cl = await import("../lib/client-list.ts");
const cov = await import("../lib/recipe-coverage.ts");
const cat = await import("../lib/menu-catalog.ts");

const grasshopper = { name: "Grasshopper Twist", base_spirit: "vodka", is_custom: true, ingredients: ["1.5 oz vodka", "1 oz crème de cacao", "1 oz creme de menthe", "1 oz heavy cream"], garnish: "mint" };
const spritz = { name: "Aperol Spritz", menu_name: "Aperol Spritz", base_spirit: "aperol", ingredients: ["2 oz Aperol", "3 oz Prosecco", "1 oz soda water"] };
const mimosa = { name: "Mimosa", base_spirit: "", ingredients: ["2 oz orange juice", "Top with champagne"] };
const ed = { package: "Full Bar", guest_count: 100, hours_booked: 4, event_type: "Corporate", signature_drinks: [grasshopper, spritz, mimosa] };

const lines = os.calculatedLines(ed as never);
const line = (re: RegExp) => lines.find((l: { name: string }) => re.test(l.name));

// ----- The saved custom recipe's liqueurs -----
check("Crème de cacao from the saved custom recipe is on the list", !!line(/^creme de cacao$/i) && line(/^creme de cacao$/i).section === "liquor");
check("Crème de menthe is its own bottle too, not more vodka", !!line(/^creme de menthe$/i) && !!line(/^vodka$/i));
check("Heavy cream is on the list as a mixer", line(/heavy cream/i)?.section === "mixers");

// ----- Sparkling wine is client alcohol, never a mixer -----
const pro = line(/prosecco/i);
check("Prosecco is in the liquor section, bought by the client", pro?.section === "liquor" && pro?.clientBuys === true);
check("Prosecco is not listed as a mixer", !lines.some((l: { name: string; section: string }) => /prosecco|champagne|sparkling/i.test(l.name) && l.section !== "liquor"));
check("Top with champagne (no oz) still counts, as client alcohol", line(/champagne/i)?.section === "liquor" && line(/champagne/i)?.clientBuys === true);
const client = JSON.stringify(cl.clientList(ed as never));
check("The client's alcohol list includes Prosecco, Champagne and crème de cacao", /Prosecco/.test(client) && /Champagne/.test(client) && /Creme de cacao/i.test(client));
check("sparklingKey knows the names", ["prosecco", "champagne", "cava", "lambrusco", "sparkling wine"].every((k, i) => sl.sparklingKey(["La Marca Prosecco", "Champagne", "cava brut", "Lambrusco", "dry sparkling wine"][i]) === k) && sl.sparklingKey("sparkling water") === null);

// ----- Nothing is dropped: the whole menu matches with no flags -----
let flags = 0;
const all = [...cat.craftDrinks(), ...cat.classicDrinks()];
for (let i = 0; i < all.length; i += 3) {
  const trio = all.slice(i, i + 3).map((d: Record<string, unknown>) => ({ ...d, menu_name: d.name }));
  const e = { package: "Full Bar", guest_count: 100, hours_booked: 4, signature_drinks: trio };
  flags += cov.unmatchedIngredients(os.recipes(e as never), os.calculatedLines(e as never).map((l: { name: string }) => l.name)).length;
}
check(`Every ingredient of all ${all.length} menu drinks lands on a list line (no false flags)`, flags === 0);
const basil = { name: "Basil Smash", base_spirit: "gin", ingredients: ["2 oz gin", "muddled basil", "0.75 oz lemon juice", "0.5 oz simple syrup"], garnish: "lemon wheel" };
check("Muddled basil in a recipe lands in produce", !!os.calculatedLines({ ...ed, signature_drinks: [basil] } as never).find((l: { name: string }) => /basil/i.test(l.name)));

// ----- Not matched, check this -----
const saved = [{ name: "House Special", ingredients: ["2 oz vodka", "1 oz yuzu kosho cordial", "2 dashes bitters", "Top with soda", "ice"] }];
const u = cov.unmatchedIngredients(saved, ["Vodka", "Soda water"]);
check("An ingredient no line covers is flagged with its drink", u.length === 1 && u[0].ingredient === "yuzu kosho cordial" && u[0].drink === "House Special");
check("Kit items (bitters, ice) are never flagged", !u.some((x) => /bitters|ice/.test(x.ingredient)));
check("Brand names match their line (St. Germain is Elderflower liqueur)", cov.matches("0.5 oz St. Germain", ["Elderflower liqueur"]) && cov.matches("1 oz Cointreau", ["Triple sec"]));
check("A removed line counts as decided, a house syrup counts as covered", src("lib/order-sheet-db.ts").includes("...sheet.removed.map((l) => l.fields.name), ...syrups.map((s) => s.name)"));
check("The flag reads exactly: Not matched, check this", cov.NOT_MATCHED_TITLE === "Not matched, check this");
const sheetUi = src("app/team/admin/e/[id]/order/order-sheet.tsx");
check("The admin Shopping list shows it", sheetUi.includes("{NOT_MATCHED_TITLE}") && sheetUi.includes("view.unmatched.map"));
const db = src("lib/order-sheet-db.ts");
const staffFn = db.slice(db.indexOf("export async function staffSheet"), db.indexOf("export async function staffSheet") + 900);
check("Staff never get it (admin sheet only)", !staffFn.includes("unmatched") && !src("app/team/e/[id]/shopping-list.tsx").includes("unmatched"));

done("recipe coverage");
