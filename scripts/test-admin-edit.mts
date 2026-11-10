// Admin edit of event details, run through the real update path against an
// in-memory database (scripts/fake-supabase.mts) with fetch stubbed, so the
// GHL note, the update webhook, and staff texts can be checked without sending
// anything. Run: node --no-warnings scripts/test-admin-edit.mts

import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase") return nextResolve(new URL("./fake-supabase.mts", import.meta.url).href, context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

process.env.GHL_API_TOKEN = "test";
process.env.GHL_LOCATION_ID = "test";
process.env.GHL_UPDATE_WEBHOOK_URL = "https://hooks.test/update";
process.env.GHL_STAFF_SMS_WEBHOOK = "https://hooks.test/staff-sms";

interface Call {
  url: string;
  body: Record<string, unknown>;
}
const calls: Call[] = [];
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  let body: Record<string, unknown> = {};
  try {
    body = init?.body ? JSON.parse(String(init.body)) : {};
  } catch {
    body = {};
  }
  calls.push({ url, body });
  const json = url.includes("/contacts") && !url.includes("/notes") ? { contacts: [{ id: "contact-1" }], contact: { id: "contact-1" } } : { ok: true };
  return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const quietLog = console.log;
console.log = () => {}; // the list generators log the whole event

const { db } = await import("./fake-supabase.mts");
const updates = await import("../lib/event-updates.ts");
const editDb = await import("../lib/team/admin-edit-db.ts");
const edit = await import("../lib/team/admin-edit.ts");
const view = await import("../lib/team/event-view.ts");
const shop = await import("../lib/team/shopping.ts");
const lists = await import("../lib/shopping-list.ts");
const time = await import("../lib/team/time.ts");

let failed = 0;
let total = 0;
function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  quietLog(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}

// An event three days out: inside the client's six day cutoff.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const today = time.chicagoToday();
const [ty, tm, td] = today.split("-").map(Number);
const soon = new Date(Date.UTC(ty, tm - 1, td + 3));
const SOON = `${MONTHS[soon.getUTCMonth()]} ${soon.getUTCDate()}, ${soon.getUTCFullYear()}`;
const SOON_FORM = soon.toISOString().slice(0, 10);

const CLIENT_PHONE = "+12145550199";
const admin = { id: "admin-1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const bartender = { id: "bart-1", name: "Jordan Lee", phone: "+12145550101", role: "bartender" as const, active: true };

function baseEvent() {
  return {
    client_name: "Alex Butler",
    email: "alex@example.com",
    phone: CLIENT_PHONE,
    event_type: "Birthday",
    event_date: SOON,
    bar_service_start: "6:00pm",
    bar_service_end: "10:00pm",
    hours_booked: 4,
    guest_count: 100,
    package: "Full Bar",
    event_address: "123 Elm St, Dallas, TX 75201",
    parking_info: "Driveway",
    day_of_contact_name: "Sam",
    day_of_contact_phone: "469-555-0123",
    special_requests: "",
    signature_drinks: [
      { name: "Mule", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.5 oz lime juice", "Top with ginger beer"], garnish: "lime wheel" },
      { name: "Margarita", base_spirit: "tequila", ingredients: ["2 oz tequila", "1 oz lime juice", "0.75 oz agave"], garnish: "lime wheel" },
    ],
  };
}

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    {
      id: "s1",
      name: "Alex Butler",
      email: "alex@example.com",
      event_date: SOON,
      package_type: "Full Bar",
      guest_count: "100",
      event_name: null,
      hours_booked: "4",
      status: "submitted",
      event_data: baseEvent(),
      version: 1,
      submitted_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      booked_price: null, // the engine computes what was booked
    },
  ];
  db.event_updates = [];
  db.staff = [admin, bartender];
  db.event_assignments = [{ id: "as-1", session_id: "s1", staff_id: bartender.id, status: "accepted" }];
  calls.length = 0;
}

const session = () => db.sessions[0] as Record<string, unknown> & { event_data: Record<string, unknown>; version: number; booked_price: Record<string, unknown> | null };
const origin = "https://plan.test";

// ----- Keep the booked total -----
reset();
const before = baseEvent();
const preview = await editDb.previewAdminEdit("s1", { guest_count: "150" });
check("Preview shows the engine's difference before saving", preview.ok && preview.preview.priced && preview.preview.engineAmount !== null && preview.preview.engineAmount > 0, JSON.stringify(preview));
check("Preview saves nothing", session().version === 1 && db.event_updates.length === 0);
const bookedBefore = preview.ok ? preview.preview.bookedTotal : null;
const engineNew = preview.ok ? preview.preview.engineNewTotal : null;

const keep = await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { guest_count: "150" }, price: { mode: "keep" }, expectedVersion: 1, origin });
check("Admin edit saves", keep.ok, JSON.stringify(keep));
check("The version goes up", session().version === 2);
check("The guest count is saved", session().event_data.guest_count === 150 && session().guest_count === "150");
const row = db.event_updates.at(-1) as Record<string, unknown>;
check("An event_updates row is recorded for the new version", !!row && row.version === 2 && row.applied === true);
check("The row is marked as made by that admin", row.updated_by === "admin" && row.updated_by_name === "Kenneth" && row.updated_by_staff_id === admin.id);
check("Keep: the booked total stays as is", session().booked_price?.total === bookedBefore, `${session().booked_price?.total} vs ${bookedBefore}`);
const keepPrice = row.change_order as Record<string, unknown>;
check("Keep: the price change records no difference", keepPrice?.amount === 0 && keepPrice?.new_total === bookedBefore && String(keepPrice?.price_text).startsWith("Kenneth kept the booked total"));

const hook = calls.find((c) => c.url === "https://hooks.test/update");
check("The update webhook is sent", !!hook);
check("The webhook says updated_by admin with the admin's first name", hook?.body.updated_by === "admin" && hook?.body.updated_by_name === "Kenneth", JSON.stringify({ by: hook?.body.updated_by, name: hook?.body.updated_by_name }));
const note = calls.find((c) => c.url.includes("/notes"));
check("The GHL note is created and names the admin", !!note && String(note.body.body ?? "").includes("Updated by admin: Kenneth"));
const newEd = session().event_data;
check(
  "The webhook carries shopping lists rebuilt for the new guest count",
  hook?.body.shopping_list === lists.formatShoppingListForNote(lists.generateShoppingList(newEd as never), newEd as never) &&
    hook?.body.shopping_list !== lists.formatShoppingListForNote(lists.generateShoppingList(before as never), before as never),
);
check(
  "The staff shopping list follows the new guest count",
  JSON.stringify(shop.buildStaffShopping(newEd)) !== JSON.stringify(shop.buildStaffShopping(before)),
);
const texts = calls.filter((c) => c.url === "https://hooks.test/staff-sms");
check("Assigned staff are texted about the change", texts.length === 1 && texts[0].body.phone === bartender.phone && String(texts[0].body.message).includes("was updated. Check your event page: https://plan.test/team/e/s1"), JSON.stringify(texts));
check("The client is never messaged", !calls.some((c) => JSON.stringify(c.body).includes(CLIENT_PHONE) && c.url.includes("staff-sms")) && !texts.some((t) => t.body.phone === CLIENT_PHONE));
check("The edit inside six days is still saved (no cutoff for admins)", time.eventDay(SOON) !== null && keep.ok);

// ----- Apply the pricing engine's difference -----
reset();
const eng = await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { guest_count: "150" }, price: { mode: "engine" }, expectedVersion: 1, origin });
const engRow = db.event_updates.at(-1) as Record<string, unknown>;
const engPrice = engRow?.change_order as Record<string, unknown>;
check("Engine: saves", eng.ok);
check("Engine: the booked total moves to the engine's new total", session().booked_price?.total === engineNew && engineNew !== bookedBefore, `${session().booked_price?.total} vs ${engineNew}`);
check("Engine: the difference matches the preview", engPrice?.amount === (preview.ok ? preview.preview.engineAmount : NaN));
const engHook = calls.find((c) => c.url === "https://hooks.test/update");
check("Engine: the webhook carries the difference", engHook?.body.pending_change_amount === engPrice?.amount);

// ----- Enter a new total by hand -----
reset();
const man = await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { guest_count: "150" }, price: { mode: "manual", total: "2,000" }, expectedVersion: 1, origin });
const manPrice = (db.event_updates.at(-1) as Record<string, unknown>)?.change_order as Record<string, unknown>;
check("Manual: saves", man.ok);
check("Manual: the booked total is the admin's total", session().booked_price?.total === 2000 && session().booked_price?.custom_price === 2000);
check("Manual: the difference is from the old booked total", bookedBefore !== null && manPrice?.amount === 2000 - bookedBefore && manPrice?.new_total === 2000);
check("Manual: a missing or bad total is refused", !edit.cleanPriceChoice({ mode: "manual", total: "" }).ok && !edit.cleanPriceChoice({ mode: "manual", total: "abc" }).ok);
check("A price choice is required", !edit.cleanPriceChoice({}).ok && !edit.cleanPriceChoice({ mode: "half" }).ok);

// ----- Needed bartenders follow the guest count -----
reset();
await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { guest_count: "260" }, price: { mode: "engine" }, expectedVersion: 1, origin });
check("The needed bartender count is refreshed", view.bartendersNeeded(session() as never) === 3, String(view.bartendersNeeded(session() as never)));
reset();
await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { bartenders: "4" }, price: { mode: "keep" }, expectedVersion: 1, origin });
check("An admin can set the bartender count directly", view.bartendersNeeded(session() as never) === 4);

// ----- Fields that are not priced, and drinks -----
reset();
const plain = await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { parking_info: "Street parking only", day_of_contact_name: "Jordan" }, price: { mode: "keep" }, expectedVersion: 1, origin });
const plainRow = db.event_updates.at(-1) as Record<string, unknown>;
check("Unpriced fields save with no price change", plain.ok && !plainRow.change_order && session().event_data.parking_info === "Street parking only");
reset();
const drinks = edit.cleanAdminEdit({ signature_drinks: [], dive_menu_requested: true, guest_count: "120" }, "Full Bar");
check("The form never changes signature drinks", drinks.ok && !("signature_drinks" in drinks.partial) && !("dive_menu_requested" in drinks.partial));
const onlyDrinks = edit.cleanAdminEdit({ signature_drinks: [] }, "Full Bar");
check("A drinks only edit is refused as nothing to save", !onlyDrinks.ok);

// ----- The cutoff does not apply -----
reset();
const drinkChange = { signature_drinks: [{ name: "Paloma", base_spirit: "tequila", ingredients: ["2 oz tequila", "Top with grapefruit soda"] }, baseEvent().signature_drinks[1]] };
const clientTry = await updates.applyEventUpdate("s1", drinkChange as never, {});
check("Control: the client path refuses drink changes inside six days", clientTry?.refusedDrinks === true && session().version === 1);
const adminTry = await updates.applyEventUpdate("s1", drinkChange as never, { ignoreCutoff: true, editor: { name: "Kenneth", staffId: admin.id } });
check("With the admin option the six day cutoff is not applied", adminTry?.refusedDrinks === false && session().version === 2);
const dateEdit = await (async () => {
  reset();
  return editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { event_date: SOON_FORM, bar_service_start: "17:00" }, price: { mode: "keep" }, expectedVersion: 1, origin });
})();
check("Times inside six days save in the stored format", dateEdit.ok && session().event_data.bar_service_start === "5:00pm");

// ----- Stale form -----
reset();
const stale = await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { guest_count: "150" }, price: { mode: "keep" }, expectedVersion: 0, origin });
check("A form opened before another change is refused", !stale.ok && stale.status === 409 && session().version === 1);

// ----- Form cleaning -----
check("Dates go in the stored format", edit.formDateToEvent("2026-12-05") === "December 5, 2026" && edit.formDateToEvent("2026-02-30") === null);
check("Times go in the stored format", edit.formTimeToEvent("18:30") === "6:30pm" && edit.formTimeToEvent("00:00") === "12:00am" && edit.formTimeToEvent("12:15") === "12:15pm");
check("Guest count must be a whole number", !edit.cleanAdminEdit({ guest_count: "lots" }, "Full Bar").ok);
check("Package must be from the list or the current one", !edit.cleanAdminEdit({ package: "Mystery Bar" }, "Full Bar").ok && edit.cleanAdminEdit({ package: "Bartender Only" }, "Bartender Only").ok);

// ----- Admin only -----
const route = readFileSync(new URL("../app/api/team/admin/event-edit/route.ts", import.meta.url), "utf8");
check("/api/team/admin/event-edit is admin only", route.includes("getCurrentStaff()") && route.includes('role !== "admin"') && route.includes("status: 403") && route.indexOf("await admin()") < route.indexOf("saveAdminEdit("));
const page = readFileSync(new URL("../app/team/admin/e/[id]/page.tsx", import.meta.url), "utf8");
check("The edit form is on an admin only page", page.includes("await requireAdmin(") && page.includes("<EditEvent"));
const editDbSrc = readFileSync(new URL("../lib/team/admin-edit-db.ts", import.meta.url), "utf8");
check("The admin path never calls the client messaging routes", !/save-event|\/api\/webhook|sendEmail|createSession/.test(editDbSrc));

console.log = quietLog;
if (failed > 0) {
  console.error(`\n${failed} of ${total} admin edit checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} admin edit checks pass.`);
