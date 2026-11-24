// The staff "Shopping list for this event" on its own Shopping list tab: the admin
// Shopping list's own lines under plain headings by source, what staff say
// they already have, the answers on the admin sheet and its badge, and the
// "list is ready" text. Real code against the in-memory database.
// Run: node --no-warnings scripts/test-staff-shopping-list.mts

import { registerHooks } from "node:module";
import { addDays, check, done, src, texts } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db, missingTables } = await import("./fake-supabase.mts");
const stub = await import("./stub-next.mts");
const codes = await import("../lib/team/codes.ts");
const time = await import("../lib/team/time.ts");
const shared = await import("../lib/order-sheet-shared.ts");
const osdb = await import("../lib/order-sheet-db.ts");
const sl = await import("../lib/team/staff-list.ts");
const sldb = await import("../lib/team/staff-list-db.ts");
const route = await import("../app/api/team/shopping-list/route.ts");
const adminRoute = await import("../app/api/team/admin/order-sheet/route.ts");

const today = time.chicagoToday();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const SOON = addDays(today, 10);
const MULE = { name: "Mule", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.5 oz lime juice", "Top with ginger beer"], garnish: "lime wheel" };
const MARG = { name: "Margarita", base_spirit: "tequila", ingredients: ["2 oz tequila", "1 oz lime juice", "0.75 oz agave"], garnish: "lime wheel" };

function ev(id: string, day: string) {
  const ed = {
    client_name: "Justin Reyes",
    client_phone: "+19725550199",
    email: "justin@example.com",
    event_type: "Birthday",
    event_date: longDate(day),
    bar_service_start: "6:00pm",
    bar_service_end: "10:00pm",
    hours_booked: 4,
    guest_count: 100,
    package: "Full Bar",
    event_address: "1 Main St, Dallas, TX 75201",
    signature_drinks: [MULE, MARG],
  };
  return { id, name: "Justin Reyes", email: "justin@example.com", event_date: ed.event_date, package_type: "Full Bar", guest_count: "100", hours_booked: "4", status: "submitted", event_data: ed, version: 1, submitted_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", booked_price: null, team_market: "dallas" };
}

const admin = { id: "a1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true };
const jayde = { id: "b1", name: "Jayde Moore", phone: "+12145550111", role: "bartender", active: true };
const marcus = { id: "b2", name: "Marcus Hill", phone: "+12145550112", role: "bar_back", active: true };
const sam = { id: "b3", name: "Sam Lee", phone: "+12145550113", role: "bartender", active: true };
const dee = { id: "b4", name: "Dee Grant", phone: "+12145550114", role: "bartender", active: true };

const STORES = [
  ...shared.DEFAULT_STORES.map((s) => ({ id: s.id, name: s.name, color: s.color, position: s.position, retired: false, last_legend_name: null, kind: null })),
  { id: "walmart-del", name: "Walmart Delivery", color: "#1F4FE0", position: 6, retired: false, last_legend_name: null, kind: null },
  { id: "mine", name: "Bring from your supply", color: "#E0201B", position: 7, retired: false, last_legend_name: null, kind: "supply" },
];

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  missingTables.clear();
  db.sessions = [ev("s1", SOON), ev("past", addDays(today, -3))];
  db.staff = [admin, jayde, marcus, sam, dee].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "x1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "s1", staff_id: "b2", status: "accepted" },
    { id: "x3", session_id: "s1", staff_id: "b3", status: "offered" },
    { id: "x4", session_id: "s1", staff_id: "b4", status: "declined" },
    { id: "x5", session_id: "past", staff_id: "b1", status: "accepted" },
  ];
  db.order_sheet_stores = STORES.map((s) => ({ ...s }));
  db.order_sheet_lines = [];
  db.order_sheet_meta = [];
  db.order_sheet_answers = [];
  db.order_sheet_ready_texts = [];
  db.team_settings = [];
  db.staff_sessions = [];
  texts.length = 0;
}

const S = (id = "s1") => db.sessions.find((s) => s.id === id) as ReturnType<typeof ev>;
const editor = { id: admin.id, name: "Isabel" };
const act = async (body: Record<string, unknown>, id = "s1") => {
  const r = await osdb.applySheetAction(S(id), editor, body);
  if (!r.ok) throw new Error(`${String(body.action)}: ${r.error}`);
  return r.view;
};
const adminLines = async (id = "s1") => (await osdb.getSheetView(S(id))).sheet.sections.flatMap((s) => s.lines);
async function signIn(staffId: string) {
  const token = `tok-${staffId}-${Math.random()}`;
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
}
const answer = async (body: Record<string, unknown>) => {
  const res = await route.POST(new Request("https://plan.test/api/team/shopping-list", { method: "POST", body: JSON.stringify({ sessionId: "s1", ...body }) }));
  return { status: res.status, body: await res.json() };
};
const viewFor = (staff: Record<string, unknown>, id = "s1", now?: Date) => sldb.staffListFor(S(id), staff as never, now);

/** Set sources: some lines to each kind, one left undecided. */
async function source() {
  const ours = (await adminLines()).filter((l) => !l.clientBuys);
  const plan = ["mine", "mine", "sams", "walmart-del", "amazon", "specs", "walmart", "mine"];
  for (const [i, store] of plan.entries()) if (ours[i]) await act({ action: "store", ref: ours[i].ref, store });
  for (const l of ours.slice(plan.length, -1)) await act({ action: "store", ref: l.ref, store: "specs" });
  return ours;
}

// ===== 1. Where it shows, and who sees it =====
reset();
// Not ready: no sources yet and no ready text sent. The tab still shows, with the plain line.
const early = await viewFor(jayde);
check("Before most lines have a source, the list is not ready (but the tab still shows)", !!early && early.ready === false);
check("Staff still see every line before it is ready, unsourced lines under Not decided yet", early!.total > 0 && sl.staffListLines(early!).length === early!.total && early!.groups.some((g: { id: string }) => g.id === "undecided"));
const tabSrc = src("app/team/e/[id]/shopping-list.tsx");
check("No not ready screen: the list always shows, with the finalizing banner until ready", !tabSrc.includes("data-not-ready") && !tabSrc.includes("LIST_NOT_READY") && tabSrc.includes("{!view.ready && (") && sl.LIST_FINALIZING === "This list is still being finalized. Items may change.");
check("Store kinds: names give pick up, delivery, or supply until an admin sets one", shared.storeKind({ name: "Spec's pickup" }) === "pickup" && shared.storeKind({ name: "Sam's Club delivery" }) === "delivery" && shared.storeKind({ name: "Amazon" }) === "delivery" && shared.storeKind({ name: "Walmart Delivery" }) === "delivery" && shared.storeKind({ name: "Bring from your supply" }) === "supply" && shared.storeKind({ name: "Amazon", kind: "pickup" }) === "pickup");
const ours = await source();
const jv = await viewFor(jayde);
const mv = await viewFor(marcus);
check("An accepted bartender sees the list", !!jv && jv.canAnswer);
check("Once most lines have a source, the list is ready", jv!.ready === true);
check("An accepted bar back sees it too (any role)", !!mv && mv.canAnswer);
check("Someone only offered the shift sees nothing", (await viewFor(sam)) === null);
check("Someone who declined sees nothing", (await viewFor(dee)) === null);
check("Someone not on the event sees nothing", (await viewFor({ id: "zz", name: "Nobody", role: "bartender" })) === null);
const preview = await viewFor({ ...admin, role: "bartender", bartenderView: true });
check("An admin in Bartender view sees it, read only", !!preview && !preview.canAnswer && preview.readOnlyNote === sl.LIST_PREVIEW);

// ===== 2. One list: line for line the admin sheet =====
const adminAll = await adminLines();
const staffAll = sl.staffListLines(jv!);
check("The staff list has exactly the admin sheet's lines", staffAll.length === adminAll.length && new Set(staffAll.map((l) => l.ref)).size === adminAll.length && adminAll.every((l) => staffAll.some((x) => x.ref === l.ref)), `${staffAll.length} vs ${adminAll.length}`);
check("...each with the same item and amount", adminAll.every((l) => { const x = staffAll.find((y) => y.ref === l.ref)!; return x.item === l.fields.name && x.quantity === shared.amountText(l.fields, l.section); }));
await act({ action: "edit", ref: ours[0].ref, field: "quantity", value: "9 bottles" });
check("An admin edit shows on the staff list right away (never a copy)", /^9\b/.test(sl.staffListLines((await viewFor(jayde))!).find((l) => l.ref === ours[0].ref)!.quantity), sl.staffListLines((await viewFor(jayde))!).find((l) => l.ref === ours[0].ref)!.quantity);
await act({ action: "remove", ref: ours.at(-1)!.ref });
check("A line the admin removes leaves the staff list too", !sl.staffListLines((await viewFor(jayde))!).some((l) => l.ref === ours.at(-1)!.ref));
await act({ action: "restore", ref: ours.at(-1)!.ref });

// ===== 3. Grouped under plain headings, with counts =====
const v = (await viewFor(jayde))!;
const titles = v.groups.map((g) => g.title);
check("Headings in order: supply, delivered, pick up, client, not decided", JSON.stringify(titles) === JSON.stringify(["Bring from your supply", "Being delivered", "Pick up", "The client is buying", "Not decided yet"]), titles.join(" | "));
const g = (id: string) => v.groups.find((x) => x.id === id)!;
check("Each heading's count is its number of lines", v.groups.every((x) => x.count === x.lines.length + x.subgroups.reduce((n, s) => n + s.lines.length, 0)) && v.groups.reduce((n, x) => n + x.count, 0) === adminAll.length);
check("Bring from your supply: the three supply lines, with its swatch", g("supply").count === 3 && g("supply").color === "#E0201B");
const delivered = g("delivery").subgroups.map((s) => s.title);
check("Being delivered: a sub heading per source (Sam's Club delivery, Amazon, Walmart Delivery), each with a swatch", JSON.stringify(delivered) === JSON.stringify(["Sam's Club delivery", "Amazon", "Walmart Delivery"]) && g("delivery").subgroups.every((s) => /^#[0-9A-F]{6}$/.test(s.color)), delivered.join(" | "));
check("Pick up: a sub heading per store", JSON.stringify(g("pickup").subgroups.map((s) => s.title)) === JSON.stringify(["Spec's pickup", "Walmart pickup"]));
check("The client is buying: the client's own lines, no buttons", g("client").count === adminAll.filter((l) => l.clientBuys).length && g("client").lines.every((l) => l.answers.length === 0 && !l.notes));
check("Not decided yet: the line with no source", g("undecided").count === 1);
const sams = ours[2];
await act({ action: "ordered", ref: sams.ref, on: true });
const v2 = (await viewFor(jayde))!;
const dLines = g("delivery").subgroups.flatMap((s) => s.lines).map((l) => sl.staffListLines(v2).find((x) => x.ref === l.ref)!);
check("Delivery lines say Ordered or Not ordered yet", dLines.find((l) => l.ref === sams.ref)!.ordered === "Ordered" && dLines.filter((l) => l.ref !== sams.ref).every((l) => l.ordered === "Not ordered yet"));
check("Other lines say nothing about ordering", sl.staffListLines(v2).filter((l) => !dLines.some((d) => d.ref === l.ref)).every((l) => l.ordered === null));

// ===== No prices, links, suppliers, or who ordered in anything staff receive =====
// Plant prices, costs, and supplier links everywhere the admin side could hold them.
db.order_sheet_lines.forEach((r) => Object.assign(r, { ordered_by_name: (r as { ordered: boolean }).ordered ? "Isabel" : null, price: 24.99, price_cents: 2499, unit_cost: 12.5, cost_cents: 1250, total_cents: 9999, supplier: "Southern Glazer's", supplier_url: "https://supplier.example/item/1", url: "https://supplier.example/x", link: "https://supplier.example/y", detail: "Titos $24.99 https://supplier.example/titos" }));
db.order_sheet_stores.forEach((st) => Object.assign(st, { url: "https://store.example", order_link: "https://store.example/order", account: "acct 4411" }));
const planted = (await viewFor(jayde))!;
const sent = JSON.stringify(v2) + JSON.stringify(planted);
const keysIn = (x: unknown): string[] => (Array.isArray(x) ? x.flatMap(keysIn) : x && typeof x === "object" ? Object.entries(x).flatMap(([k, val]) => [k, ...keysIn(val)]) : []);
check("No price, cost, total, supplier, url, or link field anywhere in the staff list", !keysIn(planted).some((k) => /price|cost|cents|total_|supplier|url|link|account|detail|brand/i.test(k)), [...new Set(keysIn(planted))].join(","));
check("The staff list's top level is only what the tab needs", Object.keys(planted).sort().join() === "canAnswer,groups,readOnlyNote,ready,sessionId,total", Object.keys(planted).sort().join());
check("The Shopping list tab's page code never shows a price or a link", !/price|cost|cents|supplier|href=|https?:/i.test(src("app/team/e/[id]/shopping-list.tsx")));
check("No price, cost, link, supplier, or who ordered in the staff list", !/\$|https?:|www\.|ordered_?by|orderedBy|Isabel|cost|price|store_item|storeBy|editedBy|Justin|Reyes|9725550199/i.test(sent), sent.slice(0, 200));
check("No brand or note field either: item and amount only", sl.staffListLines(v2).every((l) => Object.keys(l).sort().join() === "answers,item,mine,notes,ordered,quantity,ref,teammates"));

// ===== 4. What staff can tell us =====
const supplyRef = ours[0].ref;
const deliveryRef = ours[3].ref; // Walmart Delivery, not ordered
await signIn(jayde.id);
let r = await answer({ ref: supplyRef, answer: "have" });
check("I have it saves on a supply line", r.status === 200 && db.order_sheet_answers.some((a) => a.line_ref === supplyRef && a.staff_id === "b1" && a.answer === "have"));
await signIn(marcus.id);
r = await answer({ ref: supplyRef, answer: "out", note: "Only one bottle left at home" });
check("I'm out saves, with a note", r.status === 200 && db.order_sheet_answers.some((a) => a.line_ref === supplyRef && a.staff_id === "b2" && a.answer === "out" && a.note === "Only one bottle left at home"));
check("Each records who and when", db.order_sheet_answers.every((a) => a.staff_id && a.updated_at));
const marcusLine = sl.staffListLines(r.body.view).find((l: { ref: string }) => l.ref === supplyRef);
check("Teammates' answers show by first name: Jayde has this", marcusLine.teammates.includes("Jayde has this"), JSON.stringify(marcusLine.teammates));
const jaydeLine = sl.staffListLines((await viewFor(jayde))!).find((l) => l.ref === supplyRef)!;
check("...and Marcus is out, with his note", jaydeLine.teammates.includes("Marcus is out: Only one bottle left at home") && jaydeLine.mine?.answer === "have");
await signIn(jayde.id);
r = await answer({ ref: deliveryRef, answer: "have" });
check("I already have this saves on a delivery line", r.status === 200 && sl.staffListLines(r.body.view).find((l: { ref: string }) => l.ref === deliveryRef).mine.answer === "have");
check("A delivery line offers only I already have this", (await answer({ ref: deliveryRef, answer: "out" })).status === 400);
const longNote = "x".repeat(120);
r = await answer({ ref: deliveryRef, note: longNote });
check("Notes are cut to 80 characters, and keep the answer", db.order_sheet_answers.find((a) => a.line_ref === deliveryRef && a.staff_id === "b1")!.note.length === 80 && db.order_sheet_answers.find((a) => a.line_ref === deliveryRef && a.staff_id === "b1")!.answer === "have");
const clientRef = adminAll.find((l) => l.clientBuys)!.ref;
check("The client is buying lines take no answer", (await answer({ ref: clientRef, answer: "have" })).status === 400);

// Staff cannot change the line itself.
const before = JSON.stringify(db.order_sheet_lines);
const tried = await answer({ ref: deliveryRef, answer: "have", store: "specs", quantity: "99", ordered: true, action: "store" });
check("Staff cannot change the source, quantity, or ordered: the sheet is untouched", tried.status === 200 && JSON.stringify(db.order_sheet_lines) === before);
const adminRes = await adminRoute.POST(new Request("https://plan.test/api/team/admin/order-sheet", { method: "POST", body: JSON.stringify({ sessionId: "s1", action: "store", ref: deliveryRef, store: "specs" }) }));
check("...and the admin sheet route refuses them", adminRes.status === 403 && JSON.stringify(db.order_sheet_lines) === before);
await signIn(sam.id);
check("Someone only offered cannot answer", (await answer({ ref: supplyRef, answer: "have" })).status === 403);
await signIn(dee.id);
check("Someone who declined cannot answer", (await answer({ ref: supplyRef, answer: "have" })).status === 403);

// ===== 5. What admins see =====
let av = await osdb.getSheetView(S());
check("Admin sheet: Jayde has this in green, Marcus is out in red", av.answers.byRef[supplyRef].answers.some((a) => a.text === "Jayde has this" && a.tone === "have") && av.answers.byRef[supplyRef].answers.some((a) => a.text === "Marcus is out" && a.tone === "out" && a.note === "Only one bottle left at home"));
check("The count at the top: 1 out, 2 already have", av.answers.summary === "1 out, 2 already have", av.answers.summary);
check("I'm out on a supply line raises the Shopping list badge", av.answers.badge === 1);
check("I already have this on a line not ordered yet offers Skip ordering", av.answers.byRef[deliveryRef].skip === true);
await signIn(jayde.id);
await answer({ ref: sams.ref, answer: "have" });
av = await osdb.getSheetView(S());
check("On a line already ordered, just the answer, no Skip ordering", av.answers.byRef[sams.ref].skip === false && av.answers.byRef[sams.ref].answers[0].text === "Jayde has this");
const page = src("app/team/admin/e/[id]/page.tsx");
check("The tab badge counts it", page.includes("order: sheetFlags + (sheet.answers?.badge ?? 0)"));

// Handled: the source changes, or an admin dismisses it.
await act({ action: "store", ref: supplyRef, store: "sams" });
av = await osdb.getSheetView(S());
check("Changing the line's source clears it from the badge", av.answers.badge === 0 && av.answers.byRef[supplyRef].answers.find((a) => a.staffId === "b2")!.tone === "handled");
await act({ action: "store", ref: supplyRef, store: "mine" });
await signIn(marcus.id);
await answer({ ref: supplyRef, answer: null });
await answer({ ref: supplyRef, answer: "out" });
check("A fresh I'm out counts again", (await osdb.getSheetView(S())).answers.badge === 1);
await act({ action: "dismiss_out", ref: supplyRef, staffId: "b2" });
check("Dismiss clears it", (await osdb.getSheetView(S())).answers.badge === 0 && !!db.order_sheet_answers.find((a) => a.staff_id === "b2" && a.line_ref === supplyRef)!.dismissed_at);
await act({ action: "skip_ordering", ref: deliveryRef });
check("Skip ordering moves the line to Bring from your supply, not ordered", (await adminLines()).find((l) => l.ref === deliveryRef)!.store === "mine");

// Undo.
await signIn(jayde.id);
r = await answer({ ref: supplyRef, answer: null });
check("Undo removes the answer from the staff list and the admin sheet", r.status === 200 && !sl.staffListLines(r.body.view).find((l: { ref: string }) => l.ref === supplyRef).mine && !(await osdb.getSheetView(S())).answers.byRef[supplyRef]?.answers.some((a) => a.staffId === "b1"));
await answer({ ref: deliveryRef, answer: null, note: "" });
check("Undo with no note deletes the row", !db.order_sheet_answers.some((a) => a.line_ref === deliveryRef && a.staff_id === "b1"));

// ===== 6. Read only once the event is over =====
const after = new Date(time.zonedInstant(SOON, 23 * 60, "America/Chicago").getTime());
const over = await viewFor(jayde, "s1", after);
check("After the event: still visible, read only", !!over && !over.canAnswer && over.readOnlyNote === sl.LIST_READ_ONLY);
const saveAfter = await sldb.saveAnswer(S(), jayde as never, { ref: ours[1].ref, answer: "have" }, after);
check("After the event: saving is refused", !saveAfter.ok && saveAfter.status === 409);

// ===== 7. The ready text =====
reset();
const morning = time.zonedInstant(today, 10 * 60, "America/Chicago");
const night = time.zonedInstant(today, 22 * 60, "America/Chicago");
check("Not ready with no sources set: nothing sent", (await sldb.sendListReadyTexts(morning)) === 0 && texts.length === 0);
await source();
check("Ready once most of our lines have a source", sl.listReady((await osdb.staffSheet(S())).sheet));
const nightSent = await sldb.sendListReadyTexts(night);
check("Quiet hours (10 PM): nothing goes out, it waits", nightSent === 0 && texts.length === 0 && db.order_sheet_ready_texts.filter((t) => t.session_id === "s1").every((t) => t.status === "pending"));
const due = db.order_sheet_ready_texts.find((t) => t.session_id === "s1")!;
check("...held until 8 AM", new Date(due.send_after as string).getTime() > night.getTime());
const eight = new Date(new Date(due.send_after as string).getTime() + 60_000);
await sldb.sendListReadyTexts(eight);
const to = (p: { phone: string }) => texts.filter((t) => t.phone === p.phone);
check("At 8 AM each accepted person gets one text", to(jayde).length === 1 && to(marcus).length === 1, JSON.stringify(texts));
check("Offered and declined people get none", to(sam).length === 0 && to(dee).length === 0);
const msg = to(jayde)[0]?.message ?? "";
check("The wording, with the link straight to the Shopping list tab", /^The shopping list for Justin · Birthday, \w{3}, \w{3} \d+ is ready\. Open it and mark what you already have: https:\/\/plan\.test\/team\/e\/s1\?tab=list$/.test(msg), msg);
check("The link is the one the page opens the Shopping list tab from", sl.listLink("https://plan.test", "s1") === "https://plan.test/team/e/s1?tab=list" && /\["chat", "wrapup", "shopping", "list",/.test(src("app/team/e/[id]/page.tsx")) && src("app/team/e/[id]/page.tsx").includes('(askedTab === "list" && !shoppingList) ? "details" : askedTab'));
await sldb.sendListReadyTexts(new Date(eight.getTime() + 3_600_000));
const manual = await sldb.textTeamTheList(S(), new Date(eight.getTime() + 7_200_000));
check("Never twice: the cron again and the button send nothing new", to(jayde).length === 1 && to(marcus).length === 1 && manual.sent === 0 && manual.message === "Everyone on the event already has the text.");
check("Never for a past event", to(jayde).every((t) => !t.message.includes("past")) && !db.order_sheet_ready_texts.some((t) => t.session_id === "past"));
check("The past event's button says it is over", (await sldb.textTeamTheList(S("past"), morning)).message === "This event is over.");
// Someone accepted later gets it once, by the button, before the list is ready.
reset();
db.event_assignments.push({ id: "x6", session_id: "s1", staff_id: "b3", status: "accepted" });
check("Before the button: no sources, not ready", (await viewFor(jayde))!.ready === false);
const byHand = await sldb.textTeamTheList(S(), morning);
check("Text the team the list sends it by hand to everyone accepted", byHand.sent === 3 && to(sam).length === 1 && byHand.message === "Texted 3 people.", byHand.message);
check("...with the link to the Shopping list tab", to(sam)[0].message.endsWith("/team/e/s1?tab=list"), to(sam)[0].message);
check("Once a ready text went out, the tab shows the list even with few sources", (await viewFor(jayde))!.ready === true && (await viewFor(marcus))!.ready === true && (await viewFor({ ...admin, role: "bartender", bartenderView: true }))!.ready === true);
const quiet = await sldb.textTeamTheList(S(), night);
check("...and again sends nothing new", quiet.queued === 0 && to(sam).length === 1);
reset();
const held = await sldb.textTeamTheList(S(), night);
check("By hand in quiet hours: held until 8 AM", held.sent === 0 && held.held && texts.length === 0 && /8 AM/.test(held.message));
check("...and a text still waiting does not make the list ready", (await viewFor(jayde))!.ready === false);
check("The admin tab has the button and the count", src("app/team/admin/e/[id]/order/order-sheet.tsx").includes("Text the team the list") && src("app/team/admin/e/[id]/order/order-sheet.tsx").includes("already have</span>"));
check("The cron runs it", src("app/api/cron/team/route.ts").includes("sendListReadyTexts(now)"));

// ===== Why the tab went missing (live, admin in Bartender view) =====
// Cause 1: the manager view's "Bartender view" link is ?as=bartender. That path
// sets no cookie, so the admin keeps role admin and has no bartenderView flag.
// The list only checked bartenderView and returned null; Receipts also accepts
// an admin role, so it showed.
reset();
await source();
const viaLink = { ...admin }; // role "admin", no bartenderView: exactly what ?as=bartender gives the page
const viaSwitch = { ...admin, role: "bartender", bartenderView: true };
const linkView = await viewFor(viaLink);
check("Admin in Bartender view by the ?as=bartender link sees the list (was null)", !!linkView && !linkView.canAnswer && linkView.readOnlyNote === sl.LIST_PREVIEW && linkView.ready, JSON.stringify(linkView)?.slice(0, 120));
check("...a manager by that link too", !!(await viewFor({ id: "m9", name: "Alex Rivera", role: "manager", active: true })));
check("...and by the view switch, as before", !!(await viewFor(viaSwitch)));
check("Who sees the list matches who sees Receipts on the page", sldb.inBartenderView(viaLink) && sldb.inBartenderView(viaSwitch) && !sldb.inBartenderView(jayde) && src("app/team/e/[id]/page.tsx").includes("adminPreview: !!staff.bartenderView || isAdminRole(staff.role)"));
check("Offered, declined, and not on the event still see nothing", (await viewFor(sam)) === null && (await viewFor(dee)) === null && (await viewFor({ id: "zz", name: "Nobody", role: "event_helper" })) === null);
check("An accepted event helper sees it", sldb.canSeeList("accepted", { role: "event_helper" }) && !sldb.canSeeList("offered", { role: "event_helper" }));
const pg = src("app/team/e/[id]/page.tsx");
check("The page asks with the assignment it already read, and the same rule", pg.includes("staffListFor(access.session, staff, undefined, assignment?.status ?? null)") && pg.includes("const listAllowed = canSeeList(assignment?.status, staff);"));

// Cause 2 (checked, hardened): anything that throws while building the list.
// The page's catch used to turn that into null and hide the tab.
const logged: unknown[][] = [];
const realError = console.error;
console.error = (...a: unknown[]) => { logged.push(a); };
try {
  reset();
  db.order_sheet_lines = [];
  missingTables.add("order_sheet_stores");
  missingTables.add("order_sheet_meta");
  let x = await viewFor(jayde);
  check("No order sheet built yet and no stores: the tab shows, not ready", !!x && x.ready === false && x.canAnswer);
  missingTables.clear();
  const bare = { ...S(), id: "s1", event_data: {} };
  x = await sldb.staffListFor(bare as never, jayde as never);
  check("Missing booking details (no package, date, or drinks): the tab shows, not ready", !!x && x.ready === false);
  x = await sldb.staffListFor({ ...S(), event_data: null } as never, viaLink as never);
  check("No booking details at all: the tab shows, not ready", !!x && x.ready === false);
  const broken = { ...S() } as Record<string, unknown>;
  Object.defineProperty(broken, "event_data", { get() { throw new Error("event_data exploded"); }, enumerable: true });
  logged.length = 0;
  x = await sldb.staffListFor(broken as never, jayde as never);
  check("A throw while building the list shows the tab with the not ready line", !!x && x.ready === false && x.groups.length === 0 && x.sessionId === "s1");
  check("...and logs the real error with the event", logged.some((l) => String(l[0]).includes("[shopping list] s1") && l.some((v) => v instanceof Error && v.message === "event_data exploded")), JSON.stringify(logged.map((l) => String(l[0]))));
  x = await sldb.staffListFor(broken as never, viaLink as never);
  check("...for an admin in Bartender view too, read only", !!x && x.ready === false && !x.canAnswer);
  x = await sldb.staffListFor(broken as never, sam as never, undefined, "offered");
  check("...but never for someone who may not see it", x === null);
  missingTables.add("event_assignments");
  x = await sldb.staffListFor(S(), jayde as never, undefined, "accepted");
  check("The page's own assignment read decides, even if a second read would fail", !!x && x.canAnswer);
  missingTables.clear();
} finally {
  console.error = realError;
}
check("An empty list is never ready, even after a text went out", sl.staffList({ sessionId: "e", sheet: { sections: [] } as never, stores: [], answers: [], names: new Map(), viewerId: "b1", canAnswer: true, readOnlyNote: "", textSent: true }).ready === false);
check("The page's last resort keeps the tab: a load error gives the not ready line, not null", pg.includes("return listAllowed ? notReadyView({ sessionId: id }) : null;"));

// ===== Before the migration =====
reset();
missingTables.add("order_sheet_answers");
missingTables.add("order_sheet_ready_texts");
check("Before the migration the list still shows, with no answers", !!(await viewFor(jayde)) && (await osdb.getSheetView(S())).answers.badge === 0);
check("...and reads as not ready until most lines have a source", (await viewFor(jayde))!.ready === false);
const notYet = await sldb.saveAnswer(S(), jayde as never, { ref: (await adminLines())[0].ref, answer: "have" });
check("...and saving says it is not set up yet", !notYet.ok && notYet.status === 503);
check("...and the cron sends nothing", (await sldb.sendListReadyTexts(morning)) === 0);
missingTables.clear();
const mig = src("supabase/migrations/20261230_staff_shopping_list.sql");
check("The migration adds the kind, the answers, and the ready texts", mig.includes("add column if not exists kind text") && mig.includes("create table if not exists public.order_sheet_answers") && mig.includes("unique (session_id, line_ref, staff_id)") && mig.includes("create table if not exists public.order_sheet_ready_texts") && mig.includes("unique (session_id, staff_id)") && mig.includes("char_length(note) <= 80"));

// ===== The page and wording =====
const tabs = src("app/team/e/[id]/event-tabs.tsx");
const panel = (t: string) => { const m = tabs.match(new RegExp(`<div hidden=\\{tab !== "${t}"\\}[\\s\\S]*?\\n      </div>`)); return m ? m[0] : ""; };
check("Shopping list is its own tab, right after Supplies", /\["shopping", SUPPLIES_TAB\],\n\s*\.\.\.\(shoppingList \? \(\[\["list", LIST_TAB\]\]/.test(tabs) && sl.LIST_TAB === "Shopping list");
check("The tab shows for the same people who get the list (accepted, or an admin in Bartender view)", tabs.includes("...(shoppingList ? ([[\"list\", LIST_TAB]]") && tabs.includes("{shoppingList && (\n        <div hidden={tab !== \"list\"}>"));
check("The list lives on that tab, and no longer on Supplies", panel("list").includes("<ShoppingList initial={shoppingList} />") && !panel("shopping").includes("<ShoppingList"));
check("Supplies keeps its own list, with the card pointing to the new tab, for the same people", panel("shopping").includes("<Supplies\n") && panel("shopping").includes('{shoppingList && <ListMovedCard onOpen={() => setTab("list")} />}') && panel("shopping").indexOf("<ListMovedCard") < panel("shopping").indexOf("<Supplies"));
check("The card's wording", sl.LIST_MOVED === "Looking for the shopping list? It has its own tab now." && tabs.includes("{LIST_MOVED}") && tabs.includes("{LIST_MOVED_BUTTON}"));
check("Someone who has not done Tools can open Supplies and Shopping list: neither panel waits on Tools", !/toolsAt|SuppliesLocked/.test(panel("shopping") + panel("list")) && !tabs.includes("SuppliesLocked"));
check("Not ready: the tab shows the lines with the finalizing banner, never a not ready screen", !src("app/team/e/[id]/shopping-list.tsx").includes("if (!view.ready) {") && src("app/team/e/[id]/shopping-list.tsx").includes("{LIST_FINALIZING}"));
check("The one time list is ready text is unchanged", sl.readyText({ title: "T", date: "D", link: "L" }) === "The shopping list for T, D is ready. Open it and mark what you already have: L");
check("The tab row is one row that swipes sideways", tabs.includes('className="flex flex-nowrap gap-1 overflow-x-auto') && tabs.includes("shrink-0 whitespace-nowrap") && !/grid-cols-\d/.test(tabs.slice(tabs.indexOf('role="tablist"') - 300, tabs.indexOf('role="tablist"'))));
check("Opened from a link, the selected tab scrolls into view", tabs.includes("<nav ref={navRef}") && tabs.includes(`querySelector<HTMLElement>('[aria-selected="true"]')`) && tabs.includes("nav.scrollTo("));
check("The admin event page tabs are unchanged", !/"list"/.test(src("lib/team/manager-tabs.ts")));
const ui = src("app/team/e/[id]/shopping-list.tsx");
const words = [
  sl.LIST_TITLE, sl.LIST_INTRO, sl.LIST_READ_ONLY, sl.LIST_PREVIEW, sl.LIST_TAB, sl.LIST_NOT_READY, sl.LIST_MOVED, sl.LIST_MOVED_BUTTON, ...Object.values(sl.GROUP_TITLES), ...Object.values(sl.BUTTONS),
  "Ordered", "Not ordered yet", "Add a note", "Change note", "You said: ", "Your note: ", "For reference. The client buys these.", "Nothing on the shopping list yet.",
  "Text the team the list", "Skip ordering", "Dismiss", "(handled)", "No answers from the team yet.", "From the team:",
  "Everyone on the event already has the text.", "Nobody has accepted this event yet.", "This event is over.", sldb.NOT_SET_UP,
  "Only people who accepted this event can answer.", "That item is no longer on the list. Reload the page.", "That answer does not fit this line.", "The client is buying this one.",
  "Add a store of the kind Bring from your supply on Manage stores first.", "Pick a kind: pick up, delivery, or bring from your supply.", ...shared.STORE_KINDS.map((k) => k.label),
  sl.readyText({ title: "Justin's Birthday", date: "Sat, Dec 5", link: "" }), "1 text goes out at 8 AM, after quiet hours.", "Texted 3 people.",
];
const hyph = words.filter((w) => /[A-Za-z]-[A-Za-z]|\s-\s|—|–/.test(w));
check("No hyphens in any wording shown or texted", hyph.length === 0, hyph.join(" | "));
check("The page uses that wording", ["Add a note", "Change note", "You said: ", "For reference. The client buys these."].every((w) => ui.includes(w)));

done("staff shopping list");
