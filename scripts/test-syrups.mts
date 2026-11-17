// Syrup recipes on the Shopping list: no recipe is made up (the library starts
// empty and admins add them), syrups are found in the event's drinks and
// matched by name or alias, a syrup with a store on its line is Store bought,
// a missing one is Recipe needed with a link to add it, the batch scales to
// the Shopping list amount, a per event edit leaves the library alone, and the
// section shows on the admin Shopping list (printed too) and the bartender
// Supplies tab but never on the client's list.
// Run: node --no-warnings scripts/test-syrups.mts

import { check, done, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const sy = await import("../lib/syrups.ts");
const sydb = await import("../lib/syrups-db.ts");
const sheetDb = await import("../lib/order-sheet-db.ts");
const supplies = await import("../lib/team/supplies-db.ts");

const admin = { id: "admin-1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true };

const SIMPLE = { id: "r1", name: "Simple syrup", aliases: ["simple", "1:1 simple syrup"], ingredients: [{ amount: 1, unit: "cup", item: "sugar" }, { amount: 1, unit: "cup", item: "water" }], ratio: "1:1 sugar to water", method: "Stir sugar into hot water until clear. Cool.", yieldAmount: 1.5, yieldUnit: "cups", shelfLife: "2 weeks in the fridge", bought: false };
const drinks = [
  { name: "Lemon Drop", ingredients: ["2 oz vodka", "1 oz lemon juice", "0.5 oz simple syrup"] },
  { name: "Gold Rush", ingredients: ["2 oz bourbon", "0.75 oz honey syrup", "0.75 oz lemon juice"] },
  { name: "Old Fashioned", ingredients: ["2 oz whiskey", "0.25 oz simple", "2 dashes bitters"] },
  { name: "Mule", ingredients: ["2 oz vodka", "Top with ginger beer"] },
];

// ----- Nothing is made up -----
check("The code holds no syrup recipe: the library starts empty", !/cups? (of )?sugar|parts? sugar|equal parts/i.test(src("lib/syrups.ts").replace(/\/\/.*$/gm, "").replace(/"1 cup sugar"|1 1\/2 cups sugar/g, "")) && !/insert into public\.syrup_recipes/i.test(src("supabase/migrations/20261210_syrup_recipes.sql")));
check("With no library every syrup is Recipe needed", sy.syrupViews({ drinks, library: [], lines: [], storeName: () => "" }).every((s) => s.status === "needed" && s.recipe === null));

// ----- Finding and matching -----
check("Ingredient names without the pour", sy.ingredientName("0.5 oz simple syrup") === "simple syrup" && sy.ingredientName("0.75 oz Honey Syrup (house made)") === "honey syrup" && sy.ingredientName("Top with ginger beer") === "top with ginger beer" && sy.ingredientName("0.5 oz tonic syrup") === "tonic syrup");
const found = sy.drinkSyrups(drinks, [SIMPLE]);
check("Every syrup the drinks use, once each, with its drinks", found.map((f) => f.name).join() === "Simple syrup,Honey syrup" && found[0].drinks.join() === "Lemon Drop,Old Fashioned" && found[1].drinks.join() === "Gold Rush", JSON.stringify(found));
check("Matched by name or alias", sy.matchRecipe("simple", [SIMPLE])?.id === "r1" && sy.matchRecipe("1:1 Simple Syrup", [SIMPLE])?.id === "r1" && sy.matchRecipe("honey syrup", [SIMPLE]) === null);
check("A library prep item without 'syrup' in its name is found by alias", sy.drinkSyrups([{ name: "Sour", ingredients: ["1 oz sour mix"] }], [{ ...SIMPLE, id: "r2", name: "House sour", aliases: ["sour mix"] }])[0]?.name === "House sour");
check("Spirits, juices and sodas are not syrups", !found.some((f) => /vodka|lemon|ginger|bitters/i.test(f.name)));

// ----- Amounts and the batch -----
check("Shopping list amounts in ounces", Math.round(sy.lineOunces({ quantity: "4 bottles", size: "1 liter" })!) === 135 && Math.round(sy.lineOunces({ quantity: "2 bottles", size: "750 ml" })!) === 51 && sy.lineOunces({ quantity: "3 x 32 oz bottles", size: "" }) === 96 && sy.lineOunces({ quantity: "1 case", size: "24 pack" }) === null);
check("Ingredient lines are read", JSON.stringify(sy.parseIngredient("1 1/2 cups sugar")) === JSON.stringify({ amount: 1.5, unit: "cups", item: "sugar" }) && sy.parseIngredient("a pinch of salt")?.amount === null);
const line = { name: "Simple syrup", quantity: "4 bottles", size: "1 liter", text: "Simple syrup — 4 x 1 liter bottles", store: null };
const b = sy.batchFor(SIMPLE, line);
const factor = sy.lineOunces(line)! / 12; // 1.5 cups is 12 oz
check("The batch scales the recipe to the Shopping list amount", !!b.batch && b.batch.ingredients[0] === `${sy.amountText(factor)} cup sugar` && b.batch.makes === `${sy.amountText(1.5 * factor)} cups` && b.batch.from.startsWith("Simple syrup — 4 x 1 liter bottles, about 135"), JSON.stringify(b));
check("No line, no batch, and it says why", sy.batchFor(SIMPLE, null).batch === null && sy.batchFor(SIMPLE, null).note.includes("No line"));
check("A yield that is not a volume gives no batch", sy.batchFor({ ...SIMPLE, yieldUnit: "jars" }, line).batch === null);

// ----- Views -----
const views = sy.syrupViews({ drinks, library: [SIMPLE], lines: [line, { name: "Honey syrup", quantity: "2 bottles", size: "1 liter", text: "Honey syrup — 2 x 1 liter bottles", store: "sams" }], storeName: (id) => (id === "sams" ? "Sam's Club delivery" : "") });
const simple = views.find((v) => v.name === "Simple syrup")!;
const honey = views.find((v) => v.name === "Honey syrup")!;
check("A syrup with a recipe: ingredients, ratio, method, yield, shelf life and the batch", simple.status === "recipe" && simple.recipe!.ingredients.join() === "1 cup sugar,1 cup water" && simple.recipe!.ratio === SIMPLE.ratio && simple.recipe!.method === SIMPLE.method && simple.recipe!.yield === "1.5 cups" && simple.recipe!.shelfLife === SIMPLE.shelfLife && !!simple.batch);
check("A syrup with a store on its line is Store bought, no recipe", honey.status === "store" && honey.storeName === "Sam's Club delivery" && honey.recipe === null && honey.batch === null);
check("Recipe needed links to add it, with the name filled in", sy.addRecipeHref("Honey syrup") === "/team/admin/syrups?add=Honey%20syrup");
const edited = sy.syrupViews({ drinks, library: [SIMPLE], lines: [line], storeName: () => "", edits: { "simple-syrup": { ingredients: [{ amount: 2, unit: "cups", item: "sugar" }, { amount: 1, unit: "cup", item: "water" }], ratio: "2:1 rich", method: "Stir.", yieldAmount: 2, yieldUnit: "cups", shelfLife: "1 month", by: "Isabel" } } })[0];
check("This event's edit is shown instead of the library's", edited.edited && edited.editedBy === "Isabel" && edited.recipe!.ratio === "2:1 rich" && edited.recipe!.ingredients[0] === "2 cups sugar");

// ----- Bought, never made -----
const MAPLE = { id: "r9", name: "Maple syrup", aliases: ["maple"], ingredients: [], ratio: "", method: "", yieldAmount: null, yieldUnit: "", shelfLife: "", bought: true };
const mapleDrinks = [{ name: "Maple Old Fashioned", ingredients: ["2 oz bourbon", "0.25 oz maple syrup"] }];
const noStore = sy.syrupViews({ drinks: mapleDrinks, library: [MAPLE], lines: [{ name: "Maple syrup", quantity: "1 bottle", size: "1 liter", text: "Maple syrup — 1 x 1 liter bottle", store: null }], storeName: () => "" })[0];
check("Bought, never made is Store bought with no store set on its line", noStore.status === "store" && noStore.storeName === null && noStore.recipe === null && noStore.batch === null && noStore.libraryId === "r9");
const noLine = sy.syrupViews({ drinks: mapleDrinks, library: [MAPLE], lines: [], storeName: () => "" })[0];
check("Bought, never made is Store bought with no Shopping list line at all", noLine.status === "store" && noLine.recipe === null);
const withStore = sy.syrupViews({ drinks: mapleDrinks, library: [MAPLE], lines: [{ name: "Maple syrup", quantity: "1 bottle", size: "1 liter", text: "Maple syrup", store: "sams" }], storeName: () => "Sam's Club delivery" })[0];
check("Bought, never made with a store set names the store", withStore.status === "store" && withStore.storeName === "Sam's Club delivery");
check("Bought, never made is never Recipe needed, and an event edit on it is ignored", sy.syrupViews({ drinks: mapleDrinks, library: [MAPLE], lines: [], storeName: () => "", edits: { "maple-syrup": { ingredients: [{ amount: 1, unit: "cup", item: "maple" }] } } }).every((v) => v.status === "store" && !v.edited));
check("Store bought on screen says no recipe needed", src("app/team/syrup-recipes.tsx").includes('if (s.status === "store")') && src("app/team/syrup-recipes.tsx").includes("No recipe needed."));
const cleanBought = sy.cleanSyrupRecipe({ name: "Maple syrup", bought: true });
check("A bought entry needs only a name, no ingredients", cleanBought.ok && cleanBought.value.bought === true && cleanBought.value.ingredients.length === 0);
check("A recipe that is not bought still needs an ingredient", !sy.cleanSyrupRecipe({ name: "Maple syrup", bought: false }).ok && sy.cleanSyrupRecipe({ name: "Simple syrup", ingredients: "1 cup sugar" }).ok && (sy.cleanSyrupRecipe({ name: "Simple syrup", ingredients: "1 cup sugar" }) as { value: { bought: boolean } }).value.bought === false);

// ----- The library -----
for (const k of Object.keys(db)) delete db[k];
db.syrup_recipes = [];
db.staff = [admin];
const who = { id: admin.id, name: "Isabel" };
check("A recipe needs a name and an ingredient", !(await sydb.saveSyrup(who, { name: "", ingredients: "1 cup sugar" })).ok && !(await sydb.saveSyrup(who, { name: "Simple syrup", ingredients: "" })).ok);
const saved = await sydb.saveSyrup(who, { name: "Simple syrup", aliases: "simple, 1:1 simple syrup", ingredients: "1 cup sugar\n1 cup water", ratio: "1:1 sugar to water", method: "Stir until clear.", yieldAmount: "1.5", yieldUnit: "cups", shelfLife: "2 weeks" });
check("An admin adds a recipe: name, aliases, ingredients, ratio, method, yield, shelf life", saved.ok && saved.syrups.length === 1 && saved.syrups[0].aliases.join() === "simple,1:1 simple syrup" && saved.syrups[0].ingredients[0].amount === 1 && saved.syrups[0].yieldAmount === 1.5 && saved.syrups[0].updatedBy === "Isabel", JSON.stringify(saved));
check("A name another recipe answers to is refused", !(await sydb.saveSyrup(who, { name: "Rich simple", aliases: "simple", ingredients: "2 cups sugar" })).ok);
const libId = (saved.ok ? saved.syrups[0].id : "") as string;
const edit2 = await sydb.saveSyrup(who, { id: libId, name: "Simple syrup", aliases: "simple", ingredients: "1 cup sugar\n1 cup water", ratio: "1:1", method: "Stir.", yieldAmount: "1.5", yieldUnit: "cups", shelfLife: "" });
check("An admin edits a recipe", edit2.ok && edit2.syrups.length === 1 && edit2.syrups[0].ratio === "1:1");

const marked = await sydb.saveSyrup(who, { name: "Honey syrup", bought: true });
check("One tap Mark as bought, never made saves the name alone", marked.ok && marked.syrups.find((r) => r.name === "Honey syrup")?.bought === true && marked.syrups.find((r) => r.name === "Simple syrup")?.bought === false, JSON.stringify(marked));
check("The bought flag is stored in its column", db.syrup_recipes.find((r) => r.name === "Honey syrup")?.bought === true);
const unmark = await sydb.saveSyrup(who, { id: (marked.ok ? marked.syrups.find((r) => r.name === "Honey syrup")!.id : "") as string, name: "Honey syrup", bought: false });
check("Unmarking it without a recipe is refused", !unmark.ok);

// ----- On the Shopping list, for one event -----
db.sessions = [
  {
    id: "s1",
    status: "submitted",
    event_date: "December 12, 2026",
    event_data: { client_name: "Justin Reyes", event_date: "December 12, 2026", guest_count: 100, package: "Full Bar", bar_service_start: "6:00pm", bar_service_end: "10:00pm", signature_drinks: drinks.slice(0, 3).map((d) => ({ ...d, base_spirit: "vodka" })) },
  },
];
db.order_sheet_lines = [];
db.order_sheet_meta = [];
db.order_sheet_stores = [];
const sess = db.sessions[0] as never;
const view = await sheetDb.getSheetView(sess);
const vSimple = view.syrups.find((s) => s.name === "Simple syrup");
const vHoney = view.syrups.find((s) => s.name === "Honey syrup");
check("The admin Shopping list has the event's syrups; the bought one is Store bought", !!vSimple && vSimple.status === "recipe" && !!vHoney && vHoney.status === "store" && vHoney.recipe === null, JSON.stringify(view.syrups.map((s) => [s.name, s.status])));
const sheetLine = view.sheet.sections.flatMap((s) => s.lines).find((l) => sy.normalName(l.fields.name) === "simple syrup");
check("Its batch is scaled to the Shopping list's simple syrup line", !!sheetLine && (vSimple!.batch?.from.startsWith(sheetLine.text) ?? vSimple!.batchNote.includes(sheetLine.text)), JSON.stringify({ line: sheetLine?.text, batch: vSimple?.batch, note: vSimple?.batchNote }));

const per = await sheetDb.applySheetAction(sess, { id: admin.id, name: "Isabel" }, { action: "syrup", key: vSimple!.key, ingredients: "2 cups sugar\n1 cup water", ratio: "2:1 rich", method: "Stir.", yieldAmount: "2", yieldUnit: "cups", shelfLife: "1 month" });
const after = per.ok ? per.view.syrups.find((s) => s.key === vSimple!.key)! : null;
check("A per event edit overrides the recipe for this event", per.ok && after!.edited && after!.recipe!.ratio === "2:1 rich" && after!.editedBy === "Isabel");
check("And never changes the library", (await sydb.listSyrups()).find((r) => r.name === "Simple syrup")!.ratio === "1:1");
check("A per event edit is refused for a bought, never made syrup", !(await sheetDb.applySheetAction(sess, { id: admin.id, name: "Isabel" }, { action: "syrup", key: vHoney!.key, ingredients: "1 cup honey" })).ok);
await sydb.deleteSyrup(db.syrup_recipes.find((r) => r.name === "Honey syrup")!.id);
const gone = (await sheetDb.getSheetView(sess)).syrups.find((s) => s.name === "Honey syrup");
check("Removed from the library, it is Recipe needed again", gone?.status === "needed");
check("A per event edit is refused for a syrup with no library recipe", !(await sheetDb.applySheetAction(sess, { id: admin.id, name: "Isabel" }, { action: "syrup", key: vHoney!.key, ingredients: "1 cup honey" })).ok);
const back = await sheetDb.applySheetAction(sess, { id: admin.id, name: "Isabel" }, { action: "syrup", key: vSimple!.key, reset: true });
check("Reset to library", back.ok && !back.view.syrups.find((s) => s.key === vSimple!.key)!.edited);

if (sheetLine) {
  const bought = await sheetDb.applySheetAction(sess, { id: admin.id, name: "Isabel" }, { action: "store", ref: sheetLine.ref, store: "sams" });
  const sb = bought.ok ? bought.view.syrups.find((s) => s.name === "Simple syrup") : null;
  check("Setting a store on its line makes it Store bought, with no recipe", bought.ok && sb?.status === "store" && sb.recipe === null, JSON.stringify(sb));
}

const staff = await supplies.staffSupplies(sess);
check("The bartender Supplies tab gets the same syrups", JSON.stringify(staff.syrups.map((s) => [s.key, s.status])) === JSON.stringify((await sheetDb.getSheetView(sess)).syrups.map((s) => [s.key, s.status])));

// ----- Where it shows -----
const sheetUi = src("app/team/admin/e/[id]/order/order-sheet.tsx");
const article = sheetUi.slice(sheetUi.indexOf("{/* The Sheet: on screen in Sheet mode, and always the printed page. */}"), sheetUi.indexOf("{mode === \"store\" && ("));
check("On the admin Shopping list, directly after the cocktail recipes", article.indexOf("<Recipes ") > 0 && article.indexOf("<SyrupRecipes ") > article.indexOf("<Recipes ") && article.indexOf("<SyrupRecipes ") < article.indexOf("</article>"));
check("Inside the printed page (Print or save as PDF)", !/<section className="[^"]*print:hidden[^"]*" aria-label=\{SYRUP_TITLE\}/.test(sheetUi) && article.includes("<SyrupRecipes "));
const tabs = src("app/team/e/[id]/event-tabs.tsx");
check("On the bartender Supplies tab, after the drinks", tabs.indexOf("<SyrupCard syrups={syrups} />") > tabs.indexOf("{shopping.groups.map(") && tabs.indexOf("<SyrupCard") < tabs.indexOf("onClick={() => setMissingOpen(true)}"));
check("Bartenders see Recipe needed without the library link", src("app/team/syrup-recipes.tsx").includes('<SyrupBody s={s} variant="card" isAdmin={false} />'));
const clientFiles = ["app/s/shopping-list.tsx", "app/s/page.tsx", "lib/client-list.ts", "lib/client-list-db.ts", "lib/client-list-actions.ts"];
check("Never on the client's list", clientFiles.every((p) => !/syrup-recipes|lib\/syrups|SyrupView|SYRUP_TITLE/.test(src(p))));
const route = src("app/api/team/admin/syrups/route.ts");
check("The library route is admins and managers only", route.includes("getCurrentStaff()") && route.includes("isAdminRole(staff.role)") && route.includes("status: 403"));
check("The library page checks admin", src("app/team/admin/syrups/page.tsx").includes("await requireAdmin("));
const mgr = src("app/team/admin/syrups/syrup-manager.tsx");
check("The Recipe needed link opens the library with one tap Mark as bought, never made", mgr.includes("Mark as bought, never made") && /addName && draft\.name\.trim\(\)/.test(mgr) && /action: "save", name: draft\.name, aliases: draft\.aliases, bought: true/.test(mgr));
check("The library form has the Bought, never made checkbox and hides the recipe fields when checked", mgr.includes("checked={draft.bought}") && mgr.includes("{!draft.bought && ("));
check("The migration adds the bought column in the same file", /bought\s+boolean\s+not null default false/.test(src("supabase/migrations/20261210_syrup_recipes.sql")));
check("It is linked from the Staff settings and the Shopping list", src("app/team/admin/staff/page.tsx").includes('href="/team/admin/syrups"') && sheetUi.includes('href="/team/admin/syrups"'));

done("syrup recipes");
