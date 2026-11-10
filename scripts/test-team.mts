// Checks the bartender portal: access, what staff can see, login codes,
// checklists, and checkbox state.
// Run: npm run test:team   (plain node, Node 22.6+ strips the types)
// Exits 1 if any check fails.

import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const view = await import("../lib/team/event-view.ts");
const codes = await import("../lib/team/codes.ts");
const config = await import("../lib/team/checklist-config.ts");
const checks = await import("../lib/team/checks.ts");
const shop = await import("../lib/team/shopping.ts");
const time = await import("../lib/team/time.ts");
const list = await import("../lib/team/event-list.ts");
const bar = await import("../lib/team/bar-ready.ts");
const asg = await import("../lib/team/assignments.ts");
const clock = await import("../lib/team/clock.ts");
const auth = { needsName: (s: { name: string }) => !s.name.trim() || s.name.trim().toLowerCase() === "admin" };
const shoppingLib = await import("../lib/shopping-list.ts");

let failed = 0;
let total = 0;
function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}

// ----- Access -----
const bartender = { id: "b1", name: "Jordan Lee", phone: "+12145550101", role: "bartender" as const, active: true };
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550102", role: "admin" as const, active: true };
check("Bartender with no assignment cannot open the event", !view.canOpenEvent(bartender, null));
check("Bartender who declined cannot open the event", !view.canOpenEvent(bartender, { status: "declined" }));
check("Bartender who is offered or accepted can open it", view.canOpenEvent(bartender, { status: "offered" }) && view.canOpenEvent(bartender, { status: "accepted" }));
check("Inactive staff cannot open it even when assigned", !view.canOpenEvent({ ...bartender, active: false }, { status: "accepted" }));
check("Signed out cannot open it", !view.canOpenEvent(null, { status: "accepted" }));
check("Admins open every event", view.canOpenEvent(admin, null));

const pageSrc = readFileSync(new URL("../app/team/e/[id]/page.tsx", import.meta.url), "utf8");
check(
  "Event page checks access before loading any event data",
  pageSrc.indexOf("openEvent(") > 0 && pageSrc.indexOf("openEvent(") < pageSrc.indexOf("eventPageData("),
);
for (const route of ["checks", "missing"]) {
  const src = readFileSync(new URL(`../app/api/team/${route}/route.ts`, import.meta.url), "utf8");
  check(`/api/team/${route} checks access before acting`, src.includes("getCurrentStaff()") && src.includes("openEvent(") && src.includes("status: 403"));
}

// ----- What staff can see -----
const CLIENT_EMAIL = "alex.butler@example.com";
const CLIENT_PHONE = "(214) 555-0199";
const DAY_PHONE = "469-555-0123";
const ed = {
  client_name: "Alex Butler",
  email: CLIENT_EMAIL,
  phone: CLIENT_PHONE,
  event_type: "Birthday",
  event_name: "Alex's 40th",
  event_date: "2026-12-12",
  bar_service_start: "6:00pm",
  bar_service_end: "10:00pm",
  event_address: "123 Elm St, Dallas, TX 75201",
  venue_type: "private_residence",
  indoor_outdoor: "Outdoor",
  bar_on_site: "No, bring a bar",
  parking_info: "Driveway. Call me at 214-555-0199 if full.",
  guest_count: 100,
  package: "Full Bar",
  theme: "Gold",
  event_colors: "Black and gold",
  allergies: ["Peanuts"],
  special_requests: "Champagne tower add on, $250. Email me at alex.butler@example.com.",
  day_of_contact_name: "Sam Rivera",
  day_of_contact_phone: DAY_PHONE,
  payment_preference: "Auto charge on due date",
  promo_code: "RETURN5",
  drinking_pace: "moderate",
  beer: true,
  wine: false,
  signature_drinks: [
    { name: "Margarita", base_spirit: "tequila", ingredients: ["2 oz tequila blanco", "1 oz lime juice", "0.75 oz agave"], method: "Shaken", garnish: "Lime wheel" },
  ],
};
const session = {
  id: "abc12345",
  event_data: ed,
  updated_at: "2026-11-09T20:15:00Z",
  booked_price: { bartenders: 2, total: 1749, gratuity: 262, deposit_paid: 150, promo_code: "RETURN5", package_price: 1487 },
};
const update = {
  created_at: "2026-11-09T20:15:00Z",
  changes: [
    { field: "guest_count", old: 80, new: 100 },
    { field: "payment_preference", old: "", new: "Auto charge on due date" },
    { field: "email", old: "old@example.com", new: CLIENT_EMAIL },
    { field: "day_of_contact_phone", old: "", new: DAY_PHONE },
  ],
};
const start = time.chicagoInstant("2026-12-12", 18 * 60);
const early = new Date(start.getTime() - 48 * 3600_000 - 60_000);
const late = new Date(start.getTime() - 47 * 3600_000);
const vEarly = view.buildStaffEventView(session, { now: early, latestUpdate: update, teammates: ["Jordan"] });
const vLate = view.buildStaffEventView(session, { now: late, latestUpdate: update });
const shopping = shop.buildStaffShopping(ed);
const rendered = JSON.stringify({ vEarly, vLate, shopping, checklist: config.checklistFor(ed.package) });

const forbidden: [string, string][] = [
  ["client email", CLIENT_EMAIL],
  ["old client email", "old@example.com"],
  ["client phone", "555-0199"],
  ["client last name", "Butler"],
  ["payment preference", "Auto charge"],
  ["promo code", "RETURN5"],
  ["the word gratuity", "gratuity"],
  ["the word deposit", "deposit"],
  ["booked total", "1749"],
  ["booked total with comma", "1,749"],
  ["any dollar amount", "$"],
];
for (const [name, needle] of forbidden) {
  check(`Event page data never includes ${name}`, !rendered.toLowerCase().includes(needle.toLowerCase()), needle);
}
check("Client first name is shown", vEarly.clientFirstName === "Alex");
check("Special requests keep the words, lose the price and email", vEarly.specialRequests.startsWith("Champagne tower add on") && !vEarly.specialRequests.includes("250"));
check("What changed shows staff fields old to new", vEarly.whatChanged.includes("Guest count: from 80 to 100"), vEarly.whatChanged.join(" | "));
check("What changed leaves out payment, email, and the day of phone", vEarly.whatChanged.length === 1, vEarly.whatChanged.join(" | "));
for (const dir of ["../app/team/e/[id]/", "../app/team/"]) {
  for (const file of readdirSync(new URL(dir, import.meta.url)).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(new URL(`${dir}${file}`, import.meta.url), "utf8");
    check(`${dir.replace("../", "")}${file} reads no client email or pricing fields`, !/\.(email|booked_price|payment_preference|promo_code|gratuity|deposit_paid)\b/.test(src));
  }
}

// ----- Day of contact phone -----
check("Day of phone is hidden before 48 hours", vEarly.dayOfContact.phone === null && vEarly.dayOfContact.phoneNote === "Contact number appears 48 hours before the event.");
check("Day of phone number is nowhere in the early page data", !JSON.stringify(vEarly).includes("555-0123"));
check("Day of phone shows from 48 hours before service starts", vLate.dayOfContact.phone === DAY_PHONE && vLate.dayOfContact.phoneNote === null);
check("Day of contact name always shows", vEarly.dayOfContact.name === "Sam Rivera");
check("The Mix Fix line always shows", vEarly.mixFixLine === "469 754 8512");
check("48 hours is counted in Chicago time", start.toISOString() === "2026-12-13T00:00:00.000Z", start.toISOString());

// ----- Times -----
check("Arrival is 2 hours before service", vEarly.arrival === "4:00 PM" && vEarly.serviceStart === "6:00 PM", vEarly.arrival);
const wedding = view.buildStaffEventView({ ...session, event_data: { ...ed, event_type: "Wedding" } }, { now: early });
check("Arrival is 3 hours before service for weddings", wedding.arrival === "3:00 PM", wedding.arrival);
check("Service ending after midnight reads right", view.buildStaffEventView({ ...session, event_data: { ...ed, bar_service_end: "1:00am" } }, { now: early }).serviceEnd === "1:00 AM");
check("Address opens in maps", vEarly.mapsUrl === "https://www.google.com/maps/search/?api=1&query=123%20Elm%20St%2C%20Dallas%2C%20TX%2075201");
check("Teammates show by first name", vEarly.teammates.join() === "Jordan");
check("Recipes keep oz amounts for bartenders", vEarly.drinks[0].ingredients[0] === "2 oz tequila blanco" && vEarly.drinks[0].method === "Shaken");

const dive = view.buildStaffEventView({ ...session, event_data: { ...ed, package: "Dive Bar", signature_drinks: [] } }, { now: early });
const classicNames = (dive.classics ?? []).flatMap((g) => g.drinks.map((d) => d.name));
check("Dive Bar with no menu shows the classics", classicNames.includes("Old Fashioned") && classicNames.includes("Margarita") && classicNames.includes("Pina Colada"));
check("Dive Bar classics have recipes", (dive.classics ?? [])[0].drinks[0].recipe.includes("oz"));
check("Dive Bar classics leave out signature only drinks", !classicNames.some((n) => ["Sidecar", "Bellini", "Amaretto Sour", "Hurricane"].includes(n)));
check("Packages with a menu show no classics list", vEarly.classics === null);

// ----- Login codes -----
const phone = "+12145550101";
const now = new Date("2026-11-10T18:00:00Z");
const row = (over: Partial<{ attempts: number; expires_at: string; used_at: string | null; code: string }> = {}) => ({
  id: "c1",
  phone,
  code_hash: codes.hashCode(phone, over.code ?? "123456"),
  expires_at: over.expires_at ?? new Date(now.getTime() + codes.CODE_TTL_MS).toISOString(),
  attempts: over.attempts ?? 0,
  used_at: over.used_at ?? null,
});
check("Codes last 10 minutes", codes.CODE_TTL_MS === 10 * 60 * 1000);
check("Right code inside 10 minutes works", codes.checkCode(row(), phone, "123456", now) === "ok");
check("Right code after 10 minutes is expired", codes.checkCode(row({ expires_at: new Date(now.getTime() - 1000).toISOString() }), phone, "123456", now) === "expired");
check("Wrong code is wrong", codes.checkCode(row(), phone, "654321", now) === "wrong");
check("After 5 wrong tries even the right code fails", codes.MAX_ATTEMPTS === 5 && codes.checkCode(row({ attempts: 5 }), phone, "123456", now) === "too_many");
check("The 5th try still counts", codes.checkCode(row({ attempts: 4 }), phone, "123456", now) === "ok");
check("A used code cannot be used again", codes.checkCode(row({ used_at: now.toISOString() }), phone, "123456", now) === "none");
check("A code for another phone does not work", codes.checkCode(row(), "+12145550999", "123456", now) !== "ok");
check("Wrong code message counts down", codes.codeCheckMessage("wrong", 3) === "That code is not right. 2 tries left.");
check("Fifth wrong code says request a new one", codes.codeCheckMessage("wrong", 5) === "Too many tries. Request a new code.");
check("Unknown phones get the same message", codes.CODE_SENT_MESSAGE.startsWith("If that number is on our team, we sent a code"));
check("Phones normalize to +1", codes.normalizePhone("(214) 555-0101") === phone && codes.normalizePhone("1-214-555-0101") === phone && codes.normalizePhone("555") === null);
check("ADMIN_PHONES is read as a list", codes.adminPhones("214 555 0101, +1 469-754-8512").has("+14697548512") && codes.adminPhones("214 555 0101, +1 469-754-8512").has(phone));
check("Codes are 6 digits", /^\d{6}$/.test(codes.generateCode()));
check("Sessions last 30 days", codes.SESSION_DAYS === 30);
const authSrc = readFileSync(new URL("../lib/team/auth.ts", import.meta.url), "utf8");
check("Session cookie is httpOnly", /httpOnly:\s*true/.test(authSrc) && /maxAge:\s*SESSION_DAYS \* 86_400/.test(authSrc));
check("Dev code logging never runs in production", authSrc.includes('process.env.NODE_ENV !== "production"'));

// ----- Checklist -----
const fullList = config.checklistFor("Full Bar");
const premiumList = config.checklistFor("Premium Bar");
const lines = (g: ReturnType<typeof config.checklistFor>) => g.flatMap((x) => x.sections.flatMap((s) => s.lines));
check("Checklist has the two groups", fullList.map((g) => g.title).join(" / ") === "From The Mix Fix / Your own tools");
check("Full Bar has the folding tables to check", lines(fullList).some((l) => l.label === "6 ft folding tables (2)" && !l.info));
check("Premium Bar has no folding tables", !lines(premiumList).some((l) => l.label === "6 ft folding tables (2)"));
check("Premium Bar shows the wooden bar as info with no checkbox", lines(premiumList).some((l) => l.label === "Wooden bar, delivered by the company" && l.info));
check("Premium Bar wooden bar is not counted", !config.checklistKeys("Premium Bar").includes("Wooden bar, delivered by the company") && config.checklistKeys("Premium Bar").length === config.checklistKeys("Full Bar").length - 1);
check("Checklist footer", config.CHECKLIST_FOOTER === "Premium Bar: the wooden bar is delivered by the company.");
check("Checklist has every item", config.checklistKeys("Full Bar").length === 23, String(config.checklistKeys("Full Bar").length));

// ----- Shopping list -----
const shopText = JSON.stringify(shopping);
check("Alcohol comes from the client shopping list", shopping.alcohol.some((i) => i.item === "Tequila blanco" && i.brand === "Clase Azul Plata or Espolon Blanco"));
check("Beer is on the alcohol list", shopping.alcohol.some((i) => i.item.startsWith("Beer")));
check("Supplies come from the supply list", shopping.supplies.some((i) => i.item === "Lime juice") && shopping.supplies.some((i) => i.item === "Ice"));
check("Spirits are not repeated under supplies", !shopping.supplies.some((i) => /tequila/i.test(i.item)));
check("Recipes are not shopping items", !shopping.supplies.some((i) => /margarita|garnish:/i.test(i.item)));
check("No store names on the shopping list", !/walmart|sam'?s club|spec'?s|costco|amazon/i.test(shopText));
const tailored = shop.buildStaffShopping({ ...ed, package: "Tailored Bar" });
check("Tailored Bar supplies come from the client list without store names", tailored.supplies.length > 0 && !/walmart|sam'?s club|amazon/i.test(JSON.stringify(tailored)));
check("Tailored Bar supply names drop oz amounts", !tailored.supplies.some((i) => /^\d/.test(i.item)));
check("Beer and Wine shows the ice", shop.buildStaffShopping({ ...ed, package: "Beer and Wine" }).supplies.some((i) => i.item === "Ice"));

// ----- Checkbox state across a client update -----
const items1 = shop.allShopItems(shopping);
const saved = items1.map((i) => ({ item_key: i.key, checked: true, quantity: i.quantity }));
const s1 = checks.mergeChecks(items1, saved, { trackChanges: true });
check("Checked items stay checked on reload", Object.values(s1).every((s) => s.checked && !s.changed));
check("Progress counts checked items", checks.progressLabel(checks.progress(s1)) === `${items1.length} of ${items1.length} checked`);

const updated = shop.buildStaffShopping({ ...ed, guest_count: 200, wine: true });
const items2 = shop.allShopItems(updated);
const s2 = checks.mergeChecks(items2, saved, { trackChanges: true });
const q1 = new Map(items1.map((i) => [i.key, i.quantity]));
const moved = items2.filter((i) => q1.has(i.key) && q1.get(i.key) !== i.quantity);
const same = items2.filter((i) => q1.get(i.key) === i.quantity);
const added = items2.filter((i) => !q1.has(i.key));
check("The update changed some quantities (test setup)", moved.length > 0 && added.length > 0, `${moved.length} moved, ${added.length} new`);
check("Items whose quantity changed come back unchecked and tagged", moved.every((i) => !s2[i.key].checked && s2[i.key].changed));
check("New items come back unchecked and tagged", added.every((i) => !s2[i.key].checked && s2[i.key].changed), added.map((i) => i.item).join(", "));
check("Unchanged items stay checked", same.length > 0 && same.every((i) => s2[i.key].checked && !s2[i.key].changed));
const recheck = saved.concat(moved.map((i) => ({ item_key: i.key, checked: true, quantity: i.quantity })));
const byKey = new Map(recheck.map((r) => [r.item_key, r]));
const s3 = checks.mergeChecks(items2, [...byKey.values()], { trackChanges: true });
check("Checking a changed item clears the tag", moved.every((i) => s3[i.key].checked && !s3[i.key].changed));
const fresh = checks.mergeChecks(items1, items1.map((i) => ({ item_key: i.key, checked: false, quantity: i.quantity })), { trackChanges: true });
check("First open is all unchecked with no tags", Object.values(fresh).every((s) => !s.checked && !s.changed));
const cl = checks.mergeChecks(config.checklistKeys("Full Bar").map((key) => ({ key, quantity: "" })), [{ item_key: "Muddler", checked: true, quantity: "" }], { trackChanges: false });
check("Checklist ticks save and are never tagged changed", cl["Muddler"].checked && Object.values(cl).every((s) => !s.changed));

// ----- Checklist wording and "I have everything" -----
check("Checklist title", config.CHECKLIST_TITLE === "Do you have everything?");
check("Checklist intro", config.CHECKLIST_INTRO === "Go through the list and check off each item before you leave for the event.");
check("Confirm button label", config.CONFIRM_LABEL === "I have everything");
const keys = config.checklistKeys("Full Bar");
const allOn = Object.fromEntries(keys.map((k) => [k, { checked: true, changed: false }]));
const oneOff = { ...allOn, [keys[3]]: { checked: false, changed: false } };
check("I have everything is off until every box is checked", !checks.canConfirm(oneOff) && !checks.canConfirm(Object.fromEntries(keys.map((k) => [k, { checked: false, changed: false }]))));
check("I have everything turns on when every box is checked", checks.canConfirm(allOn));
check("I have everything stays off with no boxes", !checks.canConfirm({}));
check("A saved confirmation shows while every box is checked", checks.activeConfirmation("2026-12-12T22:00:00Z", allOn) === "2026-12-12T22:00:00Z");
check("A saved confirmation no longer counts once a box is unchecked", checks.activeConfirmation("2026-12-12T22:00:00Z", oneOff) === null);
check("Unchecking a checklist item clears the confirmation", checks.clearsConfirmation("checklist", false));
check("Checking an item, or any shopping tick, keeps it", !checks.clearsConfirmation("checklist", true) && !checks.clearsConfirmation("shopping", false));
const eventsSrc = readFileSync(new URL("../lib/team/events.ts", import.meta.url), "utf8");
const confirmFn = eventsSrc.slice(eventsSrc.indexOf("export async function confirmChecklist"), eventsSrc.indexOf("async function clearConfirmation"));
check("The server only saves a confirmation when every box is checked", confirmFn.includes("if (!canConfirm(state)) return null"));
check("Saving an uncheck clears the saved confirmation", eventsSrc.includes("if (clearsConfirmation(list, checked)) await clearConfirmation("));
const confirmSrc = readFileSync(new URL("../app/api/team/confirm/route.ts", import.meta.url), "utf8");
check("/api/team/confirm checks access before acting", confirmSrc.includes("getCurrentStaff()") && confirmSrc.includes("openEvent(") && confirmSrc.includes("status: 403"));

// ----- Shopping tab layout and wording -----
for (const pkg of ["Bartender Only", "Tailored Bar"]) {
  const layout = shop.shoppingGroups(pkg, shop.buildStaffShopping({ ...ed, package: pkg }));
  check(`${pkg}: banner says the client provides everything`, layout.banner === "The client provides everything on this list. Check on site that it is all here.");
  check(`${pkg}: first group is provided by the client`, layout.groups[0].title === "Mixers, garnishes and supplies, provided by the client");
}
for (const pkg of ["Full Bar", "Premium Bar", "Essentials Bar", "Dive Bar", "Beer and Wine"]) {
  const layout = shop.shoppingGroups(pkg, shop.buildStaffShopping({ ...ed, package: pkg }));
  check(`${pkg}: no banner, supplies provided by The Mix Fix`, layout.banner === null && layout.groups[0].title === "Mixers, garnishes and supplies, provided by The Mix Fix");
  check(`${pkg}: alcohol group is last`, layout.groups.at(-1)!.id === "alcohol" && layout.groups[0].id === "supplies");
}
const fullLayout = shop.shoppingGroups("Full Bar", shopping);
check("Alcohol group title", fullLayout.groups.at(-1)!.title === "Alcohol, provided by the client");
check("Alcohol group line", fullLayout.groups.at(-1)!.note === "The client buys the alcohol. Check on site that everything is here, and tap Something is missing if it is not.");
check("Tailored Bar alcohol group is last too", shop.shoppingGroups("Tailored Bar", shopping).groups.at(-1)!.id === "alcohol");

// ----- A note in extra_bottles is not a shopping item -----
const NOTE = "Wine and hard seltzer quantities to be included in shopping list based on 120 guests and mixed drinking pace.";
check("A planning note is not a bottle request", !shoppingLib.isBottleRequest(NOTE));
check("Real bottle requests still count", shoppingLib.isBottleRequest("Fireball") && shoppingLib.isBottleRequest("1 bottle of Aperol") && shoppingLib.isBottleRequest("Hennessy VS"));
check("None is not a bottle request", !shoppingLib.isBottleRequest("None") && !shoppingLib.isBottleRequest(""));
const noted = { ...ed, package: "Tailored Bar", wine: true, extra_bottles: NOTE };
check("The note stays off the staff shopping list", !JSON.stringify(shop.buildStaffShopping(noted)).includes("hard seltzer"));
check("The note stays off the client shopping list", !JSON.stringify(shoppingLib.generateShoppingList(noted as never)).includes("hard seltzer"));
check("Staff see the note on Details instead", view.buildStaffEventView({ id: "s9", event_data: noted }).bottleNote.startsWith("Wine and hard seltzer"));
check("A real extra bottle stays on the list", shop.buildStaffShopping({ ...ed, extra_bottles: "Fireball" }).alcohol.some((i) => i.item === "Fireball"));
for (const pkg of ["Full Bar", "Tailored Bar", "Dive Bar"]) {
  const withBottle = { ...ed, package: pkg, extra_bottles: "Fireball" };
  const email = shoppingLib.generateClientShoppingListEmail(shoppingLib.generateShoppingList(withBottle as never), withBottle as never, "Alex");
  const liquor = email.slice(email.indexOf("LIQUOR"), email.indexOf("\n\n", email.indexOf("LIQUOR") + 8));
  check(`${pkg}: a real extra bottle is on the client shopping list email under LIQUOR`, email.includes("LIQUOR") && liquor.includes("Fireball") && liquor.includes("Extra bottle requested by client"), liquor);
  const withNote = { ...ed, package: pkg, wine: true, extra_bottles: NOTE };
  const noteEmail = shoppingLib.generateClientShoppingListEmail(shoppingLib.generateShoppingList(withNote as never), withNote as never, "Alex");
  check(`${pkg}: a bottle note stays out of the client shopping list email`, !noteEmail.includes("hard seltzer") && !noteEmail.includes("Extra bottle requested"));
}
for (const pkg of ["Full Bar", "Tailored Bar", "Dive Bar"]) {
  const withBottle = { ...ed, package: pkg, extra_bottles: "Fireball" };
  const note = shoppingLib.formatShoppingListForNote(shoppingLib.generateShoppingList(withBottle as never), withBottle as never);
  const liquor = note.slice(note.indexOf("LIQUOR"), note.indexOf("\n\n", note.indexOf("LIQUOR") + 8));
  check(`${pkg}: a real extra bottle is on the team GHL note under LIQUOR`, note.includes("LIQUOR") && liquor.includes("Fireball") && liquor.includes("Extra bottle requested by client"), liquor);
  const withNote = { ...ed, package: pkg, wine: true, extra_bottles: NOTE };
  const noteText = shoppingLib.formatShoppingListForNote(shoppingLib.generateShoppingList(withNote as never), withNote as never);
  check(`${pkg}: a bottle note stays out of the team GHL note`, !noteText.includes("hard seltzer") && !noteText.includes("Extra bottle requested"));
}
const plainNote = shoppingLib.formatShoppingListForNote(shoppingLib.generateShoppingList(ed as never), ed as never);
check("No extra bottle line on the GHL note when the client asked for none", !plainNote.includes("Extra bottle requested"));
const plainEmail = shoppingLib.generateClientShoppingListEmail(shoppingLib.generateShoppingList(ed as never), ed as never, "Alex");
check("No extra bottle line when the client asked for none", !plainEmail.includes("Extra bottle requested"));

// ----- Events list -----
const justin = { id: "e1", event_data: { client_name: "Justin Reyes", event_type: "Wedding", event_date: "2026-11-14", bar_service_start: "6:00 PM", bar_service_end: "11:00 PM", guest_count: 150, package: "Premium Bar", event_address: "500 Main St, Fort Worth, TX 76102" } };
const named = { id: "e2", event_data: { ...justin.event_data, event_name: "Reyes Fall Gala", event_type: "Corporate", event_date: "2026-11-20" } };
const li = list.eventListItem(justin);
check("Title is first name and event type", li.title === "Justin · Wedding", li.title);
check("Detail line has times, guests, package, city", li.detail === "6:00 PM to 11:00 PM · 150 guests · Premium Bar · Fort Worth", li.detail);
check("Arrival is on the row (3 hours early for a wedding)", li.arrival === "3:00 PM", li.arrival);
const ln = list.eventListItem(named);
check("A client event name is the title", ln.title === "Reyes Fall Gala");
check("First name and type move to the detail line", ln.detail.startsWith("Justin · Corporate · "), ln.detail);
check("City from a plain address", list.cityFrom("123 Elm St, Dallas, TX 75201") === "Dallas" && list.cityFrom("12 Oak Ln, Plano, Texas 75024, USA") === "Plano");
check("No city from a one part address", list.cityFrom("The Adolphus") === "");
check("List rows never include the last name", !JSON.stringify(li).includes("Reyes"));
const today = "2026-11-10"; // a Tuesday
const mk = (id: string, day: string) => list.eventListItem({ id, event_data: { client_name: "A B", event_type: "Party", event_date: day, bar_service_start: "7:00 PM" } });
const secs = list.upcomingSections([mk("a", "2026-11-15"), mk("b", "2026-11-16"), mk("c", "2026-11-23"), mk("d", "2026-11-12"), mk("old", "2026-11-01")], today);
check("Sections are This week, Next week, Later", secs.map((s) => s.name).join(",") === "This week,Next week,Later");
check("This week runs through Sunday", secs[0].days.map((d) => d.day).join(",") === "2026-11-12,2026-11-15");
check("Next week is Monday to Sunday", secs[1].days.map((d) => d.day).join(",") === "2026-11-16");
check("Date headers read like Saturday, November 14", list.dayHeader("2026-11-14", today) === "Saturday, November 14");
check("Past events are left out of upcoming", !JSON.stringify(secs).includes('"old"'));
check("Past events list holds them", list.pastSection([mk("old", "2026-11-01"), mk("a", "2026-11-15")], today)[0].days[0].events[0].id === "old");
check("Search matches the first name", list.matchesSearch(li, "justin") && !list.matchesSearch(li, "maria"));
check("Search matches the event name", list.matchesSearch(ln, "fall gala"));

// ----- Name on first sign in -----
check("Admins added from ADMIN_PHONES start with no name", authSrc.includes('name: "", phone, role: "admin"'));
check("A blank or Admin name is asked for", auth.needsName({ name: "" }) && auth.needsName({ name: "Admin" }) && !auth.needsName({ name: "Kenneth Smith" }));
check("The real needsName matches", authSrc.includes('return !n || n.toLowerCase() === "admin";'));
check("Pages send nameless staff to the name form", authSrc.includes("if (needsName(staff)) redirect(`/team/welcome"));

// ----- Bar is ready -----
const evDay = { ...ed, event_date: "2026-12-12", bar_service_start: "6:00pm", event_type: "Birthday" };
const beforeArrival = new Date("2026-12-12T21:59:00Z"); // 3:59 PM Chicago, arrival is 4:00 PM
const afterArrival = new Date("2026-12-12T22:00:00Z");
check("Bar ready opens at arrival time on the event day", !bar.barReadyOpen(evDay, beforeArrival) && bar.barReadyOpen(evDay, afterArrival));
check("Assigned staff can submit from arrival", bar.canSubmitBarReady(bartender, { status: "accepted" }, evDay, afterArrival));
check("Assigned staff cannot submit before arrival", !bar.canSubmitBarReady(bartender, { status: "accepted" }, evDay, beforeArrival));
check("Staff not assigned cannot submit", !bar.canSubmitBarReady(bartender, null, evDay, afterArrival) && !bar.canSubmitBarReady(bartender, { status: "declined" }, evDay, afterArrival));
check("Admins can submit", bar.canSubmitBarReady(admin, null, evDay, afterArrival));
check("Signed out cannot submit", !bar.canSubmitBarReady(null, { status: "accepted" }, evDay, afterArrival));
check("Only assigned staff or admins view bar photos", bar.canViewBarPhotos(bartender, { status: "offered" }) && bar.canViewBarPhotos(admin, null) && !bar.canViewBarPhotos(bartender, null) && !bar.canViewBarPhotos({ ...bartender, active: false }, { status: "accepted" }));
check("A photo is required", !bar.validateBarReady(null, "Looks good").ok && !bar.validateBarReady({ type: "image/jpeg", size: 0 }, "").ok);
check("A non photo file is refused", !bar.validateBarReady({ type: "application/pdf", size: 1000 }, "").ok);
const okBar = bar.validateBarReady({ type: "image/jpeg", size: 250_000 }, "  Two coolers on the left  ");
check("A photo with an optional note is accepted", okBar.ok && okBar.note === "Two coolers on the left");
check("The note is optional", bar.validateBarReady({ type: "image/jpeg", size: 250_000 }, undefined).ok);
const p1 = bar.photoPath("s1", "b1", new Date(1), "image/jpeg");
const p2 = bar.photoPath("s1", "b1", new Date(2), "image/jpeg");
check("Each replacement gets its own photo file", p1 !== p2 && p1.startsWith("s1/b1/"));
check("Admin text", bar.barReadyText({ firstName: "Jordan", eventTitle: "Justin · Wedding", checked: 40, total: 42, missingReported: false, link: "https://x/team/e/s1" }) === "Jordan's bar is ready for Justin · Wedding. 40 of 42 items checked. https://x/team/e/s1");
check("Admin text mentions missing items", bar.barReadyText({ firstName: "Jordan", eventTitle: "T", checked: 1, total: 2, missingReported: true, link: "L" }).includes("Items were reported missing for this event."));
const grouped = bar.groupReports([
  { id: "1", staff_id: "b1", created_at: "2026-12-12T22:10:00Z" },
  { id: "2", staff_id: "b2", created_at: "2026-12-12T22:20:00Z" },
  { id: "3", staff_id: "b1", created_at: "2026-12-12T22:30:00Z" },
]);
check("Replacements are kept, newest first", grouped[0].map((r) => r.id).join(",") === "3,1" && grouped[1][0].id === "2");
const barRoute = readFileSync(new URL("../app/api/team/bar-ready/route.ts", import.meta.url), "utf8");
check("/api/team/bar-ready checks access and arrival time before saving", barRoute.includes("getCurrentStaff()") && barRoute.indexOf("openEvent(") < barRoute.indexOf("submitBarReady(") && barRoute.indexOf("canSubmitBarReady(") < barRoute.indexOf("submitBarReady(") && barRoute.includes("status: 403"));
check("/api/team/bar-ready refuses a missing photo", barRoute.indexOf("validateBarReady(") < barRoute.indexOf("submitBarReady(") && barRoute.includes("status: 400"));
const barDb = readFileSync(new URL("../lib/team/bar-ready-db.ts", import.meta.url), "utf8");
check("Bar photos are shown through signed URLs only", barDb.includes("createSignedUrls(") && !barDb.includes("getPublicUrl"));
const eventPage = readFileSync(new URL("../app/team/e/[id]/page.tsx", import.meta.url), "utf8");
check("Event page loads bar photos only after the access check", eventPage.indexOf("openEvent(") < eventPage.indexOf("barReadyEntries("));

// ----- Phase 2: admin alerts -----
const admins = [
  { id: "a1", role: "admin", active: true, alerts: true },
  { id: "a2", role: "admin", active: true, alerts: false },
  { id: "a3", role: "admin", active: false, alerts: true },
  { id: "a4", role: "admin", active: true, alerts: null },
  { id: "a5", role: "admin", active: true },
  { id: "b1", role: "bartender", active: true, alerts: true },
];
check("Alert texts go only to active admins with alerts on", asg.alertRecipients(admins).map((a) => a.id).join(",") === "a1,a4,a5");
check("Alerts are on by default", asg.alertRecipients([{ id: "x", role: "admin", active: true }]).length === 1);
const eventsLib = readFileSync(new URL("../lib/team/events.ts", import.meta.url), "utf8");
check("alertAdmins filters by the alerts setting", /export async function alertAdmins[\s\S]*?alertRecipients\(/.test(eventsLib) && !eventsLib.includes("activeAdmins"));
const missingSrc = readFileSync(new URL("../app/api/team/missing/route.ts", import.meta.url), "utf8");
const asgDb = readFileSync(new URL("../lib/team/assignments-db.ts", import.meta.url), "utf8");
check("Missing items text uses alertAdmins", missingSrc.includes("await alertAdmins()"));
check("Bar ready text uses alertAdmins", barDb.includes("await alertAdmins()"));
check("Decline text uses alertAdmins", /response === "decline"[\s\S]*?await alertAdmins\(\)/.test(asgDb));
const migration = readdirSync(new URL("../supabase/migrations/", import.meta.url)).map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8")).join("\n");
check("The alerts column defaults to on", /add column if not exists alerts boolean not null default true/.test(migration));

// ----- Phase 2: assignments -----
check("Offered staff can accept or decline", asg.canRespond("offered", "accept") && asg.canRespond("offered", "decline"));
check("Accepted staff can still decline but not accept again", asg.canRespond("accepted", "decline") && !asg.canRespond("accepted", "accept"));
check("Declined staff cannot respond", !asg.canRespond("declined", "accept") && !asg.canRespond("declined", "decline"));
check("Staff with no assignment cannot respond", !asg.canRespond(null, "accept"));
check("Responses set the status", asg.statusAfter("accept") === "accepted" && asg.statusAfter("decline") === "declined");
const c3 = asg.staffingCounts(3, ["accepted", "offered", "declined"]);
check("Counts: declined staff do not count as assigned", c3.assigned === 2 && c3.accepted === 1 && c3.offered === 1 && c3.declined === 1 && c3.stillNeeded === 1);
check("Counts: label", asg.staffingLabel(c3) === "2 of 3 assigned");
check("Counts: never below zero", asg.staffingCounts(1, ["accepted", "accepted"]).stillNeeded === 0);
check("Counts: unknown need", asg.staffingCounts(null, ["offered"]).stillNeeded === 0 && asg.staffingLabel(asg.staffingCounts(null, ["offered"])) === "1 assigned");
check("Bartenders needed uses the saved count, then the staffing rule", view.bartendersNeeded({ id: "x", event_data: { bartenders: 3, guest_count: 50 } }) === 3 && view.bartendersNeeded({ id: "x", event_data: { guest_count: 150 } }) === 2);
check(
  "Assign text",
  asg.assignText({ firstName: "Jordan", date: "Sat, Dec 12", arrival: "4:00 PM", link: "https://x/team/e/s1" }) ===
    "Hi Jordan, you have a new Mix Fix event on Sat, Dec 12, arrive 4:00 PM. Accept or decline here: https://x/team/e/s1",
);
check("Removal text", asg.removalText({ firstName: "Jordan", date: "Sat, Dec 12" }).startsWith("Hi Jordan, you are no longer scheduled for the Mix Fix event on Sat, Dec 12."));
check("Decline text links to the admin event page", asg.declineText({ firstName: "Jordan", title: "Justin · Wedding", date: "Sat, Dec 12", link: "https://x/team/admin/e/s1" }).includes("Jordan declined Justin · Wedding on Sat, Dec 12"));
check("Update text", asg.updateText({ date: "Sat, Dec 12", link: "https://x/team/e/s1" }) === "Your event on Sat, Dec 12 was updated. Check your event page: https://x/team/e/s1");
check("Assign and decline texts carry no client last name", !asg.assignText({ firstName: "Jordan", date: "d", arrival: "a", link: "l" }).includes("Butler"));

// ----- Phase 2: staff list -----
const vs = asg.validateStaffInput({ first: " Jordan ", last: "Lee", phone: "(214) 555-0101", role: "bartender" }, codes.normalizePhone);
check("Staff form cleans the name and phone", vs.ok && vs.value.name === "Jordan Lee" && vs.value.phone === "+12145550101");
check("Staff form needs a first and last name", !asg.validateStaffInput({ first: "Jordan", last: "", phone: "2145550101" }, codes.normalizePhone).ok);
check("Staff form needs a real phone", !asg.validateStaffInput({ first: "A", last: "B", phone: "555" }, codes.normalizePhone).ok);
check("Staff form refuses an unknown role", !asg.validateStaffInput({ first: "A", last: "B", phone: "2145550101", role: "owner" }, codes.normalizePhone).ok);
check("Admins cannot deactivate themselves", asg.selfChangeError("a1", "a1", { active: false }) !== null);
check("Admins cannot drop their own admin role", asg.selfChangeError("a1", "a1", { role: "bartender" }) !== null);
check("Admins can change other people", asg.selfChangeError("a1", "b1", { active: false, role: "bartender" }) === null);
check("Admins can edit their own name and alerts", asg.selfChangeError("a1", "a1", { role: "admin" }) === null);
check("Deactivating signs the person out", asgDb.includes('if (patch.active === false) await supabase.from("staff_sessions").delete()'));

// ----- Phase 2: admin routes and pages are admin only -----
for (const route of ["admin/staff", "admin/assign"]) {
  const src = readFileSync(new URL(`../app/api/team/${route}/route.ts`, import.meta.url), "utf8");
  check(`/api/team/${route} is admin only`, src.includes("getCurrentStaff()") && src.includes('role !== "admin"') && src.includes("status: 403"));
}
for (const page of ["admin/events/page.tsx", "admin/e/[id]/page.tsx", "admin/staff/page.tsx"]) {
  const src = readFileSync(new URL(`../app/team/${page}`, import.meta.url), "utf8");
  check(`/team/${page.replace("/page.tsx", "")} requires an admin`, src.includes("await requireAdmin("));
}
check("requireAdmin sends bartenders away", authSrc.includes('if (staff.role !== "admin") redirect("/team/events")'));
const respondSrc = readFileSync(new URL("../app/api/team/respond/route.ts", import.meta.url), "utf8");
check("/api/team/respond needs a signed in staff member", respondSrc.includes("getCurrentStaff()") && respondSrc.includes("status: 401"));
check("Responding needs an assignment", /if \(!status\) return \{ ok: false, error: "You are not assigned to this event.", status: 403 \}/.test(asgDb));
for (const dir of ["../app/team/admin/events/", "../app/team/admin/e/[id]/", "../app/team/admin/staff/"]) {
  for (const file of readdirSync(new URL(dir, import.meta.url)).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(new URL(`${dir}${file}`, import.meta.url), "utf8");
    check(`${dir.replace("../", "")}${file} reads no client email or pricing fields`, !/\.(email|booked_price|payment_preference|promo_code|gratuity|deposit_paid)\b/.test(src));
  }
}

// ----- Phase 2: texts on client updates -----
const sentTo: string[] = [];
const okDeps = {
  assignedStaff: async () => [{ phone: "+12145550101", name: "Jordan Lee" }, { phone: "+12145550103", name: "Sam Diaz" }],
  send: async (phone: string, _n: string, msg: string) => (sentTo.push(`${phone}|${msg}`), true),
};
const upd = { id: "s1", event_data: { event_date: "2026-12-12" } };
const nSent = await asg.notifyAssignedStaff(upd, ["guest_count"], "https://x", okDeps);
check("A client update texts every assigned staff member", nSent === 2 && sentTo.every((t) => t.endsWith("|Your event on Sat, Dec 12 was updated. Check your event page: https://x/team/e/s1")), sentTo.join(" / "));
sentTo.length = 0;
check("Updates staff cannot see send no text", (await asg.notifyAssignedStaff(upd, ["payment_preference", "email"], "https://x", okDeps)) === 0 && sentTo.length === 0);
const quiet = console.error;
console.error = () => {};
let threw = false;
try {
  const r1 = await asg.notifyAssignedStaff(upd, ["guest_count"], "https://x", { assignedStaff: async () => { throw new Error("db down"); }, send: okDeps.send });
  const r2 = await asg.notifyAssignedStaff(upd, ["guest_count"], "https://x", { assignedStaff: okDeps.assignedStaff, send: async () => { throw new Error("sms down"); } });
  check("A failed lookup or text never throws", r1 === 0 && r2 === 0);
} catch {
  threw = true;
}
console.error = quiet;
check("Update texts never block the update", !threw);
const deliverySrc = readFileSync(new URL("../lib/update-delivery.ts", import.meta.url), "utf8");
check("Update delivery sends staff texts alongside the GHL delivery", deliverySrc.includes("notifyStaffOfUpdate(session, changedFields, opts.staffOrigin).catch(() => 0)"));
const chatSrc = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
check("The chat route passes the link origin for staff texts", chatSrc.includes("deliverEventUpdates(session.id, result.rows, { staffOrigin: origin })"));
const retrySrc = readFileSync(new URL("../app/api/update-webhook/route.ts", import.meta.url), "utf8");
check("The manual retry does not text staff again", retrySrc.includes("deliverEventUpdates(sessionId, rows)") && !retrySrc.includes("staffOrigin"));

// ----- Phase 2: hidden events -----
check("An event with nobody assigned can be hidden", asg.hideError([]) === null && asg.hideError(["declined"]) === null);
check("An event with assigned staff cannot be hidden", asg.hideError(["offered"]) === asg.HIDE_HAS_STAFF && asg.hideError(["declined", "accepted"]) === asg.HIDE_HAS_STAFF);
check("The refusal says to remove them first", asg.HIDE_HAS_STAFF === "Remove the assigned staff first, then hide this event.");
check("Hidden events drop out of a list", asg.withoutHidden([{ id: "a" }, { id: "b" }, { id: "c" }], new Set(["b"])).map((i) => i.id).join(",") === "a,c");
const hiddenSrc = readFileSync(new URL("../lib/team/hidden.ts", import.meta.url), "utf8");
check("Hiding refuses when staff are assigned", hiddenSrc.indexOf("hideError(") < hiddenSrc.indexOf('.from("team_hidden_events")\n    .upsert'));
check("Hiding never deletes or edits the session", !/from\("sessions"\)/.test(hiddenSrc) && !/from\("event_assignments"\)\s*\.(delete|update)/.test(hiddenSrc));
check("Unhiding only deletes the hidden row", /unhideEvent[\s\S]*from\("team_hidden_events"\)\.delete\(\)/.test(hiddenSrc));
const hideRoute = readFileSync(new URL("../app/api/team/admin/hide/route.ts", import.meta.url), "utf8");
check("/api/team/admin/hide is admin only", hideRoute.includes("getCurrentStaff()") && hideRoute.includes('role !== "admin"') && hideRoute.includes("status: 403"));
check("Hidden events cannot be assigned", /assignStaff[\s\S]*?if \(await isHidden\(session\.id\)\) return \{ ok: false/.test(asgDb));
const staffEventsSrc = readFileSync(new URL("../app/team/events/page.tsx", import.meta.url), "utf8");
check("Hidden events are left out of /team/events", staffEventsSrc.includes("withoutHidden(all, hidden)"));
const adminEventsSrc = readFileSync(new URL("../app/team/admin/events/page.tsx", import.meta.url), "utf8");
check("Hidden events are left out of staffing and its needs count", adminEventsSrc.includes("const visible = withoutHidden(allSessions, hidden);") && adminEventsSrc.includes("? visible.filter(") && adminEventsSrc.indexOf("withoutHidden(allSessions") < adminEventsSrc.indexOf("const open ="));
check("The staffing page links to Hidden events", adminEventsSrc.includes('href="/team/admin/events?hidden=1"'));
const hideAction = readFileSync(new URL("../app/team/admin/e/[id]/hide-action.tsx", import.meta.url), "utf8");
check("Hiding asks to confirm first", hideAction.includes("Yes, hide it") && hideAction.indexOf("setConfirming(true)") > 0);
const adminEventPage = readFileSync(new URL("../app/team/admin/e/[id]/page.tsx", import.meta.url), "utf8");
check("A hidden event shows Unhide instead of the assign panel", /hidden \? \(\s*<>[\s\S]*?<HideAction sessionId=\{id\} hidden \/>\s*<\/>\s*\) : \(/.test(adminEventPage) && adminEventPage.indexOf("<AssignPanel") > adminEventPage.indexOf("<HideAction sessionId={id} hidden />"));

// ----- Phase 3: time clock rules -----
const venue = { lat: 32.7767, lng: -96.797 }; // downtown Dallas
const near = { lat: 32.7777, lng: -96.797, accuracy: 15 }; // about 110 m north
const far = { lat: 32.7867, lng: -96.797, accuracy: 15 }; // about 1.1 km north
check("Distance is in meters", Math.abs(clock.distanceMeters(venue, near) - 111) < 3, String(clock.distanceMeters(venue, near)));
const clean = clock.punchFlags({ phone: near, event: venue, late: false });
check("Within 300 m is clean", clean.flags.length === 0 && clean.distance === 111, JSON.stringify(clean));
const farFlags = clock.punchFlags({ phone: far, event: venue, late: false });
check("Farther than 300 m is flagged", farFlags.flags.includes("far") && farFlags.distance! > 1000);
check("Exactly at the limit is clean", !clock.punchFlags({ phone: { lat: venue.lat + 300 / 111_195, lng: venue.lng, accuracy: 5 }, event: venue, late: false }).flags.includes("far"));
check("No phone location is flagged, not refused", clock.punchFlags({ phone: null, event: venue, late: false }).flags.join() === "no_location");
check("An address not on the map is flagged", clock.punchFlags({ phone: near, event: null, late: false }).flags.join() === "no_event_location");
check("Bad coordinates count as no location", clock.cleanLocation({ lat: "x", lng: 1 }) === null && clock.cleanLocation({ lat: 91, lng: 0 }) === null && clock.cleanLocation(null) === null && clock.cleanLocation({ lat: null, lng: null }) === null);
const recv = new Date("2026-12-12T23:00:00Z");
check("A punch sent right away counts at the server time", clock.punchTime(new Date(recv.getTime() - 20_000).toISOString(), recv).punchedAt.getTime() === recv.getTime() && !clock.punchTime(new Date(recv.getTime() - 20_000).toISOString(), recv).late);
const lateP = clock.punchTime("2026-12-12T22:30:00Z", recv);
check("A queued punch keeps its tap time and is flagged sent late", lateP.late && lateP.punchedAt.toISOString() === "2026-12-12T22:30:00.000Z");
check("A phone clock ahead of ours never makes a future punch", clock.punchTime("2026-12-13T01:00:00Z", recv).punchedAt.getTime() === recv.getTime());
check("Sent late shows as a flag", clock.punchFlags({ phone: near, event: venue, late: true }).flags.includes("sent_late"));
const evClock = { event_date: "2026-12-12", bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_type: "Birthday" };
check("Clock in opens 30 minutes before arrival", clock.clockInOpensAt(evClock)?.toISOString() === "2026-12-12T21:30:00.000Z"); // arrival 4:00 PM, opens 3:30 PM Chicago
check("Weddings open 30 minutes before the 3 hour arrival", clock.clockInOpensAt({ ...evClock, event_type: "Wedding" })?.toISOString() === "2026-12-12T20:30:00.000Z");
const opens = clock.clockInOpensAt(evClock);
check("Clock in before the window is refused", !clock.checkPunch("in", [], new Date("2026-12-12T21:29:00Z"), opens).ok);
check("Clock in in the window is allowed", clock.checkPunch("in", [], new Date("2026-12-12T21:30:00Z"), opens).ok);
const inRow = [{ type: "in" as const, punched_at: "2026-12-12T21:45:00Z" }];
check("No double clock in", !clock.checkPunch("in", inRow, new Date("2026-12-12T22:00:00Z"), opens).ok);
check("No clock out before clock in", !clock.checkPunch("out", [], new Date("2026-12-12T22:00:00Z"), opens).ok);
check("Clock out after clock in is allowed", clock.checkPunch("out", inRow, new Date("2026-12-13T05:00:00Z"), opens).ok);
check("No double clock out", !clock.checkPunch("out", [...inRow, { type: "out", punched_at: "2026-12-13T05:00:00Z" }], new Date("2026-12-13T05:10:00Z"), opens).ok);
check("A clock out time before the clock in is refused", !clock.checkPunch("out", inRow, new Date("2026-12-12T21:00:00Z"), opens).ok);
check("Hours across midnight", clock.workedMinutes("2026-12-31T20:00:00-06:00", "2027-01-01T01:30:00-06:00") === 330 && clock.formatWorked(330) === "5h 30m");
check("Hours are to the minute", clock.workedMinutes("2026-12-12T22:01:00Z", "2026-12-13T04:14:40Z") === 374);
check("Hours across the fall time change", clock.workedMinutes("2026-11-01T00:30:00-05:00", "2026-11-01T02:30:00-06:00") === 180);
check("Out before in counts as no time", clock.workedMinutes("2026-12-12T22:00:00Z", "2026-12-12T21:00:00Z") === 0);
// Reminder: service ends 10:00 PM, plus an hour of breakdown, plus 30 minutes = 11:30 PM Chicago.
check("Clock out reminder waits for end plus breakdown plus 30 minutes", !clock.clockOutReminderDue(evClock, new Date("2026-12-13T05:29:00Z")) && clock.clockOutReminderDue(evClock, new Date("2026-12-13T05:30:00Z")));
check("Clock out reminder for service past midnight", clock.clockOutReminderAt({ ...evClock, bar_service_end: "1:00am" })?.toISOString() === "2026-12-13T08:30:00.000Z");
check("Clock out reminder text", clock.clockOutReminderText({ firstName: "Jordan", title: "Justin · Wedding", link: "L" }) === "Hi Jordan, you are still clocked in for Justin · Wedding. Clock out here when you are done: L");
// Late setup: service starts 6:00 PM Chicago, alert from 5:30 PM.
const lsNo = { hasStaff: true, hasBarReady: false };
check("Late setup alert from 30 minutes before service", !clock.lateSetupDue(evClock, new Date("2026-12-12T23:29:00Z"), lsNo) && clock.lateSetupDue(evClock, new Date("2026-12-12T23:30:00Z"), lsNo));
check("No late setup alert once a bar ready check in is in", !clock.lateSetupDue(evClock, new Date("2026-12-12T23:45:00Z"), { hasStaff: true, hasBarReady: true }));
check("No late setup alert without assigned staff", !clock.lateSetupDue(evClock, new Date("2026-12-12T23:45:00Z"), { hasStaff: false, hasBarReady: false }));
check("No late setup alert for events long past", !clock.lateSetupDue(evClock, new Date("2026-12-13T03:00:00Z"), lsNo));
check(
  "Late setup text",
  clock.lateSetupText({ title: "Justin · Wedding", startTime: "6:00 PM", link: "https://x/team/admin/e/s1" }) === "No bar ready check in yet for Justin · Wedding, service starts at 6:00 PM. https://x/team/admin/e/s1",
);
check("Nobody edits or approves their own time", !clock.canChangeTime("a1", "a1") && clock.canChangeTime("a1", "b1") && !clock.canChangeTime("", "b1"));
const clockMig = readFileSync(new URL("../supabase/migrations/20261115_time_clock.sql", import.meta.url), "utf8");
check("The database refuses own edits and approvals", clockMig.includes("check (edited_by <> staff_id)") && clockMig.includes("check (approved_by <> staff_id)"));
check("The database refuses double punches", clockMig.includes("unique (assignment_id, type)"));
check("Edits need a reason in the database", clockMig.includes("reason         text        not null check (length(btrim(reason)) >= 3)"));
check("staff_id always comes from the assignment", clockMig.includes("new.staff_id := a.staff_id;"));
const punchRoute = readFileSync(new URL("../app/api/team/punch/route.ts", import.meta.url), "utf8");
check("/api/team/punch checks access before saving", punchRoute.includes("getCurrentStaff()") && punchRoute.indexOf("openEvent(") < punchRoute.indexOf("recordPunch(") && punchRoute.includes("status: 403"));
const cronRoute = readFileSync(new URL("../app/api/cron/team/route.ts", import.meta.url), "utf8");
check("The cron route needs the cron secret", cronRoute.includes("Bearer ${secret}") && cronRoute.includes("if (!secret ||"));
check("The cron runs every job, each on its own", cronRoute.includes("Promise.allSettled([sendClockOutReminders(now), sendLateSetupAlerts(now), sendShortShiftAlerts(now)])") && cronRoute.includes("Promise.allSettled([fillMarkets()])"));
const vercelJson = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
check("Vercel cron every 15 minutes", vercelJson.crons?.[0]?.path === "/api/cron/team" && vercelJson.crons?.[0]?.schedule === "*/15 * * * *");
check("Staff who clocked in cannot be removed", /removeStaff[\s\S]*?if \(await hasPunches\(session\.id, staffId\)\)/.test(asgDb));
check("Staff who clocked in cannot decline", /response === "decline" && \(await hasPunches\(sessionId, staff\.id\)\)/.test(asgDb));

if (failed > 0) {
  console.error(`\n${failed} of ${total} team checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} team checks pass.`);
