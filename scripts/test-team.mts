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

if (failed > 0) {
  console.error(`\n${failed} of ${total} team checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} team checks pass.`);
