// Supply costs: the catalog, the forgiving CSV import, matching the Shopping
// list, and admins only. Run: node --no-warnings scripts/test-supply-costs.mts

import { readdirSync, statSync } from "node:fs";
import { addDays, check, done, event, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const sc = await import("../lib/team/supply-costs.ts");
const scDb = await import("../lib/team/supply-costs-db.ts");
const bizDb = await import("../lib/team/business-db.ts");
const sheetDb = await import("../lib/order-sheet-db.ts");

// ----- CSV -----
check("Quotes, commas inside quotes, doubled quotes", JSON.stringify(sc.parseCsv('a,b\n"Lime, fresh","say ""hi"""\n')) === JSON.stringify([["a", "b"], ["Lime, fresh", 'say "hi"']]));
check("CRLF, a BOM, and blank lines", JSON.stringify(sc.parseCsv("﻿a,b\r\n1,2\r\n\r\n")) === JSON.stringify([["a", "b"], ["1", "2"]]));
check("Tab separated works too", JSON.stringify(sc.parseCsv("Item\tPrice\nLimes\t3.50\n")) === JSON.stringify([["Item", "Price"], ["Limes", "3.50"]]));
check("Prices read with $ and commas", sc.priceCents("$1,299.50") === 129950 && sc.priceCents("12") === 1200 && sc.priceCents("abc") === null && sc.priceCents("") === null);

const sheet = "Store,Price,Item Name,Brand,Size\nCostco,$24.99,Tito's Vodka,Tito's,1.75 L\nWalmart,3.48,Limes,,2 lb bag\nSam's,,Ginger beer,Goslings,12 oz\n,9.99,,,\n";
const p = sc.previewImport(sheet);
check("Headers in any order and with other names", p.columns.product === "Item Name" && p.columns.cost === "Price" && p.columns.store === "Store" && p.columns.brand === "Brand" && p.columns.size === "Size", JSON.stringify(p.columns));
check("Good rows read", p.ok === 2 && p.rows[0].product === "Tito's Vodka" && p.rows[0].costCents === 2499 && p.rows[0].store === "Costco");
check("Bad rows are shown with why, not saved", p.skipped === 2 && p.rows[2].error!.startsWith("Cost") && p.rows[3].error === "No product name");
check("Google Sheets style headers", (() => { const x = sc.previewImport("Product,Brand,Size,Cost,Store\nAgave syrup,Monin,1 L,$11.25,Restaurant Depot\n"); return x.ok === 1 && x.rows[0].costCents === 1125; })());
check("Other header words: Description, Unit cost, Vendor, Also called", (() => { const x = sc.previewImport("Vendor,Unit Cost,Description,Also called\nHEB,0.79,Lemons,lemon; fresh lemons\n"); return x.ok === 1 && x.rows[0].store === "HEB" && x.rows[0].aliases.join() === "lemon,fresh lemons"; })());
check("Missing a product or cost column: nothing to save, said plainly", (() => { const x = sc.previewImport("Brand,Store\nA,B\n"); return x.missing.join() === "product,cost" && x.rows.length === 0; })());
const existing = [{ id: "c1", product: "Limes", brand: "", size: "2 lb bag", cost_cents: 300, store: "Walmart", aliases: [] }];
check("A row matching product, brand and size updates it", sc.previewImport(sheet, existing).rows[1].existingId === "c1");
check("Repeated rows are skipped", sc.previewImport("Item,Price\nLimes,1\nlimes,2\n").rows[1].error === "Repeated row");

// ----- Matching -----
const catalog = [
  { id: "v", product: "Tito's Vodka", brand: "Tito's", size: "1.75 L", cost_cents: 2499, store: "Costco", aliases: ["Vodka"] },
  { id: "l", product: "Lime", brand: "", size: "each", cost_cents: 25, store: "", aliases: [] },
  { id: "c", product: "Cups", brand: "", size: "50 pack", cost_cents: 650, store: "", aliases: ["Clear plastic cups"] },
];
const m = sc.matchLines(
  [
    { ref: "1", name: "Vodka", quantity: "3 bottles" },
    { ref: "2", name: "Limes", quantity: "40" },
    { ref: "3", name: "Clear Plastic Cups!", quantity: "2 to 3 packs" },
    { ref: "4", name: "Bitters", quantity: "1 bottle" },
    { ref: "5", name: "Lime", quantity: "a few" },
  ],
  catalog
);
check("Matched by alias", m.byRef["1"]?.catalogId === "v" && m.byRef["1"]?.cents === 7497);
check("Plurals and case do not matter", m.byRef["2"]?.catalogId === "l" && m.byRef["2"]?.cents === 1000);
check("Punctuation does not matter; a range uses the top", m.byRef["3"]?.quantity === 3 && m.byRef["3"]?.cents === 1950);
check("Unmatched lines have no cost yet", m.byRef["4"] === null && m.unmatched.includes("Bitters"));
check("No number in the quantity: no cost yet", m.byRef["5"] === null && m.unmatched.includes("Lime"));
check("The estimate is matched lines times quantity", m.cents === 7497 + 1000 + 1950);
check("Quantities", sc.quantityOf("5 bottles") === 5 && sc.quantityOf("½ case") === 0.5 && sc.quantityOf("2-3 bags") === 3 && sc.quantityOf("some") === null);

// ----- From the database -----
const today = time.todayIn("America/Chicago");
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const mgr = { id: "m1", name: "Pat Manager", phone: "+12145550101", role: "manager" as const, active: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
for (const k of Object.keys(db)) delete db[k];
db.sessions = [event("f1", addDays(today, 10), "1 Elm St, Dallas, TX", { signature_drinks: ["Margarita"] }, { team_market: "dallas", booked_price: { total: 1800, gratuity: 180, deposit_paid: 150 } })];
db.staff = [admin, mgr, b1];
db.supply_catalog = [];
for (const k of ["event_assignments", "staff_pay_rates", "staff_profiles", "assignment_mileage", "time_punches", "time_approvals", "time_edits", "time_reopens", "team_hidden_events", "team_settings", "event_finance", "event_other_costs"]) db[k] = [];

for (const body of [{ action: "add", product: "Limes", cost: "1" }, { action: "preview", csv: sheet }, { action: "import", csv: sheet }, { action: "delete", id: "x" }]) {
  const r = await scDb.catalogAction(mgr as never, body);
  check(`A manager gets 403 on catalog ${body.action}`, !r.ok && r.status === 403);
}
check("A bartender gets 403 too", !(await scDb.catalogAction(b1 as never, { action: "add", product: "Limes", cost: "1" })).ok);
check("Nothing was written", db.supply_catalog.length === 0);
check("Managers read no catalog rows", (await scDb.catalogRows(mgr as never)).length === 0);

check("An admin adds a row", (await scDb.catalogAction(admin as never, { action: "add", product: "Limes", brand: "", size: "each", cost: "$0.25", store: "Walmart", aliases: "lime; fresh limes" })).ok && db.supply_catalog.length === 1);
check("A row needs a product and a cost", !(await scDb.catalogAction(admin as never, { action: "add", product: "", cost: "1" })).ok && !(await scDb.catalogAction(admin as never, { action: "add", product: "Salt", cost: "free" })).ok);
const id = String(db.supply_catalog[0].id);
check("An admin edits a row", (await scDb.catalogAction(admin as never, { action: "update", id, product: "Limes", size: "each", cost: "0.30", aliases: "lime" })).ok && db.supply_catalog[0].cost_cents === 30);
const pv = await scDb.catalogAction(admin as never, { action: "preview", csv: sheet });
check("Preview saves nothing", pv.ok && pv.preview!.ok === 2 && db.supply_catalog.length === 1);
const im = await scDb.catalogAction(admin as never, { action: "import", csv: "Item,Size,Price\nLimes,each,0.35\nTito's Vodka,1.75 L,24.99\n" });
check("Import adds new rows and updates matching ones", im.ok && im.saved === 2 && db.supply_catalog.length === 2 && db.supply_catalog.find((r) => r.id === id)!.cost_cents === 35);
check("An admin deletes a row", (await scDb.catalogAction(admin as never, { action: "delete", id })).ok && db.supply_catalog.length === 1);

// The event's estimate from its Shopping list.
const s = db.sessions[0] as never;
const view = await sheetDb.getSheetView(s);
const lines = scDb.buyLines(view);
check("The Shopping list has lines we buy", lines.length > 3, String(lines.length));
const withQty = lines.filter((l) => sc.quantityOf(l.quantity) !== null);
const pick = withQty[0];
db.supply_catalog = [{ id: "k1", product: `${pick.name}`, brand: "", size: "", cost_cents: 1000, store: "", aliases: [] }];
check("A manager gets no supply cost", (await scDb.supplyCostFor(mgr as never, s)) === null);
const cost = (await scDb.supplyCostFor(admin as never, s))!;
check("Matched lines times quantity", cost.matched >= 1 && cost.byRef[pick.ref]?.cents === Math.round(1000 * sc.quantityOf(pick.quantity)!), JSON.stringify(cost.byRef[pick.ref]));
check("Every other line is listed as No cost yet", cost.unmatched.length === lines.length - cost.matched);
check("The client's own lines are never costed", view.sheet.sections.flatMap((x) => x.lines).filter((l) => l.clientBuys).every((l) => !(l.ref in cost.byRef)));
const biz = (await bizDb.eventBusinessFor(admin as never, s))!;
check("Partly costed with no per guest estimate: the Business tab asks for one", biz.business.supplies === "missing" && biz.business.costs.find((c) => c.key === "supplies")!.cents === null && biz.supplies?.unmatched.length === cost.unmatched.length);
db.team_settings = [...(db.team_settings ?? []), { key: "business_supplies_per_guest", value: { full: 200 } }];
const biz2 = (await bizDb.eventBusinessFor(admin as never, s))!;
const share = Math.round((200 * 80 * (cost.lines - cost.matched)) / cost.lines);
check("The Business tab uses the catalog for costed lines and the per guest share for the rest", biz2.business.supplies === "partial" && biz2.business.costs.find((c) => c.key === "supplies")!.cents === cost.cents + share && biz2.business.costs.find((c) => c.key === "supplies")!.note === `${cost.matched} of ${cost.lines} items costed, rest estimated`);
check("A manual amount wins over the catalog", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "supplies", amount: "50" })).ok && (await bizDb.eventBusinessFor(admin as never, s))!.business.costs.find((c) => c.key === "supplies")!.cents === 5000);

// ----- Never to managers, staff, or clients (source checks) -----
function files(dir: string): string[] {
  return readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((f) => {
    const q = `${dir}/${f}`;
    return statSync(new URL(`../${q}`, import.meta.url)).isDirectory() ? files(q) : [q];
  });
}
const code = [...files("app"), ...files("lib")].filter((f) => /\.(ts|tsx)$/.test(f));
check("The catalog table is read only in the supply costs module", code.filter((f) => src(f).includes('"supply_catalog"')).join() === "lib/team/supply-costs-db.ts");
check("Every supply costs function checks for an admin first", ["catalogRows", "supplyCostFor", "catalogAction"].every((fn) => new RegExp(`export async function ${fn}\\([^\\n]*\\{\\n  if \\(!isFullAdmin\\(`).test(src("lib/team/supply-costs-db.ts"))));
check("The catalog route answers 403 to anyone but an admin", src("app/api/team/admin/business/supplies/route.ts").includes('if (!staff || !isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });'));
check("The catalog page is admins only", src("app/team/admin/business/supplies/page.tsx").includes('await requireFullAdmin("/team/admin/business/supplies")'));
check("The Shopping list tab gets costs from supplyCostFor, which is null for managers", src("app/team/admin/e/[id]/page.tsx").includes('on("order") ? sheetP.then((s) => supplyCostFor(me, session, s)).then((c) => (c && !c.catalogEmpty ? c : null)) : null'));
check("Staff and client pages never see supply costs", code.filter((f) => (f.startsWith("app/team/") && !f.startsWith("app/team/admin/")) || f.startsWith("app/s/") || f.startsWith("app/api/team/") && !f.startsWith("app/api/team/admin/")).every((f) => !/supplyCost|supply_catalog|SheetCosts|catalogRows/.test(src(f))));
check("The staff Supplies tab and the client list do not carry costs", !/cost/i.test(src("lib/client-list.ts").match(/export interface ClientList[\s\S]*?\n\}/)?.[0] ?? "") && !/supply_catalog|supplyCost/.test(src("lib/order-sheet-db.ts")));

done("supply costs");
