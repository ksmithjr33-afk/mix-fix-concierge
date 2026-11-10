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
check("Checklist has the two groups", fullList.map((g) => g.title).join(" / ") === "The Mix Fix provides / You bring");
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

if (failed > 0) {
  console.error(`\n${failed} of ${total} team checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} team checks pass.`);
