// The order sheet: every section and item from the existing lists, edits for
// this event only, flagged conflicts, stores and highlights, the legend,
// By store, Ordered progress, status, and admin only access (the real auth,
// with cookies stubbed).
// Run: node --no-warnings scripts/test-order-sheet.mts

import { registerHooks } from "node:module";
import { addDays, check, done, hooks, src } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});
process.env.GHL_UPDATE_WEBHOOK_URL = "https://hooks.test/update";

const { db } = await import("./fake-supabase.mts");
const stub = await import("./stub-next.mts");
const os = await import("../lib/order-sheet.ts");
const shared = await import("../lib/order-sheet-shared.ts");
const stores = await import("../lib/order-sheet-stores.ts");
const storesRoute = await import("../app/api/team/admin/stores/route.ts");
const osdb = await import("../lib/order-sheet-db.ts");
const cl = await import("../lib/client-list.ts");
const cldb = await import("../lib/client-list-db.ts");
const lists = await import("../lib/shopping-list.ts");
const updates = await import("../lib/event-updates.ts");
const delivery = await import("../lib/update-delivery.ts");
const auth = await import("../lib/team/auth.ts");
const codes = await import("../lib/team/codes.ts");
const time = await import("../lib/team/time.ts");
const route = await import("../app/api/team/admin/order-sheet/route.ts");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const FAR = longDate(addDays(time.chicagoToday(), 20));

const MULE = { name: "Mule", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.5 oz lime juice", "Top with ginger beer"], garnish: "lime wheel" };
const MARG = { name: "Margarita", base_spirit: "tequila", ingredients: ["2 oz tequila", "1 oz lime juice", "0.75 oz agave"], garnish: "lime wheel" };
const MARTINI = { name: "Espresso Martini", base_spirit: "vodka", ingredients: ["2 oz vodka", "1 oz coffee liqueur", "1 oz espresso"], garnish: "coffee beans" };

function eventData(pkg: string, extra: Record<string, unknown> = {}) {
  return {
    client_name: "Alex Butler",
    email: "alex@example.com",
    event_type: "Birthday",
    event_date: FAR,
    bar_service_start: "6:00pm",
    bar_service_end: "10:00pm",
    hours_booked: 4,
    guest_count: 100,
    package: pkg,
    event_address: "123 Elm St, Dallas, TX 75201",
    signature_drinks: [MULE, MARG],
    theme: "Garden party",
    event_colors: "Sage and gold",
    ...extra,
  };
}

const admin = { id: "admin-1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true };
const bartender = { id: "bart-1", name: "Sam Lee", phone: "+12145550101", role: "bartender", active: true };
const editor = { id: admin.id, name: "Isabel" };

function session(id: string, ed: Record<string, unknown>) {
  return {
    id,
    name: "Alex Butler",
    email: "alex@example.com",
    event_date: ed.event_date,
    package_type: ed.package,
    guest_count: String(ed.guest_count),
    hours_booked: "4",
    status: "submitted",
    event_data: ed,
    version: 1,
    submitted_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    booked_price: null,
    team_market: "dallas",
  };
}

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [session("s1", eventData("Full Bar")), session("s2", eventData("Full Bar"))];
  db.event_updates = [];
  db.staff = [admin, bartender];
  db.staff_sessions = [];
  db.team_settings = [{ key: cldb.AUTO_SEND_KEY, value: true }];
  hooks.length = 0;
}

const S = (id = "s1") => db.sessions.find((s) => s.id === id) as ReturnType<typeof session>;
const view = (id = "s1") => osdb.getSheetView(S(id));
const act = async (body: Record<string, unknown>, id = "s1") => {
  const r = await osdb.applySheetAction(S(id), editor, body);
  if (!r.ok) throw new Error(`${String(body.action)}: ${r.error}`);
  return r.view;
};
const allLines = (v: Awaited<ReturnType<typeof view>>) => v.sheet.sections.flatMap((s) => s.lines);

// ----- Every section and every item -----
reset();
for (const pkg of ["Full Bar", "Tailored Bar", "Dive Bar", "Beer and Wine"]) {
  const ed = eventData(pkg, pkg === "Dive Bar" ? { signature_drinks: [] } : {});
  const calc = os.calculatedLines(ed);
  const sheet = os.buildSheet(calc, []);
  check(`${pkg}: the five sections in the samples' order`, sheet.sections.map((s) => s.title).join(" | ") === "LIQUOR | MIXERS AND JUICES | PRODUCE AND GARNISHES | ICE & BAR SUPPLIES | BASELINE MIXERS");
  check(`${pkg}: every calculated line is on the sheet exactly once`, calc.length > 0 && calc.every((c) => sheet.sections.flatMap((s) => s.lines).filter((l) => l.ref === `k:${c.key}`).length === 1) && sheet.sections.flatMap((s) => s.lines).length === calc.length);
  // Every item of the client's list and of Natalie's supply list, by name.
  const clientLines = cl.clientList(ed).sections.flatMap((s) => s.lines).map((l) => l.split(" — ")[0].trim().toLowerCase());
  const supply = cl.quietly(() => lists.generateNatalieSupplyList(ed as never));
  const supplyItems: string[] = [];
  let inOrderSection = false;
  for (const raw of supply.split(/<br\s*\/?>|\n/)) {
    const h = raw.match(/^\s*<b>([^<]+)<\/b>\s*$/);
    if (h) {
      inOrderSection = !["SPIRITS", "SIGNATURE DRINK RECIPES"].includes(h[1].trim().toUpperCase());
      continue;
    }
    const line = raw.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    if (inOrderSection && line.includes(" — ")) supplyItems.push(line.split(" — ")[0].trim().toLowerCase());
  }
  const names = sheet.sections.flatMap((s) => s.lines).map((l) => l.fields.name.toLowerCase());
  check(`${pkg}: every item the client buys is on the sheet`, clientLines.every((n) => names.includes(n)), clientLines.filter((n) => !names.includes(n)).join(", "));
  check(`${pkg}: every item we buy is on the sheet`, supplyItems.every((n) => names.includes(n)), supplyItems.filter((n) => !names.includes(n)).join(", "));
  check(`${pkg}: the client's own lines are marked and not counted as ours to order`, sheet.progress.total === calc.filter((c) => !c.clientBuys).length);
}
check("Full Bar: the client buys the liquor, we buy the mixers", (() => {
  const calc = os.calculatedLines(eventData("Full Bar"));
  return calc.filter((c) => c.section === "liquor").every((c) => c.clientBuys) && calc.some((c) => c.section === "mixers" && !c.clientBuys);
})());
check("Tailored Bar: the client buys it all", os.buildSheet(os.calculatedLines(eventData("Tailored Bar")), []).status === "nothing_to_order");

// Header and recipes like the samples.
const h = os.sheetHeader(eventData("Full Bar"));
const [hy, hm, hd] = addDays(time.chicagoToday(), 20).split("-").map(Number);
check("Header: date (package) guests, hours", h.line === `${hm}/${hd}/${String(hy).slice(2)} (Full Bar) 100 guests, 4 hours`, h.line);
check("Header: theme and colors when present", h.theme === "Garden party" && h.colors === "Sage and gold");
check("Header: no theme line when there is none", os.sheetHeader(eventData("Full Bar", { theme: "", event_colors: "" })).theme === "");
// Each line is one line of text worded like the samples, nothing empty shown, numbers unchanged.
for (const pkg of ["Full Bar", "Dive Bar", "Tailored Bar", "Premium Bar", "Bartender Only"]) {
  const lines = os.buildSheet(os.calculatedLines(eventData(pkg)), []).sections.flatMap((s) => s.lines);
  check(`${pkg}: no empty parentheses, placeholders, or trailing dash on any line`, lines.every((l) => !/\(\s*\)|— *$|—\s*—|\bsize\b|brand or note/i.test(l.text) && !l.text.includes("( ")), lines.map((l) => l.text).filter((t) => /\(\s*\)|— *$/.test(t)).join(" / "));
  check(`${pkg}: every number in the calculated fields is on the line as it was`, lines.every((l) => [l.fields.quantity, l.fields.size].join(" ").match(/\d+(?:\.\d+)?/g)?.every((n) => l.text.includes(n)) ?? true));
}
const word = (name: string, quantity: string, size: string, detail: string, section: string) => os.lineText({ name, quantity, size, detail }, section as never);
check("Wording: Lime juice — 4 x 32 oz bottles", word("Lime juice", "4 bottles", "32 oz", "", "mixers") === "Lime juice — 4 x 32 oz bottles");
check("Wording: 1 bottle (48 oz) reads 1 x 48 oz bottle", word("Lemon juice", "1 bottle", "48 oz", "", "mixers") === "Lemon juice — 1 x 48 oz bottle");
check("Wording: Limes — 24 count", word("Limes", "24 count", "", "", "produce") === "Limes — 24 count");
check("Wording: Coke — 1 case (24 pack)", word("Coke", "1 case", "24 pack", "", "baseline") === "Coke — 1 case (24 pack)");
check(
  "Wording: liquor keeps (750 ml) and the brands after a dash",
  word("Tequila reposado", "15 bottles", "750 ml", "Clase Azul Reposado or Espolòn Reposado", "liquor") === "Tequila reposado — 15 bottles (750 ml) — Clase Azul Reposado or Espolòn Reposado"
);
check("Wording: Ice — 12 x 16 lb bags (estimated for mixing only)", word("Ice", "12 bags", "16 lb", "estimated for mixing only", "ice") === "Ice — 12 x 16 lb bags (estimated for mixing only)");
check("Wording: a line with only a name shows only the name", word("Edible flowers", "", "", "", "produce") === "Edible flowers");
check("Recipes: a 9 oz martini is marked (martini)", os.recipes(eventData("Full Bar", { signature_drinks: [MARTINI, MULE] })).map((r) => r.martini).join() === "true,false");
const rs = os.recipes(eventData("Full Bar", { signature_drinks: [MULE, MARTINI] }));
check("Recipes: each drink with its cup, ingredients, and garnish", rs.length === 2 && rs[0].name === "Mule" && rs[0].ingredients.length === 3 && rs[0].garnish === "lime wheel");
check("Cup size: a drink topped with ginger beer is 12 oz", os.cupSize(MULE) === "12 oz");
check("Cup size: a martini is 9 oz", os.cupSize(MARTINI) === "9 oz");
check("Cup size: a shaken drink of 3.75 oz on ice is 12 oz", os.cupSize(MARG) === "12 oz");
check("Line wording: \"3 x 32 oz bottles\" reads 3 bottles, 32 oz", JSON.stringify(os.splitQuantity("3 x 32 oz bottles")) === JSON.stringify({ quantity: "3 bottles", size: "32 oz", extra: "" }));
check("Line wording: \"5 bottles (750 ml)\" reads 5 bottles, 750 ml", JSON.stringify(os.splitQuantity("5 bottles (750 ml)")) === JSON.stringify({ quantity: "5 bottles", size: "750 ml", extra: "" }));
check("Line wording: \"23 x Goslings ginger beer 12 oz cans\" reads 23 cans, 12 oz, Goslings ginger beer", JSON.stringify(os.splitQuantity("23 x Goslings ginger beer 12 oz cans")) === JSON.stringify({ quantity: "23 cans", size: "12 oz", extra: "Goslings ginger beer" }));
check("Line wording: anything else stays as calculated", os.splitQuantity("1 bag").quantity === "1 bag");

// ----- Edits are for this event only -----
reset();
const clientBefore = cl.clientListText(cl.clientList(S().event_data));
const calcBefore = JSON.stringify(os.calculatedLines(S().event_data));
let v = await view();
const target = allLines(v).find((l) => !l.clientBuys)!;
v = await act({ action: "edit", ref: target.ref, field: "quantity", value: "99 bottles" });
let edited = allLines(v).find((l) => l.ref === target.ref)!;
check("A line edit shows on this sheet with the edited tag", edited.fields.quantity === "99 bottles" && edited.edited.includes("quantity") && edited.editedBy === "Isabel" && !!edited.editedAt);
check("A line edit leaves the client's list as it was", cl.clientListText(cl.clientList(S().event_data)) === clientBefore);
check("A line edit leaves the calculation as it was", JSON.stringify(os.calculatedLines(S().event_data)) === calcBefore);
check("A line edit leaves the event as it was", S().version === 1 && db.event_updates.length === 0);
const other = allLines(await view("s2")).find((l) => l.ref === target.ref)!;
check("A line edit leaves other events as they were", other.fields.quantity === target.fields.quantity && other.edited.length === 0);
v = await act({ action: "edit", ref: liquorRef(v), field: "name", value: "Tito's Vodka" });
function liquorRef(x: typeof v) {
  return x.sheet.sections[0].lines[0].ref;
}
check("The client's own line can be edited on the sheet without touching the client list", cl.clientListText(cl.clientList(S().event_data)) === clientBefore && v.sheet.sections[0].lines[0].fields.name === "Tito's Vodka");
v = await act({ action: "edit", ref: target.ref, field: "quantity", value: target.fields.quantity });
edited = allLines(v).find((l) => l.ref === target.ref)!;
check("Typing the calculated value back clears the edit", edited.edited.length === 0 && !edited.editedBy);
v = await act({ action: "edit", ref: target.ref, field: "size", value: "1 gallon" });
v = await act({ action: "reset", ref: target.ref });
edited = allLines(v).find((l) => l.ref === target.ref)!;
check("Reset to calculated puts the calculated line back", edited.edited.length === 0 && edited.fields.size === target.fields.size);

v = await act({ action: "add", section: "produce", name: "Edible flowers", quantity: "2 packs", size: "", detail: "for the garnish tray" });
const added = v.sheet.sections.find((s) => s.id === "produce")!.lines.find((l) => l.fields.name === "Edible flowers");
check("Add a line to a section", !!added && added.kind === "added" && added.editedBy === "Isabel");
check("An added line is only on this event", !allLines(await view("s2")).some((l) => l.fields.name === "Edible flowers"));
v = await act({ action: "remove", ref: added!.ref });
check("Remove an added line", !allLines(v).some((l) => l.fields.name === "Edible flowers"));
const toRemove = allLines(v).find((l) => !l.clientBuys && l.ref !== target.ref)!;
v = await act({ action: "remove", ref: toRemove.ref });
check("Remove a calculated line: it leaves the sheet and can be put back", !allLines(v).some((l) => l.ref === toRemove.ref) && v.sheet.removed.some((l) => l.ref === toRemove.ref));
v = await act({ action: "restore", ref: toRemove.ref });
check("Put a removed line back", allLines(v).some((l) => l.ref === toRemove.ref) && v.sheet.removed.length === 0);
v = await act({ action: "note", note: "Ask about the ice chest" });
check("A note at the bottom, with who wrote it", v.meta.note === "Ask about the ice chest" && v.meta.noteBy === "Isabel");

// ----- An update changes a hand edited line: flagged, not overwritten -----
reset();
await cldb.completionFields("s1");
v = await view();
const mixer = allLines(v).find((l) => !l.clientBuys && /ginger beer/i.test(l.fields.name))!;
check("The sample event has a ginger beer line to edit", !!mixer);
await act({ action: "edit", ref: mixer.ref, field: "quantity", value: "40 cans" });
await act({ action: "store", ref: mixer.ref, store: "sams" });
const upd = await updates.applyEventUpdate("s1", { guest_count: 200 }, {});
await delivery.deliverEventUpdates("s1", upd!.rows, { staffOrigin: "https://plan.test" });
v = await view();
let line = allLines(v).find((l) => l.ref === mixer.ref)!;
check("After the update the calculated ginger beer changed", line.calc!.quantity !== mixer.fields.quantity, `${mixer.fields.quantity} -> ${line.calc?.quantity}`);
check("The hand edit is not overwritten", line.fields.quantity === "40 cans");
check("The change is flagged with both values", !!line.conflict && line.conflict.mine.quantity === "40 cans" && line.conflict.calc.quantity === line.calc!.quantity);
check("The store is kept when the quantity changes", line.store === "sams");
v = await act({ action: "keep", ref: mixer.ref });
line = allLines(v).find((l) => l.ref === mixer.ref)!;
check("Keep mine keeps the edit and clears the flag", line.fields.quantity === "40 cans" && !line.conflict);
const upd2 = await updates.applyEventUpdate("s1", { guest_count: 250 }, {});
await delivery.deliverEventUpdates("s1", upd2!.rows, { staffOrigin: "https://plan.test" });
line = allLines(await view()).find((l) => l.ref === mixer.ref)!;
check("A later change flags it again", !!line.conflict);
v = await act({ action: "use_new", ref: mixer.ref });
line = allLines(v).find((l) => l.ref === mixer.ref)!;
check("Use new takes the calculated value and clears the flag", line.fields.quantity === line.calc!.quantity && !line.conflict && line.edited.length === 0);
check("Use new keeps the store", line.store === "sams");
const plain = allLines(v).find((l) => !l.clientBuys && l.ref !== mixer.ref && l.edited.length === 0)!;
check("Lines nobody edited simply follow the calculation, with no flag", !plain.conflict && plain.fields.quantity === plain.calc!.quantity);

// ----- Stores, highlights, legend, counts, By store -----
reset();
v = await view();
check("No store is assigned by itself", allLines(v).every((l) => l.store === null));
check("Unset lines have no highlight", allLines(v).every((l) => l.highlight === null));
check("The legend is empty when no store is in use", v.sheet.legend.length === 0);
const ours = allLines(v).filter((l) => !l.clientBuys);
await act({ action: "store", ref: ours[0].ref, store: "walmart" });
await act({ action: "store", ref: ours[1].ref, store: "amazon" });
v = await act({ action: "store", ref: ours[2].ref, store: "specs" });
const colorOf = (ref: string) => allLines(v).find((l) => l.ref === ref)!.highlight;
const storeById = (id: string) => v.stores.find((s) => s.id === id)!;
check(
  "The store list starts with Isabel's five, in her legend order",
  v.stores.map((s) => `${s.name} ${s.color}`).join(" | ") === "Spec's pickup #FF9900 | Sam's Club delivery #00FFFF | Amazon #C000C0 | Walmart pickup #00FF00 | Delivery to event on day of #FFFF00"
);
check("Walmart pickup is green", colorOf(ours[0].ref) === "#00FF00");
check("Amazon is magenta with white text", colorOf(ours[1].ref) === "#C000C0" && allLines(v).find((l) => l.ref === ours[1].ref)!.textColor === "#FFFFFF");
check("Spec's pickup is orange with black text", colorOf(ours[2].ref) === "#FF9900" && allLines(v).find((l) => l.ref === ours[2].ref)!.textColor === "#000000");
check("Sam's Club delivery is light blue, Delivery to event on day of is yellow", storeById("sams").color === "#00FFFF" && storeById("delivery").color === "#FFFF00");
check("Every highlight matches its store", allLines(v).every((l) => (l.store ? l.highlight === storeById(l.store).color : l.highlight === null)));
check("Every palette color keeps its text readable (4.5:1 or better)", os.PALETTE.every((p) => shared.contrastOn(p.color) >= 4.5));
check("White text on dark highlights, black on light ones", shared.textOn("#1F2A6B") === "#FFFFFF" && shared.textOn("#FFFF00") === "#000000");
check("The palette has no color twice", new Set(os.PALETTE.map((p) => p.color)).size === os.PALETTE.length);
check("The legend lists only the stores in use, in list order", JSON.stringify(v.sheet.legend) === JSON.stringify(["specs", "amazon", "walmart"]));
const notSet = allLines(v).filter((l) => !l.store).length;
check("Counts at the top: each store in use, then not set", JSON.stringify(v.sheet.counts.map((c) => `${c.label} ${c.count}`)) === JSON.stringify(["Spec's pickup 1", "Amazon 1", "Walmart pickup 1", `not set ${notSet}`]));
v = await act({ action: "section_store", section: "mixers", store: "sams" });
check("Set all in this section", v.sheet.sections.find((s) => s.id === "mixers")!.lines.every((l) => l.store === "sams"));
v = await act({ action: "store", ref: ours[0].ref, store: "" });
check("Clearing a store clears its highlight", allLines(v).find((l) => l.ref === ours[0].ref)!.highlight === null || allLines(v).find((l) => l.ref === ours[0].ref)!.store === "sams");
check("A store that is not on the list is refused", !(await osdb.applySheetAction(S(), editor, { action: "store", ref: ours[3].ref, store: "costco" })).ok);
const sheetRefs = allLines(v).map((l) => l.ref).sort();
const storeRefs = v.byStore.flatMap((g) => g.lines).map((l) => l.ref).sort();
check("By store has exactly the same lines as Sheet", JSON.stringify(sheetRefs) === JSON.stringify(storeRefs));
check("By store: the stores in use, then Not set last", v.byStore.at(-1)!.title === "Not set" && v.byStore.slice(0, -1).every((g) => g.store !== null && g.lines.length > 0));
check("By store lines carry the same fields as Sheet lines", v.byStore.flatMap((g) => g.lines).every((l) => JSON.stringify(l) === JSON.stringify(allLines(v).find((x) => x.ref === l.ref))));

// Suggestions: the store an item had on an earlier event, never applied.
const s2v = await view("s2");
const sug = allLines(s2v).find((l) => l.ref === ours[1].ref)!;
check("Another event suggests the store an item was last given", sug.suggestion === allLines(v).find((l) => l.ref === ours[1].ref)!.store && sug.suggestion !== null && sug.store === null && sug.highlight === null);
check("A suggestion is never counted as a store", s2v.sheet.legend.length === 0);
db.team_settings.push({ key: cldb.SUGGEST_STORES_KEY, value: false });
check("Suggestions can be turned off", allLines(await view("s2")).every((l) => l.suggestion === null));
db.team_settings = db.team_settings.filter((r) => r.key !== cldb.SUGGEST_STORES_KEY);

// A removed line that comes back starts blank (or suggested).
reset();
await cldb.completionFields("s1");
v = await view();
const dropLine = allLines(v).find((l) => !l.clientBuys && /ginger beer/i.test(l.fields.name))!;
await act({ action: "store", ref: dropLine.ref, store: "walmart" });
const noMule = await updates.applyEventUpdate("s1", { signature_drinks: [MARG, MARTINI] }, {});
await delivery.deliverEventUpdates("s1", noMule!.rows, { staffOrigin: "https://plan.test" });
v = await view();
check("When an update drops an item nobody edited or ordered, it leaves the sheet", !allLines(v).some((l) => l.ref === dropLine.ref));
const back = await updates.applyEventUpdate("s1", { signature_drinks: [MULE, MARG] }, {});
await delivery.deliverEventUpdates("s1", back!.rows, { staffOrigin: "https://plan.test" });
v = await view();
const returned = allLines(v).find((l) => l.ref === dropLine.ref)!;
check("When it comes back it starts with no store", !!returned && returned.store === null && returned.highlight === null);

// An ordered line dropped by an update is flagged, not hidden.
await act({ action: "ordered", ref: dropLine.ref, on: true });
const drop2 = await updates.applyEventUpdate("s1", { signature_drinks: [MARG, MARTINI] }, {});
await delivery.deliverEventUpdates("s1", drop2!.rows, { staffOrigin: "https://plan.test" });
const gone = allLines(await view()).find((l) => l.ref === dropLine.ref);
check("An ordered line the update dropped stays, flagged as no longer calculated", !!gone && gone.gone && gone.ordered);

// ----- Ordered and status -----
reset();
v = await view();
const toOrder = allLines(v).filter((l) => !l.clientBuys);
check("Status: not started", v.sheet.status === "not_started" && v.sheet.progress.ordered === 0 && v.sheet.progress.total === toOrder.length);
v = await act({ action: "ordered", ref: toOrder[0].ref, on: true });
const o = allLines(v).find((l) => l.ref === toOrder[0].ref)!;
check("Ordered records who and when", o.ordered && o.orderedBy === "Isabel" && !!o.orderedAt);
check("Status: in progress, 1 of N ordered", v.sheet.status === "in_progress" && v.sheet.progress.ordered === 1);
for (const l of toOrder.slice(1)) await act({ action: "ordered", ref: l.ref, on: true });
v = await view();
check("Status: all ordered", v.sheet.status === "all_ordered" && v.sheet.progress.ordered === toOrder.length);
const statuses = await osdb.orderStatuses([S("s1"), S("s2")]);
check("The admin events list gets each event's order status", statuses.get("s1") === "all_ordered" && statuses.get("s2") === "not_started");
v = await act({ action: "ordered", ref: toOrder[0].ref, on: false });
check("Unchecking Ordered clears who and when", !allLines(v).find((l) => l.ref === toOrder[0].ref)!.orderedBy);
v = await act({ action: "store", ref: toOrder[1].ref, store: "delivery" });
check("Delivery to event on day of is a store a line can have", allLines(v).find((l) => l.ref === toOrder[1].ref)!.store === "delivery" && v.sheet.legend.includes("delivery"));
check("The old Delivery checkbox action is gone", !(await osdb.applySheetAction(S(), editor, { action: "delivery", on: true })).ok);

// ----- Stores the team manages -----
reset();
v = await view();
let mine = allLines(v).filter((l) => !l.clientBuys);
v = await act({ action: "add_store", name: "Costco pickup", color: "#E0201B", ref: mine[0].ref });
const costco = v.stores.find((s) => s.name === "Costco pickup")!;
check("Add a store from the sheet: it joins the list", !!costco && costco.color === "#E0201B" && !costco.retired && v.stores.length === 6);
let costcoLine = allLines(v).find((l) => l.ref === mine[0].ref)!;
check("The new store is set on the line it was added from, in its color", costcoLine.store === costco.id && costcoLine.highlight === "#E0201B" && costcoLine.textColor === "#FFFFFF");
check("The new store shows on the legend, the counts, and By store", v.sheet.legend.includes(costco.id) && v.sheet.counts.some((c) => c.label === "Costco pickup" && c.count === 1) && v.byStore.some((g) => g.title === "Costco pickup" && g.lines.length === 1));
let other2 = await view("s2");
check("The new store is offered on every event", other2.stores.some((s) => s.id === costco.id));
const s2Line = allLines(other2).filter((l) => !l.clientBuys)[1];
other2 = await act({ action: "store", ref: s2Line.ref, store: costco.id }, "s2");
check("Another event can use the new store", allLines(other2).find((l) => l.ref === s2Line.ref)!.store === costco.id);
v = await act({ action: "section_store", section: "ice", store: costco.id });
check("Set all in this section works with an added store", v.sheet.sections.find((s) => s.id === "ice")!.lines.every((l) => l.store === costco.id));
check("Suggestions work with an added store", allLines(await view("s2")).some((l) => l.suggestion === costco.id));

// Two stores never share a color.
let r1 = await stores.addStore({ name: "Kroger", color: "#ff9900" });
check("A new store cannot take a color already in use", !r1.ok && /already uses that color/.test(r1.ok ? "" : r1.error));
r1 = await stores.updateStore("amazon", { color: "#E0201B" });
check("A store cannot be recolored to another store's color", !r1.ok);
r1 = await stores.addStore({ name: "Kroger", color: "#123456" });
check("A color outside the palette is refused", !r1.ok);
r1 = await stores.addStore({ name: "costco PICKUP", color: "#1F4FE0" });
check("Two active stores cannot share a name", !r1.ok);
r1 = await stores.updateStore("amazon", { color: "#1F4FE0", name: "Amazon Prime" });
check("A starting store can be renamed and recolored", r1.ok && r1.stores.find((s) => s.id === "amazon")!.name === "Amazon Prime" && r1.stores.find((s) => s.id === "amazon")!.color === "#1F4FE0");
const allColors = (await stores.listStores()).map((s) => s.color);
check("No two stores share a color", new Set(allColors).size === allColors.length);
const mig = src("supabase/migrations/20261127_order_sheet_stores.sql");
check(
  "The database replaces the fixed four with a stores table, keeps every selection, and enforces one color per store",
  mig.includes("drop constraint if exists order_sheet_lines_store_check") &&
    mig.includes("references public.order_sheet_stores (id)") &&
    mig.includes("create unique index if not exists order_sheet_stores_color_idx") &&
    ["'specs'", "'sams'", "'amazon'", "'walmart'", "'delivery'"].every((id) => mig.includes(id)) &&
    !mig.includes("drop column")
);

// Reorder.
r1 = await stores.moveStore(costco.id, "up");
check("Move a store up the list", r1.ok && r1.stores.findIndex((s) => s.id === costco.id) === 4);
check("The legend follows the list order", (await view()).sheet.legend.indexOf(costco.id) < (await view()).sheet.legend.indexOf("walmart") || !(await view()).sheet.legend.includes("walmart"));

// Retire: stays on old sheets, not offered on new lines.
r1 = await stores.updateStore(costco.id, { retired: true });
check("Retire a store", r1.ok && r1.stores.find((s) => s.id === costco.id)!.retired);
v = await view();
costcoLine = allLines(v).find((l) => l.ref === mine[0].ref)!;
check("A retired store still shows on a sheet that used it", costcoLine.store === costco.id && costcoLine.highlight === "#E0201B" && v.sheet.legend.includes(costco.id));
mine = allLines(v).filter((l) => !l.clientBuys && l.store !== costco.id);
check("A retired store cannot be set on a new line", !(await osdb.applySheetAction(S(), editor, { action: "store", ref: mine[0].ref, store: costco.id })).ok);
check("A retired store cannot be set on a whole section", !(await osdb.applySheetAction(S(), editor, { action: "section_store", section: "mixers", store: costco.id })).ok);
check("A retired store is never suggested", allLines(await view("s2")).every((l) => l.suggestion !== costco.id));
check("A retired store keeps its color, so no new store can take it", !(await stores.addStore({ name: "Target", color: "#E0201B" })).ok);
r1 = await stores.updateStore(costco.id, { retired: false });
check("Bring a retired store back", r1.ok && !r1.stores.find((s) => s.id === costco.id)!.retired);

// Legend names.
v = await act({ action: "legend_name", store: "specs", name: "Taylor" });
check("A legend name shows on this event", v.meta.legendNames.specs === "Taylor");
let s2v2 = await view("s2");
check("The next event starts with the name used last", s2v2.meta.legendNames.specs === "Taylor");
s2v2 = await act({ action: "legend_name", store: "specs", name: "" }, "s2");
check("Clearing it on one event leaves the others", !s2v2.meta.legendNames.specs && (await view()).meta.legendNames.specs === "Taylor");
await act({ action: "legend_name", store: "sams", name: "Aidan" }, "s2");
check("Each store has its own name", (await view()).meta.legendNames.sams === "Aidan" && (await view()).meta.legendNames.specs === "Taylor");

// The old Delivery checkbox carries over.
reset();
db.order_sheet_meta = [{ session_id: "s1", note: "", delivery_day_of: true }];
v = await view();
check("A sheet that had Delivery ticked still shows it on the legend", v.meta.legacyDelivery && v.sheet.legend.includes("delivery"));
v = await act({ action: "clear_legacy_delivery" });
check("Clearing the old tick takes it off the legend once nothing uses it", !v.meta.legacyDelivery && !v.sheet.legend.includes("delivery"));

// The stores route is admins only.
reset();
const storePost = (body: Record<string, unknown>) => storesRoute.POST(new Request("https://plan.test/api/team/admin/stores", { method: "POST", body: JSON.stringify(body) }));
const signInAs = (staffId: string, token: string) => {
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
};
stub.stubCookies.clear();
check("Signed out: the stores route says 401", (await storePost({ action: "add", name: "Kroger", color: "#1F4FE0" })).status === 401);
signInAs("bart-1", "b-token");
check("Bartender: the stores route says 403", (await storePost({ action: "add", name: "Kroger", color: "#1F4FE0" })).status === 403 && !(db.order_sheet_stores ?? []).some((s) => s.name === "Kroger"));
signInAs("admin-1", "a-token");
stub.stubCookies.set("mf_team_view", "bartender");
check("Admin in Bartender view: the stores route says 403", (await storePost({ action: "add", name: "Kroger", color: "#1F4FE0" })).status === 403);
stub.stubCookies.delete("mf_team_view");
const added2 = await storePost({ action: "add", name: "Kroger", color: "#1F4FE0" });
check("Admin: the stores route adds a store", added2.status === 200 && (db.order_sheet_stores ?? []).some((s) => s.name === "Kroger"));
check("The Manage stores page is admins only", src("app/team/admin/stores/page.tsx").includes('await requireAdmin("/team/admin/stores")'));
stub.stubCookies.clear();

// ----- order_sheet_url in the GHL payloads -----
reset();
const first = await cldb.completionFields("s1");
check("Intake payload carries order_sheet_url", first.order_sheet_url === "https://plan.test/team/admin/e/s1/order");
const u = await updates.applyEventUpdate("s1", { parking_info: "Driveway" }, {});
await delivery.deliverEventUpdates("s1", u!.rows, { staffOrigin: "https://plan.test" });
check("Update payload carries order_sheet_url", hooks.at(-1)?.body.order_sheet_url === "https://plan.test/team/admin/e/s1/order");

// ----- Admins only -----
reset();
const post = (body: Record<string, unknown>) =>
  route.POST(new Request("https://plan.test/api/team/admin/order-sheet", { method: "POST", body: JSON.stringify(body) }));
const signIn = (staffId: string, token: string) => {
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
};
const body = { sessionId: "s1", action: "note", note: "hello" };
const redirectOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof stub.RedirectError ? e.to : String(e);
  }
};

stub.stubCookies.clear();
let res = await post(body);
check("Signed out: the order sheet route says 401", res.status === 401 && !db.order_sheet_meta?.length);
check("Signed out: the order sheet page sends you to sign in", (await redirectOf(() => auth.requireAdmin("/team/admin/e/s1/order"))) === `/team?next=${encodeURIComponent("/team/admin/e/s1/order")}`);

signIn("bart-1", "bartender-token");
res = await post(body);
check("Bartender: the order sheet route says 403", res.status === 403 && !db.order_sheet_meta?.length);
check("Bartender: the order sheet page sends them to their own events", (await redirectOf(() => auth.requireAdmin("/team/admin/e/s1/order"))) === "/team/events");

signIn("admin-1", "admin-token");
stub.stubCookies.set("mf_team_view", "bartender");
res = await post(body);
check("Admin in Bartender view: the route says 403", res.status === 403);
check("Admin in Bartender view: the page sends them away", (await redirectOf(() => auth.requireAdmin("/team/admin/e/s1/order"))) === "/team/events");

stub.stubCookies.delete("mf_team_view");
res = await post(body);
check("Admin: the route saves", res.status === 200 && db.order_sheet_meta?.[0]?.note === "hello");
check("Admin: the page opens", (await redirectOf(() => auth.requireAdmin("/team/admin/e/s1/order"))) === null);
db.staff.find((s) => s.id === "admin-1")!.active = false;
check("Deactivated staff are signed out of it", (await post(body)).status === 401);

const pageSrc = src("app/team/admin/e/[id]/order/page.tsx");
check("The order sheet link checks admin, then opens the Order sheet tab", pageSrc.indexOf("await requireAdmin(") > 0 && pageSrc.indexOf("await requireAdmin(") < pageSrc.indexOf('redirect(managerHref(id, "order"))'));
const managerSrc = src("app/team/admin/e/[id]/page.tsx");
check("The manager view checks admin before reading the sheet", managerSrc.indexOf("await requireAdmin(") > 0 && managerSrc.indexOf("await requireAdmin(") < managerSrc.indexOf("getSheetView("));
check("The Order sheet tab shows the full order sheet", managerSrc.includes("order: <OrderSheet initial={sheet}"));
const ui = src("app/team/admin/e/[id]/order/order-sheet.tsx");
check(
  "The sheet has Sheet and By store views, Print or save as PDF, Reset to calculated, Keep mine and Use new, Set all, Add a store, Manage stores",
  ["By store", "Print or save as PDF", "Reset to calculated", "Keep mine", "Use new", "Set all in this section to", "Add a store", "Manage stores", "Add a line", "client buys"].every((t) => ui.includes(t))
);
check("No controls on a line at rest: no Edit name, no store dropdown, no placeholders", !ui.includes("Edit name") && !ui.includes('placeholder="size"') && !ui.includes('placeholder="brand or note"') && !ui.includes("StoreSelect"));
check("The Delivery checkbox is gone from the sheet", !ui.includes('action: "delivery"') && !ui.includes("deliveryDayOf"));
check("The store list offers no retired store, except the one a line already has", ui.includes("stores.filter((s) => !s.retired || s.id === current)"));
check("The page is a plain white Arial page", src("app/globals.css").includes(".doc-page") && src("app/globals.css").includes("font-family: Arial"));
check("Print hides the app menus", src("app/team/team-header.tsx").includes("print:hidden"));
const eventsPage = src("app/team/admin/events/page.tsx");
check("The admin events list shows order status and has a date range filter", eventsPage.includes("orderStatuses(") && eventsPage.includes('name="from"') && eventsPage.includes('name="to"'));

done("order sheet");
