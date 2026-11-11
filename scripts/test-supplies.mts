// Supplies from the Shopping list, bar setup photos, the end of night wrap up,
// and what managers see on the Day of tab.
// Run: node --no-warnings scripts/test-supplies.mts

import { registerHooks } from "node:module";
import { addDays, check, done, event, src, texts, textsTo } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db } = await import("./fake-supabase.mts");
const stub = await import("./stub-next.mts");
const codes = await import("../lib/team/codes.ts");
const time = await import("../lib/team/time.ts");
const os = await import("../lib/order-sheet.ts");
const osdb = await import("../lib/order-sheet-db.ts");
const sup = await import("../lib/team/supplies.ts");
const supdb = await import("../lib/team/supplies-db.ts");
const events = await import("../lib/team/events.ts");
const wu = await import("../lib/team/wrapup.ts");
const coDb = await import("../lib/team/closeout-db.ts");
const closeout = await import("../lib/team/closeout.ts");
const bar = await import("../lib/team/bar-ready.ts");
const barDb = await import("../lib/team/bar-ready-db.ts");
const clientLists = await import("../lib/client-list.ts");
const checksRoute = await import("../app/api/team/checks/route.ts");
const missingRoute = await import("../app/api/team/missing/route.ts");
const barRoute = await import("../app/api/team/bar-ready/route.ts");
const closeoutRoute = await import("../app/api/team/closeout/route.ts");
const seenRoute = await import("../app/api/team/supplies-seen/route.ts");
const wrapRoute = await import("../app/api/team/admin/wrapup/route.ts");
const sheetRoute = await import("../app/api/team/admin/order-sheet/route.ts");

const CT = "America/Chicago";
const today = time.todayIn(CT);
const tomorrow = addDays(today, 1);
const at = (day: string, min: number) => time.zonedInstant(day, min, CT);

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const b9 = { id: "b9", name: "Riley Park", phone: "+12145550119", role: "bartender" as const, active: true }; // not on the event
const editor = { id: "a1", name: "Kenneth" };
const DRINKS = [{ name: "Paloma", base_spirit: "Tequila", ingredients: ["2 oz tequila", "4 oz grapefruit soda", "0.5 oz lime juice"], garnish: "Lime wheel" }];

function reset(day = tomorrow) {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [event("e1", day, "1 Elm St, Dallas, TX", { signature_drinks: DRINKS }, { team_market: "dallas", team_market_source: "auto" })];
  db.staff = [admin, b1, b2, b9].map((s) => ({ ...s, markets: ["dallas"] }));
  db.event_assignments = [
    { id: "as1", session_id: "e1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "e1", staff_id: "b2", status: "accepted" },
  ];
  for (const t of ["order_sheet_lines", "order_sheet_meta", "staff_checks", "staff_supply_views", "missing_reports", "bar_ready_reports", "event_closeouts", "event_closeout_versions", "team_notices", "time_punches", "staff_sessions", "staff_confirmations"]) db[t] = [];
  texts.length = 0;
}
const session = () => db.sessions[0] as never as Parameters<typeof events.eventPageData>[0];
const list = async () => (await supdb.staffSupplies(session())).list;
const act = (body: Record<string, unknown>) => osdb.applySheetAction(session(), editor, body);

// ===== Part 1: the Supplies tab reads the admin Shopping list =====
reset();
const before = await list();
const edBefore = JSON.stringify(db.sessions[0].event_data);
const clientBefore = JSON.stringify(clientLists.clientList((db.sessions[0] as { event_data: Record<string, unknown> }).event_data));
const firstLine = before.supplies[0];
const second = before.supplies[1];
check("The bartender list has the two groups: supplies and the client's alcohol", before.supplies.length > 3 && before.alcohol.length > 0, `${before.supplies.length} supplies, ${before.alcohol.length} alcohol`);
check("Each line is keyed by its Shopping list line", allRefs(before));
function allRefs(l: typeof before) {
  return sup.allSupplies(l).every((i) => /^(k|i):/.test(i.key));
}

await events.saveCheck(session(), b1, "shopping", firstLine.key, true);
await events.saveCheck(session(), b1, "shopping", second.key, true);
const page1 = await events.eventPageData(session(), b1);
check("First open: no Updated note", page1.supplyUpdates.length === 0);
check("Checked lines show checked", page1.shoppingState[firstLine.key].checked && page1.shoppingState[second.key].checked);

const renamed = await act({ action: "edit", ref: firstLine.key, field: "name", value: "Simple syrup" });
const added = await act({ action: "add", section: "mixers", name: "Agave nectar", quantity: "2 bottles", size: "", detail: "" });
check("The admin rename and the added line save", renamed.ok && added.ok);
const page2 = await events.eventPageData(session(), b1);
const all2 = sup.allSupplies(page2.shopping);
const renamedItem = all2.find((i) => i.key === firstLine.key);
const agave = all2.find((i) => i.item === "Agave nectar");
check("An admin rename shows on the bartender Supplies tab", renamedItem?.item === "Simple syrup", renamedItem?.item);
check("An added line shows on the bartender Supplies tab", !!agave && agave.quantity === "2 bottles");
check("The check mark survives the rename", page2.shoppingState[firstLine.key]?.checked === true);
check("An added line starts unchecked", !!agave && page2.shoppingState[agave.key]?.checked === false);
check("Updated says what changed", page2.supplyUpdates.includes(`${firstLine.item} is now Simple syrup`) && page2.supplyUpdates.includes("Added Agave nectar (2 bottles)"), page2.supplyUpdates.join(" | "));

await act({ action: "edit", ref: firstLine.key, field: "quantity", value: "9 bottles" });
const page3 = await events.eventPageData(session(), b1);
const q3 = sup.allSupplies(page3.shopping).find((i) => i.key === firstLine.key)?.quantity ?? "";
check("A new amount shows, and the check stays on the line", /^9 (x .+ )?bottles/.test(q3) && q3 !== firstLine.quantity && page3.shoppingState[firstLine.key].checked, `${firstLine.quantity} -> ${q3}`);
await act({ action: "remove", ref: second.key });
const page4 = await events.eventPageData(session(), b1);
const p4 = Object.values(page4.shoppingState);
check("A removed line leaves the list and takes its check with it", !sup.allSupplies(page4.shopping).some((i) => i.key === second.key) && !(second.key in page4.shoppingState));
check("The x of y checked count follows", p4.filter((s) => s.checked).length === 1 && p4.length === sup.allSupplies(page4.shopping).length);
check("Updated lists the removal", page4.supplyUpdates.includes(`Removed ${second.item}`));
await act({ action: "store", ref: agave!.key, store: "walmart" });
await act({ action: "ordered", ref: agave!.key, on: true });
const bartenderJson = JSON.stringify({ shopping: page4.shopping, state: page4.shoppingState, updates: page4.supplyUpdates });
check("Bartenders never see stores, highlights, Ordered checks or who edited", !/walmart|highlight|ordered|editedBy|Kenneth|store/i.test(JSON.stringify((await events.eventPageData(session(), b1)).shopping)) && !/Kenneth/.test(bartenderJson));
check("The client's list does not change", JSON.stringify(clientLists.clientList((db.sessions[0] as { event_data: Record<string, unknown> }).event_data)) === clientBefore);
check("The event and its calculation do not change", JSON.stringify(db.sessions[0].event_data) === edBefore && db.sessions[0].version === 1);

await supdb.markSuppliesSeen("b1", "e1", await list());
check("Got it clears the Updated note", (await events.eventPageData(session(), b1)).supplyUpdates.length === 0);
const fresh = await events.eventPageData(session(), b2);
check("Someone opening it for the first time gets no note", fresh.supplyUpdates.length === 0);

// A check mark saved before the list came from the Shopping list carries over by name.
const third = before.supplies[2];
db.staff_checks.push({ staff_id: "b2", session_id: "e1", list: "shopping", item_key: sup.legacyKey("supplies", third.item), checked: true, quantity: third.quantity, updated_at: new Date().toISOString() });
check("An older check saved by item name carries over", (await events.eventPageData(session(), b2)).shoppingState[third.key]?.checked === true);
check("Checks are saved against the line, and an unknown line is refused", (await events.saveCheck(session(), b2, "shopping", third.key, true)) && !(await events.saveCheck(session(), b2, "shopping", "supplies:honey syrup", true)));

// The update text inside 48 hours, once the edits settle.
check("An edit inside 48 hours is marked for the update text", !!db.order_sheet_meta[0]?.staff_list_pending_at && Array.isArray(db.order_sheet_meta[0]?.staff_list_sent));
texts.length = 0;
check("No text while the edits are still coming", (await supdb.sendSupplyNotices(new Date())) === 0 && texts.length === 0);
const sentN = await supdb.sendSupplyNotices(new Date(Date.now() + 6 * 60_000));
check("Once they settle, each assigned person gets the update text", sentN === 2 && textsTo(b1).length === 1 && textsTo(b2).length === 1 && textsTo(b9).length === 0, JSON.stringify(texts));
const msg = textsTo(b1)[0]?.message ?? "";
check("The text is the usual update text with what changed on the supplies list", msg.includes("was updated.") && msg.includes("Supplies list:") && msg.includes("is now Simple syrup") && msg.includes("/team/e/e1"), msg);
check("Only one text for the burst", (await supdb.sendSupplyNotices(new Date(Date.now() + 20 * 60_000))) === 0);
reset(addDays(today, 5));
const far = (await list()).supplies[0];
await act({ action: "edit", ref: far.key, field: "name", value: "Simple syrup" });
check("An edit 5 days out texts nobody", !db.order_sheet_meta.some((m) => m.staff_list_pending_at) && (await supdb.sendSupplyNotices(new Date(Date.now() + 6 * 60_000))) === 0);
check("Inside 48 hours of service and until it ends", sup.inNoticeWindow(at(tomorrow, 18 * 60), at(tomorrow, 22 * 60), at(today, 19 * 60)) && !sup.inNoticeWindow(at(addDays(today, 3), 18 * 60), null, at(today, 12 * 60)) && !sup.inNoticeWindow(at(today, 18 * 60), at(today, 22 * 60), at(today, 22 * 60 + 1)));

// ===== Part 1.6: recipes, this event only, display only =====
reset();
const calcBefore = JSON.stringify(os.calculatedLines((db.sessions[0] as { event_data: Record<string, unknown> }).event_data));
const sheetBefore = JSON.stringify((await osdb.getSheetView(session())).sheet.sections.map((s) => s.lines.map((l) => l.text)));
const listBefore = JSON.stringify(await list());
const recipeKey = (await osdb.getSheetView(session())).recipes[0].key;
const r1 = await act({ action: "recipe", key: recipeKey, name: "Paloma Fresca", cup: "9 oz", ingredients: ["2 oz tequila", "3 oz grapefruit soda", "", "Pinch of salt"], garnish: "Salt rim" });
const v1 = (await osdb.getSheetView(session())).recipes[0];
check("A recipe edit saves for this event and is marked edited", r1.ok && v1.edited && v1.name === "Paloma Fresca" && v1.cup === "9 oz" && v1.ingredients.length === 3 && v1.garnish === "Salt rim" && v1.editedBy === "Kenneth");
const bp = await events.eventPageData(session(), b1);
check("The bartender's recipe shows the edited version", bp.view.drinks[0].name === "Paloma Fresca" && bp.view.drinks[0].cup === "9 oz" && bp.view.drinks[0].ingredients.join("|") === "2 oz tequila|3 oz grapefruit soda|Pinch of salt" && bp.view.drinks[0].garnish === "Salt rim");
check("A recipe edit changes no quantity", JSON.stringify(os.calculatedLines((db.sessions[0] as { event_data: Record<string, unknown> }).event_data)) === calcBefore && JSON.stringify((await osdb.getSheetView(session())).sheet.sections.map((s) => s.lines.map((l) => l.text))) === sheetBefore && JSON.stringify(await list()) === listBefore);
check("A recipe edit never touches the event", JSON.stringify(db.sessions[0].event_data.signature_drinks) === JSON.stringify(DRINKS));
check("A recipe needs a name", !(await act({ action: "recipe", key: recipeKey, name: " ", cup: "9 oz", ingredients: [], garnish: "" })).ok);
check("A drink not on the menu is refused", !(await act({ action: "recipe", key: "mojito", name: "Mojito" })).ok);
await act({ action: "recipe", key: recipeKey, reset: true });
const v2 = (await osdb.getSheetView(session())).recipes[0];
check("Reset to calculated", !v2.edited && v2.name === "Paloma" && v2.ingredients.length === 3 && (await events.eventPageData(session(), b1)).view.drinks[0].name === "Paloma");
check("The editor shows the reminder", os.RECIPE_EDIT_NOTE === "This does not change quantities. Update the list lines too if needed." && src("app/team/admin/e/[id]/order/order-sheet.tsx").includes("{RECIPE_EDIT_NOTE}") && src("app/team/admin/e/[id]/order/order-sheet.tsx").includes("Reset to calculated"));

// ===== Part 2: bar setup photos =====
reset(today);
const blob = () => new Blob(["x".repeat(200)], { type: "image/jpeg" });
const addPhoto = (s: typeof b1, replaces: string | null = null) =>
  barDb.submitBarReady({ session: session() as never, staff: s, photo: blob(), photoType: "image/jpeg", note: "", eventLink: "https://plan.test/team/e/e1", replaces });
await addPhoto(b1);
check("A photo uploads to the private bucket under the event and person", db.bar_ready_reports.length === 1 && String(db.bar_ready_reports[0].photo_path).startsWith("e1/b1/") && bar.BAR_PHOTO_BUCKET === "bar-photos");
check("The first photo texts the admins", textsTo(admin).length === 1);
for (let i = 0; i < 3; i++) await addPhoto(b1);
let limitErr = "";
try {
  await addPhoto(b1);
} catch (e) {
  limitErr = e instanceof Error ? e.message : String(e);
}
check("Up to 4 photos each", limitErr.includes("Up to 4 photos") && (await barDb.barReadyEntries("e1", b1))[0].photos.length === 4);
check("Only one admin text for all of them", textsTo(admin).length === 1);
const firstId = String(db.bar_ready_reports[0].id);
await addPhoto(b1, firstId);
const mine = (await barDb.barReadyEntries("e1", b1)).find((e) => e.mine)!;
check("Retake swaps one photo for a new one", mine.photos.length === 4 && !mine.photos.some((p) => p.id === firstId));
check("Somebody else cannot remove your photo", !(await barDb.removeBarPhoto("e1", b2, mine.photos[0].id)));
check("You can remove your own", (await barDb.removeBarPhoto("e1", b1, mine.photos[0].id)) && (await barDb.barReadyEntries("e1", b1))[0].photos.length === 3);
check("Removed photos stay in storage but stop showing", db.bar_ready_reports.length === 5 && db.bar_ready_reports.filter((r) => r.removed_at).length === 2);
check("Each photo shows its time taken and who took it", (await barDb.barReadyEntries("e1", admin))[0].staffFirstName === "Jordan" && !!mine.photos[0].createdAt);
const edToday = (db.sessions[0] as { event_data: Record<string, unknown> }).event_data;
check("Photos open at arrival and close when the event ends", !bar.barPhotosOpen(edToday, at(today, 15 * 60)) && bar.barPhotosOpen(edToday, at(today, 16 * 60)) && bar.barPhotosOpen(edToday, at(today, 21 * 60 + 59)) && !bar.barPhotosOpen(edToday, at(today, 22 * 60)));
check("Only admins and staff assigned to the event can see them", bar.canViewBarPhotos(b1, { status: "accepted" }) && bar.canViewBarPhotos(admin, null) && !bar.canViewBarPhotos(b9, null) && !bar.canViewBarPhotos(b9, { status: "declined" }) && !bar.canViewBarPhotos(null, { status: "accepted" }));
check("Photos are shown through short lived links", bar.SIGNED_URL_SECONDS <= 60 * 60 && src("lib/team/bar-ready-db.ts").includes("createSignedUrls(paths, SIGNED_URL_SECONDS)"));
check("No photo after service starts: the gentle reminder and the manager flag", bar.barPhotoMissing(edToday, at(today, 18 * 60), 0) && !bar.barPhotoMissing(edToday, at(today, 17 * 60 + 59), 0) && !bar.barPhotoMissing(edToday, at(today, 18 * 60 + 5), 1));
check("A photo is never required to clock in", !src("app/api/team/punch/route.ts").includes("bar_ready") && !src("lib/team/clock-db.ts").includes("bar_ready_reports\").select(\"id\").eq(\"staff_id\""));
const tabsSrc = src("app/team/e/[id]/event-tabs.tsx");
check("The Bar setup photo card is at the top of the Checklist tab", tabsSrc.indexOf('<div hidden={tab !== "checklist"}') < tabsSrc.indexOf("<BarReadyCard") && tabsSrc.indexOf("<BarReadyCard") < tabsSrc.indexOf("<Checklist\n"));
check("One big Take or upload photo button that offers the camera or the library", bar.BAR_PHOTO_BUTTON === "Take or upload photo" && src("app/team/e/[id]/bar-ready.tsx").includes('<input ref={pickRef} type="file" accept="image/*" onChange={pick} className="hidden" />'));
check("Managers see the photos on Day of, tappable to full size with who and when", src("app/team/admin/e/[id]/page.tsx").includes("<BarReadyCard sessionId={id} canSubmit={false} isAdmin") && src("app/team/e/[id]/bar-ready.tsx").includes("{photo.who}, {timeLabel(photo.createdAt"));

// ===== Part 3: the wrap up =====
reset(today);
const s3 = session();
const st = await coDb.closeoutState(s3 as never, b1, at(today, 18 * 60));
const gear = closeout.companyGear();
check("The Wrap up opens once bar service has started", !(await coDb.closeoutState(s3 as never, b1, at(today, 17 * 60 + 59))).open && st.open && st.canSubmit);
check("The inventory lists what The Mix Fix provided, from the same list, in the same order", st.items.length > 0 && JSON.stringify(st.items.map((i) => i.key)) === JSON.stringify((await list()).supplies.filter((i) => i.mixFix).map((i) => i.key)));
check("Unopened counts: 4 bottles is 4, 2 to 3 bags is 3, a half gallon is 1", sup.maxCount("4 bottles") === 4 && sup.maxCount("2 to 3 bags") === 3 && sup.maxCount("1/2 gallon") === 1 && sup.maxCount("") === 1);
check("The counter starts at 1, never below 1 or above what was provided", wu.clampCount(undefined, 3) === 1 && wu.clampCount(0, 3) === 1 && wu.clampCount(2, 3) === 2 && wu.clampCount(9, 3) === 3);
check("Mark all used up sets every item", Object.values(wu.markAllUsed(st.items)).every((a) => a.state === "used") && Object.keys(wu.markAllUsed(st.items)).length === st.items.length);
const used = Object.fromEntries(st.items.map((i) => [i.key, { state: "used" }]));
const returned = Object.fromEntries(gear.map((g) => [g, { state: "returned" }]));
const base = { items: st.items, gear, clientAlcohol: true };
check("Every supply needs one of the three choices", !wu.validateInventory({ supplies: { ...used, [st.items[0].key]: {} }, equipment: returned, alcoholLeft: "yes" }, base).ok);
check("Unopened cannot go above the quantity provided", !wu.validateInventory({ supplies: { ...used, [st.items[0].key]: { state: "unopened", count: st.items[0].max + 1 } }, equipment: returned, alcoholLeft: "yes" }, base).ok);
const okInv = wu.validateInventory({ supplies: JSON.stringify({ ...used, [st.items[0].key]: { state: "unopened", count: 1 } }), equipment: JSON.stringify(returned), alcoholLeft: "yes" }, base);
check("A complete inventory passes, sent as the form sends it", okInv.ok && okInv.value.supplies[0].state === "unopened" && okInv.value.supplies[0].count === 1);
check("Missing needs a note", !wu.validateInventory({ supplies: used, equipment: { ...returned, [gear[0]]: { state: "missing", note: " " } }, alcoholLeft: "yes" }, base).ok);
check("Damaged needs a note", !wu.validateInventory({ supplies: used, equipment: { ...returned, [gear[1]]: { state: "damaged" } }, alcoholLeft: "yes" }, base).ok);
check("Missing with a note passes", wu.validateInventory({ supplies: used, equipment: { ...returned, [gear[0]]: { state: "missing", note: "Left at the venue" } }, alcoholLeft: "yes" }, base).ok);
check("Every piece of equipment needs an answer", !wu.validateInventory({ supplies: used, equipment: {}, alcoholLeft: "yes" }, base).ok);
check("The alcohol question: Yes or No, and a note on No", !wu.validateInventory({ supplies: used, equipment: returned }, base).ok && !wu.validateInventory({ supplies: used, equipment: returned, alcoholLeft: "no" }, base).ok && wu.validateInventory({ supplies: used, equipment: returned, alcoholLeft: "no", alcoholNote: "Took it back to the office" }, base).ok);

const photo = () => new Blob(["x".repeat(100)], { type: "image/jpeg" });
const unopenedItem = st.items.find((i) => i.max >= 2) ?? st.items[0];
const opened = st.items.find((i) => i.key !== unopenedItem.key)!;
const wrapRaw = {
  rating: "great",
  guests: "80",
  issues: "Great crowd",
  supplies: JSON.stringify({ ...used, [unopenedItem.key]: { state: "unopened", count: Math.min(2, unopenedItem.max) }, [opened.key]: { state: "opened" } }),
  equipment: JSON.stringify({ ...returned, [gear[0]]: { state: "damaged", note: "Cracked frame" }, [gear[1]]: { state: "missing", note: "Not in the van" } }),
  alcoholLeft: "no",
  alcoholNote: "Host asked us to take it",
};
const sent = await coDb.submitCloseout({ sessionId: "e1", staff: b1, raw: wrapRaw, photo: photo(), photoType: "image/jpeg", equipmentPhotos: { [gear[0]]: photo() }, now: at(today, 22 * 60 + 15) });
check("Submit wrap up saves the closeout and the inventory together", sent.ok && db.event_closeouts.length === 1 && Array.isArray(db.event_closeouts[0].supplies) && db.event_closeouts[0].alcohol_left === false, sent.ok ? "" : sent.error);
check("An equipment photo is stored in the private bucket", String((db.event_closeouts[0].equipment as { item: string; photoPath: string }[]).find((e) => e.item === gear[0])?.photoPath).startsWith("closeout/e1/b1/"));
check("Missing or damaged gear still alerts the office", textsTo(admin).some((t) => t.message.includes(gear[0])));
const noNote = await coDb.submitCloseout({ sessionId: "e1", staff: b2, raw: { ...wrapRaw, equipment: JSON.stringify({ ...returned, [gear[0]]: { state: "damaged" } }) }, photo: photo(), photoType: "image/jpeg", now: at(today, 22 * 60 + 15) });
check("The server refuses Damaged without a note", !noNote.ok && noNote.status === 400);
const tooMany = await coDb.submitCloseout({ sessionId: "e1", staff: b2, raw: { ...wrapRaw, supplies: JSON.stringify({ ...used, [unopenedItem.key]: { state: "unopened", count: 999 } }) }, photo: photo(), photoType: "image/jpeg", now: at(today, 22 * 60 + 15) });
check("The server refuses a count above what was provided", !tooMany.ok && tooMany.status === 400);

const view = (await coDb.closeoutsFor("e1"))[0];
const s = view.summary;
check("Manager summary, first: Missing or Damaged with notes", s.problems.length === 2 && s.problems[0].note === "Cracked frame" && s.problems.some((p) => p.state === "missing"));
check("Second: Unopened, can be reused, with item, size and count", s.unopened.length === 1 && s.unopened[0].item === unopenedItem.item && s.unopened[0].size === unopenedItem.size && s.unopened[0].count === Math.min(2, unopenedItem.max));
check("Third: Opened, some left, by name", s.opened.length === 1 && s.opened[0] === opened.item);
check("Last: Used up", s.used.length === st.items.length - 2);
check("Then the alcohol answer", s.alcohol === "Not left with the client: Host asked us to take it");
check("The summary keys come in reading order", JSON.stringify(Object.keys(s)) === JSON.stringify(["problems", "unopened", "opened", "used", "alcohol"]));
const sumSrc = src("app/team/e/[id]/closeout-card.tsx");
const o = (t: string) => sumSrc.indexOf(t, sumSrc.indexOf("export function CloseoutSummary"));
check("On screen: problems in red, then reusable, then opened, then Used up collapsed, then the alcohol and note", o("Missing or damaged") < o("Unopened, can be reused") && o("Unopened, can be reused") < o("Opened, some left") && o("Opened, some left") < o("Used up (") && o("Used up (") < o("Client alcohol:") && o("Client alcohol:") < o("Note: {c.issues}") && sumSrc.includes("text-[#A0412D]") && !/<details open/.test(sumSrc));
check("Who submitted and when, and Mark reviewed for managers", sumSrc.includes("Sent by {c.staffFirstName}") && src("app/team/admin/e/[id]/closeouts.tsx").includes("Mark reviewed"));
const edit = await coDb.submitCloseout({ sessionId: "e1", staff: b1, raw: { ...wrapRaw, issues: "Great crowd, one cracked frame" }, photo: null, photoType: "", now: at(today, 23 * 60) });
check("Editable until reviewed, keeping the photos", edit.ok && db.event_closeouts[0].issues === "Great crowd, one cracked frame" && String((db.event_closeouts[0].equipment as { item: string; photoPath: string }[]).find((e) => e.item === gear[0])?.photoPath).startsWith("closeout/"));
await coDb.markReviewed("e1", String(db.event_closeouts[0].id), admin);
check("Locked once an admin marks it reviewed", !(await coDb.submitCloseout({ sessionId: "e1", staff: b1, raw: wrapRaw, photo: null, photoType: "", now: at(today, 23 * 60 + 30) })).ok);
check("Clocking out without a wrap up prompts for it", src("app/team/e/[id]/clock-card.tsx").includes("Please do your wrap up") && tabsSrc.includes('wrapUp={closeout && !wrapped ? () => setTab("wrapup") : undefined}'));
check("The reminder is in the 5 minute cron, once, 30 minutes after clock out, inside quiet hours", src("lib/team/closeout-db.ts").includes("CLOSEOUT_REMINDER_MIN * 60_000") && src("lib/team/closeout-db.ts").includes("inQuietHours(now") && src("lib/team/closeout-db.ts").includes("claimNotice(`wrapup_reminder:") && closeout.CLOSEOUT_REMINDER_MIN === 30);
check("The Wrap up tab appears once bar service has started", src("app/team/e/[id]/page.tsx").includes("closeout.open && staff.role !== \"admin\"") && tabsSrc.includes('...(closeout ? ([["wrapup", WRAP_UP_TAB]]'));

// Leftover totals.
const totals = wu.leftoverTotals([
  { sessionId: "x1", supplies: [{ key: "k:a", item: "Lime juice", size: "32 oz", amount: "", max: 4, state: "unopened", count: 2 }, { key: "k:b", item: "Ginger beer", size: "12 oz", amount: "", max: 24, state: "used", count: 0 }] },
  { sessionId: "x2", supplies: [{ key: "k:a", item: "lime  juice", size: "32 OZ", amount: "", max: 4, state: "unopened", count: 1 }, { key: "k:c", item: "Lime juice", size: "1 liter", amount: "", max: 2, state: "unopened", count: 1 }, { key: "k:d", item: "Napkins", size: "", amount: "", max: 1, state: "opened", count: 0 }] },
]);
check("Leftover totals add Unopened by item and size", totals[0].item === "Lime juice" && totals[0].size === "32 oz" && totals[0].count === 3 && totals[0].events === 2);
check("A different size is its own row, and used or opened items are not counted", totals.length === 2 && totals.some((t) => t.size === "1 liter" && t.count === 1) && !totals.some((t) => /ginger|napkin/i.test(t.item)));
db.sessions.push({ ...event("e-old", addDays(today, -60), "2 Oak St, Dallas, TX"), id: "e-old" });
db.event_closeouts.push({ id: "old", session_id: "e-old", staff_id: "b2", supplies: [{ key: "k:a", item: unopenedItem.item, size: unopenedItem.size, amount: "", max: 9, state: "unopened", count: 5 }] });
const inRange = await coDb.leftoverStock(addDays(today, -7), today);
check("The Leftover stock view totals across a date range", inRange.wrapUps === 1 && inRange.rows.find((r) => r.item === unopenedItem.item)?.count === Math.min(2, unopenedItem.max));
check("A wider range takes in older events", (await coDb.leftoverStock(addDays(today, -90), today)).rows.find((r) => r.item === unopenedItem.item)?.count === Math.min(2, unopenedItem.max) + 5);
check("The admin events list links to Leftover stock, behind requireAdmin", src("app/team/admin/events/page.tsx").includes('href="/team/admin/leftovers"') && src("app/team/admin/leftovers/page.tsx").includes("await requireAdmin("));

// ===== Part 4: what managers see on each bartender's lists =====
reset(today);
const l4 = await list();
await events.saveCheck(session(), b1, "shopping", l4.supplies[0].key, true);
await events.saveCheck(session(), b1, "checklist", "Bar mats (2)", true);
await events.recordMissing("e1", "b1", ["Lime juice"], "None in the cooler");
const lists = await events.teamLists(session(), ["b1", "b2"]);
const j = lists.get("b1")!;
check("Unchecked supplies show by name with their quantity", j.supplies.unchecked.length === sup.allSupplies(l4).length - 1 && j.supplies.unchecked.some((u) => u.label === l4.supplies[1].item && u.quantity === l4.supplies[1].quantity));
check("Checked items are listed apart, for Show checked", j.supplies.checked.length === 1 && j.supplies.checked[0].label === l4.supplies[0].item && j.checklist.checked.some((c) => c.label === "Bar mats (2)"));
check("Each list says when it was last touched", !!j.supplies.lastTouched && !!j.checklist.lastTouched);
const sam = lists.get("b2")!;
check("Not started when nothing is checked", sam.supplies.lastTouched === null && sam.checklist.lastTouched === null && sam.supplies.checked.length === 0);
const reports = await events.missingReports("e1");
check("Missing item reports carry who sent them, with the item, note and time", reports[0].staffId === "b1" && reports[0].items[0] === "Lime juice" && reports[0].note === "None in the cooler" && !!reports[0].createdAt);
const dayOf = src("app/team/admin/e/[id]/day-of.tsx");
check("Reports show at the top of each bartender's lists, in red", dayOf.indexOf("Reported missing") > 0 && dayOf.indexOf("Reported missing") < dayOf.indexOf("<ListBlock title={CHECKLIST_TITLE}") && dayOf.includes("text-[#A0412D]"));
check("Two lists per bartender: Do you have everything? and Supplies check, checked ones behind Show checked", dayOf.includes("<ListBlock title={CHECKLIST_TITLE}") && dayOf.includes("<ListBlock title={SUPPLIES_PROGRESS}") && dayOf.includes("Show checked (") && dayOf.includes('"not started"') && dayOf.includes("last checked "));
check("Bartenders see nothing new from this: the Day of tab is admin only", src("app/team/admin/e/[id]/page.tsx").indexOf("await requireAdmin(") < src("app/team/admin/e/[id]/page.tsx").indexOf("teamLists("));

// ===== The Day of tab count =====
check("Day of count: a missing report, a missing photo, unfinished lists, wrap up problems, late wrap ups", wu.dayOfCount({ missingReports: 1, photoMissing: true, listsUnfinished: 2, wrapUpProblems: 1, wrapUpsLate: 1 }) === 6 && wu.dayOfCount({ missingReports: 0, photoMissing: false, listsUnfinished: 0, wrapUpProblems: 0, wrapUpsLate: 0 }) === 0);
check("A wrap up is late 2 hours after service ends", !wu.wrapUpLate(edToday, at(today, 23 * 60 + 59)) && wu.wrapUpLate(edToday, at(today, 24 * 60)));
check("Unchecked lists count from bar service start", !wu.serviceStarted(edToday, at(today, 17 * 60 + 59)) && wu.serviceStarted(edToday, at(today, 18 * 60)));
const pageSrc = src("app/team/admin/e/[id]/page.tsx");
check("The tab count is wired from all five", pageSrc.includes("dayof: dayofCount") && ["missingReports: missing.length", "photoMissing:", "listsUnfinished: started ?", "wrapUpProblems: unreviewedProblems(closeouts)", "wrapUpsLate:"].every((p) => pageSrc.includes(p)));
check("A wrap up with problems counts until it is reviewed", coDb.unreviewedProblems([{ reviewedAt: null, inventory: { equipment: [{ item: "x", state: "missing", note: "n", photoPath: "" }] } } as never, { reviewedAt: "2026-01-01", inventory: { equipment: [{ item: "x", state: "damaged", note: "n", photoPath: "" }] } } as never]) === 1);

// ===== Part 5: the Supplies wording =====
check("The bartender tab is Supplies", sup.SUPPLIES_TAB === "Supplies" && tabsSrc.includes('["shopping", SUPPLIES_TAB]') && !tabsSrc.includes('["shopping", "Shopping"]'));
check("The page is headed Supplies for this event", sup.SUPPLIES_TITLE === "Supplies for this event" && tabsSrc.includes("{SUPPLIES_TITLE}"));
check("The manager Day of label is Supplies check", sup.SUPPLIES_PROGRESS === "Supplies check" && !dayOf.includes('label="Shopping list"'));
check("Text to staff calls it the supplies list", sup.suppliesTextLine(["Added Ice"]).startsWith("Supplies list:") && src("lib/team/cert-config.ts").includes("supplies list") && !/shopping list/i.test(src("lib/team/cert-config.ts")));
check("The manager Shopping list tab and the Client list keep their names", src("lib/team/manager-tabs.ts").includes('["order", "Shopping list"]') && src("lib/team/manager-tabs.ts").includes('["client", "Client list"]'));
check("The database keeps its names: checks are still saved to the shopping list", src("app/api/team/checks/route.ts").includes('list !== "shopping"') && src("lib/team/events.ts").includes('checkRows(staff.id, session.id, "shopping")'));
check("The SQL adds the new columns and table without renaming anything", (() => {
  const sql = src("supabase/migrations/20261128_supplies_photos_wrapup.sql");
  return sql.includes("create table if not exists public.staff_supply_views") && sql.includes("add column if not exists removed_at") && sql.includes("add column if not exists reviewed_at") && sql.includes("enable row level security") && !/rename/i.test(sql);
})());

// ===== Not assigned: refused everywhere =====
reset(today);
const signIn = (staffId: string, token: string) => {
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
};
const json = (body: unknown) => new Request("https://plan.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const form = (fields: Record<string, string | Blob>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return new Request("https://plan.test/api", { method: "POST", body: f });
};
signIn("b9", "b9-token");
const l9 = await list();
const statuses = {
  checks: (await checksRoute.POST(json({ sessionId: "e1", list: "shopping", key: l9.supplies[0].key, checked: true }))).status,
  missing: (await missingRoute.POST(json({ sessionId: "e1", keys: [l9.supplies[0].key], note: "x" }))).status,
  barPhoto: (await barRoute.POST(form({ sessionId: "e1", photo: photo() }))).status,
  barRemove: (await barRoute.POST(form({ sessionId: "e1", action: "remove", photoId: "p1" }))).status,
  wrapUp: (await closeoutRoute.POST(form({ sessionId: "e1", rating: "great", photo: photo() }))).status,
  seen: (await seenRoute.POST(json({ sessionId: "e1" }))).status,
  review: (await wrapRoute.POST(json({ sessionId: "e1", closeoutId: "c1" }))).status,
  sheet: (await sheetRoute.POST(json({ sessionId: "e1", action: "recipe", key: "paloma", name: "X" }))).status,
};
check("A bartender not on the event is refused by every route", Object.values(statuses).every((s) => s === 403), JSON.stringify(statuses));
check("Nothing was saved for them", db.staff_checks.length === 0 && db.missing_reports.length === 0 && db.bar_ready_reports.length === 0 && db.event_closeouts.length === 0 && db.staff_supply_views.length === 0 && db.order_sheet_meta.length === 0);
check("The event page and the data behind it refuse them", !(await events.openEvent("e1", b9)).ok && src("app/team/e/[id]/page.tsx").indexOf("openEvent(id, staff)") < src("app/team/e/[id]/page.tsx").indexOf("eventPageData("));
check("submitCloseout itself refuses someone not on the event", !(await coDb.submitCloseout({ sessionId: "e1", staff: b9, raw: wrapRaw, photo: photo(), photoType: "image/jpeg", now: at(today, 22 * 60) })).ok);
check("Their closeout state is empty", !(await coDb.closeoutState(session() as never, b9, at(today, 22 * 60))).open);
signIn("b1", "b1-token");
check("A bartender on the event can save a check, but never mark a wrap up reviewed", (await checksRoute.POST(json({ sessionId: "e1", list: "shopping", key: l9.supplies[0].key, checked: true }))).status === 200 && (await wrapRoute.POST(json({ sessionId: "e1", closeoutId: "c1" }))).status === 403);
stub.stubCookies.clear();
check("Signed out is 401", (await seenRoute.POST(json({ sessionId: "e1" }))).status === 401 && (await wrapRoute.POST(json({ sessionId: "e1", closeoutId: "c1" }))).status === 401);

done("supplies, photos and wrap up");
