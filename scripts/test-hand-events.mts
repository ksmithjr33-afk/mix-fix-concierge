// Events an admin adds by hand: "Save as a confirmed event" records the event
// exactly as if the client finished the concierge (events list, calendar,
// market, shopping list, supplies list, checklist, recipes), "Save and send
// the client the concierge link" creates the booking only, nothing ever
// messages the client, the GHL payload says created_by "admin" with the
// admin's name, the same client and date warns first, the drinks follow the
// concierge's package rules, and only admins can do any of it.
// Run: node --no-warnings scripts/test-hand-events.mts

import { registerHooks } from "node:module";
import { addDays, check, done, hooks, src, texts } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

process.env.GHL_WEBHOOK_URL = "https://hooks.test/intake";
process.env.GHL_UPDATE_WEBHOOK_URL = "https://hooks.test/update";

const { db } = await import("./fake-supabase.mts");
const manualDb = await import("../lib/manual-event-db.ts");
const manual = await import("../lib/manual-event.ts");
const catalog = await import("../lib/menu-catalog.ts");
const cldb = await import("../lib/client-list-db.ts");
const cl = await import("../lib/client-list.ts");
const updates = await import("../lib/event-updates.ts");
const delivery = await import("../lib/update-delivery.ts");
const eventList = await import("../lib/team/event-list.ts");
const calendar = await import("../lib/team/calendar.ts");
const supplies = await import("../lib/team/supplies-db.ts");
const checklist = await import("../lib/team/checklist-config.ts");
const time = await import("../lib/team/time.ts");
const stub = await import("./stub-next.mts");
const codes = await import("../lib/team/codes.ts");
const route = await import("../app/api/team/admin/events/route.ts");

const admin = { id: "admin-1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const bartender = { id: "bart-1", name: "Sam Lee", phone: "+12145550101", role: "bartender" as const, active: true };
const today = time.chicagoToday();
const DAY = addDays(today, 30);

function reset(autoSend = true) {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [admin, bartender];
  db.staff_sessions = [];
  db.team_settings = [{ key: cldb.AUTO_SEND_KEY, value: autoSend }];
  hooks.length = 0;
  texts.length = 0;
}

const form = (extra: Record<string, unknown> = {}) => ({
  first_name: "Dana",
  last_name: "Whitfield",
  email: "Dana.W@example.com",
  phone: "(214) 555-0177",
  event_type: "Birthday",
  event_name: "Dana's 50th",
  event_date: DAY,
  bar_service_start: "18:00",
  bar_service_end: "22:00",
  arrival_time: "16:30",
  event_address: "500 Main St, Dallas, TX 75201",
  guest_count: "90",
  package: "Full Bar",
  bartenders: "2",
  theme: "Gatsby",
  event_colors: "Black and gold",
  day_of_contact_name: "Rob",
  day_of_contact_phone: "214-555-0123",
  notes: "Booked by phone in August.",
  beer: true,
  wine: true,
  drinks: [{ key: "craft:French Martini" }, { key: "classic:Old Fashioned" }, { name: "Dana's Punch", ingredients: "1.5 oz rum\n1 oz pineapple juice\n0.5 oz lime juice" }],
  mode: "confirmed",
  ...extra,
});

const session = (id: string) => (db.sessions as Record<string, unknown>[]).find((s) => s.id === id) as (Record<string, unknown> & { event_data: Record<string, unknown> }) | undefined;
const hooksTo = (url: string) => hooks.filter((h) => h.url === url).map((h) => h.body);

// ----- Admins only, on the server -----
reset();
const refused = await manualDb.addManualEvent(bartender, form());
check("A bartender cannot add an event (the library refuses)", !refused.ok && refused.status === 403 && (db.sessions ?? []).length === 0);
const signIn = (staffId: string, token: string) => {
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
};
const post = (body: unknown) => route.POST(new Request("https://plan.test/api/team/admin/events", { method: "POST", body: JSON.stringify(body) }));
stub.stubCookies.clear();
check("Signed out: the route refuses", (await post(form())).status === 401);
signIn("bart-1", "bart-token");
check("Bartender: the route refuses", (await post(form())).status === 403 && (db.sessions ?? []).length === 0);
signIn("admin-1", "admin-token");
stub.stubCookies.set("mf_team_view", "bartender");
check("Admin in Bartender view: the route refuses", (await post(form())).status === 403);
stub.stubCookies.delete("mf_team_view");
const viaRoute = await post(form());
check("Admin: the route saves", viaRoute.status === 200 && (db.sessions ?? []).length === 1);
check("The Add event page is behind requireAdmin", src("app/team/admin/events/new/page.tsx").includes("await requireAdmin(`/team/admin/events/new${date ?"));
check("The admin events page has an Add event button", src("app/team/admin/events/page.tsx").includes('href="/team/admin/events/new"') && src("app/team/admin/events/page.tsx").includes("Add event"));

// ----- Save as a confirmed event -----
reset();
const r = await manualDb.addManualEvent(admin, form());
check("Save as a confirmed event works", r.ok && r.mode === "confirmed", JSON.stringify(r));
const id = r.ok ? r.id : "";
const s = session(id)!;
check("It is a submitted event at version 1, like a finished concierge", s.status === "submitted" && s.version === 1 && !!s.submitted_at);
check("It has the version 1 history row", (db.event_updates as Record<string, unknown>[]).some((u) => u.session_id === id && u.version === 1 && u.summary === "Initial submission"));
check("It has the events table row, like save-event", (db.events ?? []).length === 1);
check("It is marked as added by the admin", s.created_by === "admin" && s.created_by_name === "Kenneth" && s.created_by_staff_id === admin.id);
const ed = s.event_data;
check("event_data matches what the concierge submits", ed.client_name === "Dana Whitfield" && ed.email === "dana.w@example.com" && ed.event_date === time.longDate(DAY).replace(/^\w+, /, "") && ed.bar_service_start === "6:00pm" && ed.bar_service_end === "10:00pm" && ed.guest_count === 90 && ed.package === "Full Bar" && ed.bartenders === 2 && ed.hours_booked === 4, JSON.stringify(ed));
check("Phones are stored cleanly", ed.client_phone === "+12145550177" && ed.day_of_contact_phone === "+12145550123");
const drinks = ed.signature_drinks as Record<string, unknown>[];
check("Menu drinks carry the menu recipe with oz amounts", drinks[0].name === "French Martini" && (drinks[0].ingredients as string[]).includes("2 oz vodka") && drinks[1].name === "Old Fashioned" && (drinks[1].ingredients as string[])[0] === "2 oz whiskey");
check("A custom drink keeps its ingredients and is marked custom", drinks[2].name === "Dana's Punch" && drinks[2].is_custom === true && (drinks[2].ingredients as string[]).length === 3);
check("It gets its market from the address", s.team_market === "dallas" && s.team_market_source === "auto");
const item = eventList.eventListItem(s as never, undefined, { showMarket: true });
check("It appears on the events list", item.title === "Dana · Birthday" && item.subtitle === "Dana's 50th" && item.day === DAY);
check("The typed arrival time is used", item.arrival === "4:30 PM");
check("It appears on the calendar", calendar.calendarGrid("week", DAY, today, [item]).days.find((d) => d.ymd === DAY)?.events[0]?.id === id);
const sup = await supplies.staffSupplies(s as never);
check("It has a supplies list for the bartenders", sup.list.alcohol.length + sup.list.supplies.length > 0);
check("It has recipes for its drinks", sup.recipes.some((rc) => /French Martini/.test(rc.name)) && sup.recipes.some((rc) => /Punch/.test(rc.name)), sup.recipes.map((x) => x.name).join(", "));
check("It has its checklist", checklist.checklistFor(ed.package).length > 0);
check("It has its client shopping list", cl.clientList(ed).sections.length > 0);

// ----- Never messages the client -----
const intake = hooksTo("https://hooks.test/intake");
check("GHL gets the intake payload once, marked created_by admin with the admin's name", intake.length === 1 && intake[0].created_by === "admin" && intake[0].created_by_name === "Kenneth");
check("With auto send on, the client list is still not sent unless ticked", intake[0].client_shopping_list_send === false);
check("No text goes to the client or anyone else", texts.length === 0);
check("No update payload is sent", hooksTo("https://hooks.test/update").length === 0);
check("The decision is logged", ((db.client_list_log ?? []) as Record<string, unknown>[]).some((l) => String(l.detail).includes("added by hand")));

reset();
const MENU_ONLY = [{ key: "craft:French Martini" }, { key: "classic:Old Fashioned" }];
const ticked = await manualDb.addManualEvent(admin, form({ send_list: true, drinks: MENU_ONLY }));
check("Ticking Send the client their list sends the first list", ticked.ok && hooksTo("https://hooks.test/intake")[0].client_shopping_list_send === true);
reset();
await manualDb.addManualEvent(admin, form({ send_list: true }));
check("Ticked with a custom drink: the first list waits for review, like the concierge", hooksTo("https://hooks.test/intake")[0].client_shopping_list_send === false && ((db.client_list_holds ?? []) as Record<string, unknown>[]).some((h) => h.kind === "custom_recipe"));
reset(false);
await manualDb.addManualEvent(admin, form({ send_list: true }));
check("With auto send off, nothing is sent even when ticked", hooksTo("https://hooks.test/intake")[0].client_shopping_list_send === false);

// ----- Everything after works as normal -----
reset();
const later = await manualDb.addManualEvent(admin, form());
const laterId = later.ok ? later.id : "";
hooks.length = 0;
const upd = await updates.applyEventUpdate(laterId, { parking_info: "Garage level 2" }, {});
if (upd) await delivery.deliverEventUpdates(laterId, upd.rows, { staffOrigin: "https://plan.test" });
check("A client update through their link works", upd!.rows.length === 1 && session(laterId)!.event_data.parking_info === "Garage level 2");
check("Later update payloads still say created_by admin", hooksTo("https://hooks.test/update")[0]?.created_by === "admin" && hooksTo("https://hooks.test/update")[0]?.created_by_name === "Kenneth");
check("The manager view shows Added by", src("app/team/admin/e/[id]/page.tsx").includes("Added by {addedBy}"));

// ----- Save and send the client the concierge link -----
reset();
const link = await manualDb.addManualEvent(admin, form({ mode: "link", drinks: [], bar_service_start: "", bar_service_end: "", arrival_time: "", event_address: "", bartenders: "" }));
check("The link option returns the client's concierge link", link.ok && link.mode === "link" && link.link === `https://plan.test/s?id=${link.id}`, JSON.stringify(link));
const ls = link.ok ? session(link.id)! : ({} as Record<string, unknown>);
check("It creates the booking for the concierge to finish", ls.status !== "submitted" && ls.name === "Dana Whitfield" && ls.email === "dana.w@example.com" && ls.package_type === "Full Bar" && ls.guest_count === "90" && ls.created_by === "admin");
check("The link option sends nothing to GHL and texts nobody", hooks.length === 0 && texts.length === 0);
check("When that client finishes, the intake payload says created_by admin", src("app/api/webhook/route.ts").includes("...createdByFields(sessionRow ?? {})"));

// ----- The duplicate warning -----
reset();
await manualDb.addManualEvent(admin, form());
const dup = await manualDb.addManualEvent(admin, form({ email: "dana.w@EXAMPLE.com" }));
check("A second event with the same client email and date warns first and saves nothing", !dup.ok && dup.status === 409 && (dup.duplicate ?? []).length === 1 && (db.sessions as unknown[]).length === 1);
const dupOk = await manualDb.addManualEvent(admin, form({ confirm_duplicate: true }));
check("Save anyway saves the second one", dupOk.ok && (db.sessions as unknown[]).length === 2);
const otherDay = await manualDb.addManualEvent(admin, form({ event_date: addDays(DAY, 1) }));
check("The same client on another date does not warn", otherDay.ok);

// ----- Validation -----
const today2 = today;
const bad = (extra: Record<string, unknown>) => {
  const c = manual.cleanManualEvent(form(extra), today2);
  return c.ok ? "" : c.error;
};
check("A bad date is refused", bad({ event_date: "2026-02-30" }).includes("valid event date"));
check("A past date is refused", bad({ event_date: addDays(today, -1) }).includes("past"));
check("A bad start time is refused", bad({ bar_service_start: "25:00" }).includes("start time"));
check("Service longer than 12 hours is refused", bad({ bar_service_start: "08:00", bar_service_end: "22:00" }).includes("between 1 and 12 hours"));
check("Service that crosses midnight is fine", bad({ bar_service_start: "21:00", bar_service_end: "01:00", arrival_time: "19:00" }) === "");
check("Arrival after service starts is refused", bad({ arrival_time: "19:00" }).includes("Arrival"));
check("A guest count of 0 is refused", bad({ guest_count: "0" }).includes("guest count"));
check("A guest count that is not a number is refused", bad({ guest_count: "about 80" }).includes("guest count"));
check("A bad email is refused", bad({ email: "dana@" }).includes("email"));
check("A bad phone is refused", bad({ phone: "555-01" }).includes("phone"));
check("The Big Day Bar is for weddings only", bad({ package: "The Big Day Bar", drinks: [] }).includes("weddings"));
check("Price fields are optional", bad({}) === "" && bad({ total: "$1,749" }) === "" && bad({ total: "lots" }).includes("amounts"));

// ----- Package rules for drinks, the same as the concierge -----
const GRAT = { booked_on: "2026-11-01" }; // retired packages are on the gratuity model only
check("Essentials Bar: a classic is not on its menu", bad({ ...GRAT, package: "Essentials Bar", drinks: [{ key: "classic:Old Fashioned" }] }).includes("not on the Essentials Bar menu"));
check("Essentials Bar: no mocktails", bad({ ...GRAT, package: "Essentials Bar", drinks: [{ name: "Fizz", ingredients: "soda", is_mocktail: true }] }).includes("Mocktails are only"));
check("Full Bar: a mocktail is fine", bad({ drinks: [{ name: "Fizz", ingredients: "4 oz soda\n1 oz lime juice", is_mocktail: true }] }) === "");
check("Beer and Wine: no signature drinks", bad({ ...GRAT, package: "Beer and Wine", drinks: [{ key: "craft:French Martini" }] }).includes("no signature drinks"));
check("The Big Day Bar: at most 2 plus 3 more", bad({ package: "The Big Day Bar", event_type: "Wedding", drinks: Array(6).fill({ key: "craft:French Martini" }) }).includes("at most 5"));
const dive = manual.cleanManualEvent(form({ package: "Dive Bar", drinks: [{ key: "craft:French Martini" }] }), today2);
check("Dive Bar gets its set menu of five, whatever was picked", dive.ok && (dive.value.eventData.signature_drinks as { name: string }[]).map((d) => d.name).join() === "Margarita,Old Fashioned,Cosmopolitan,Lemon Drop,Moscow Mule" && dive.value.eventData.dive_set_menu === true);
check("The pools match the concierge's sourcing rules", catalog.menuPool("Essentials Bar") === "craft" && catalog.menuPool("The Big Day Bar") === "craft_classics" && catalog.menuPool("Full Bar") === "craft_classics" && catalog.menuPool("Premium Bar") === "craft_classics" && catalog.menuPool("Dive Bar") === "set" && catalog.menuPool("Beer and Wine") === "none");
check("The craft menu is read from the concierge's menu text", catalog.craftDrinks().some((d) => d.name === "Tequila Mucho" && d.ingredients[0] === "2 oz tequila reposado"));

// ----- Booked on and the pricing model -----
{
  const model = (extra: Record<string, unknown>) => {
    const c = manual.cleanManualEvent(form(extra), today2);
    return c.ok ? c.value.pricingModel : `error: ${c.error}`;
  };
  check("Booked on November 23, 2026 defaults to the gratuity model", model({ booked_on: "2026-11-23" }) === "gratuity");
  check("Booked on November 24, 2026 defaults to the service fee model", model({ booked_on: "2026-11-24" }) === "service_fee");
  check("No booked on date: today, so the service fee model", model({}) === "service_fee");
  check("The admin can pick the gratuity model on a new booking", model({ booked_on: "2026-11-24", pricing_model: "gratuity" }) === "gratuity");
  check("The admin can pick the service fee model on an old booking", model({ booked_on: "2026-10-01", pricing_model: "service_fee" }) === "service_fee");
  check("A future booked on date is refused", String(model({ booked_on: addDays(today2, 1) })).includes("future"));
  check("A bad booked on date is refused", String(model({ booked_on: "2026-13-40" })).includes("booked on"));
  check("A made up model is refused", String(model({ pricing_model: "flat" })).includes("pricing model"));
  check("Beer and Wine is not a service fee package", String(model({ package: "Beer and Wine", drinks: [] })).includes("service fee model package"));
  check("Bartender Only is a service fee package", model({ package: "Bartender Only", drinks: [] }) === "service_fee");
  check("Bartender Only is not offered on the gratuity model", String(model({ booked_on: "2026-11-01", package: "Bartender Only", drinks: [] })).includes("Pick a package"));

  const sfPrice = manualDb.bookedPrice({ total: "1500", addons_total: "300", deposit_paid: "250" }, "service_fee", "Full Bar", "2026-11-24T12:00:00Z");
  check("Service fee model price: the fee is carved out of the total less add ons", sfPrice?.pricing_model === "service_fee" && sfPrice.total === 1500 && sfPrice.addons_total === 300 && sfPrice.package_price === 1000 && sfPrice.service_fee === 200 && sfPrice.gratuity === null, JSON.stringify(sfPrice));
  const premium = manualDb.bookedPrice({ total: "1100" }, "service_fee", "Premium Bar");
  check("Premium is 10%", premium?.service_fee === 100 && premium.package_price === 1000 && premium.service_fee_rate === 0.1, JSON.stringify(premium));
  const grat = manualDb.bookedPrice({ package_price: "1000", gratuity: "200", total: "1200" });
  check("Gratuity model price is stored as before", grat?.gratuity === 200 && grat.package_price === 1000 && grat.pricing_model === undefined && grat.service_fee === undefined);

  reset();
  const sf = await manualDb.addManualEvent(admin, form({ booked_on: "2026-11-24", package: "Bartender Only", drinks: [], total: "600" }));
  const sfRow = sf.ok ? session(sf.id) : undefined;
  check("Saved: the session has the service fee model and the booked on date", sfRow?.pricing_model === "service_fee" && sfRow?.booked_on === "2026-11-24", JSON.stringify({ m: sfRow?.pricing_model, b: sfRow?.booked_on }));
  check("Saved: the model is on event_data for the shopping lists", sfRow?.event_data?.pricing_model === "service_fee");
  check("Saved: the booked price is split on the service fee model", (sfRow?.booked_price as Record<string, unknown>)?.service_fee === 100);
  reset();
  const old = await manualDb.addManualEvent(admin, form({ booked_on: "2026-09-01" }));
  const oldRow = old.ok ? session(old.id) : undefined;
  check("Saved: an old booking is on the gratuity model", oldRow?.pricing_model === "gratuity" && oldRow?.booked_on === "2026-09-01");

  // Edit event: Booked on and the model.
  const bm = await import("../lib/booking-model-db.ts");
  const who = { id: admin.id, name: "Kenneth" };
  const before = { package_type: "Full Bar", pricing_model: "gratuity" as const, booked_price: { total: 1200, package_price: 1000, gratuity: 200, addons_total: 0 } as never };
  const toSf = bm.bookedForModel(before, "service_fee", who, "2026-11-24T12:00:00Z");
  check("Edit event, to the service fee model: the fee is carved out of the total, no gratuity", toSf?.pricing_model === "service_fee" && toSf.service_fee === 200 && toSf.package_price === 1000 && toSf.gratuity === null && toSf.total === 1200, JSON.stringify(toSf));
  const back = bm.bookedForModel({ ...before, pricing_model: "service_fee" as const, booked_price: toSf as never }, "gratuity", who, "2026-11-24T12:00:00Z");
  check("Edit event, back to the gratuity model: the total is kept and the fee cleared", back?.pricing_model === "gratuity" && back.total === 1200 && back.service_fee === null);
  check("Edit event, no total yet: only the model moves", bm.bookedForModel({ ...before, booked_price: { tip_jar: true } as never }, "service_fee", who, "x")?.pricing_model === "service_fee");
  check("Edit event, no booked price: stays empty", bm.bookedForModel({ ...before, booked_price: null }, "service_fee", who, "x") === null);

  const id = oldRow?.id as string;
  const today3 = today2;
  const sameModel = await bm.setBookedOnAndModel(id, { booked_on: "2026-09-02", pricing_model: "gratuity" }, who, today3);
  check("Edit event: a new booked on date saves without changing the model", sameModel.ok && !sameModel.changedModel && session(id)?.booked_on === "2026-09-02" && session(id)?.pricing_model === "gratuity");
  const moved = await bm.setBookedOnAndModel(id, { booked_on: "2026-11-24", pricing_model: "service_fee" }, who, today3);
  check("Edit event: changing the model saves it, on event_data too", moved.ok && moved.changedModel && session(id)?.pricing_model === "service_fee" && session(id)?.event_data?.pricing_model === "service_fee");
  check("Edit event: a future booked on date is refused", !(await bm.setBookedOnAndModel(id, { booked_on: addDays(today3, 2), pricing_model: "gratuity" }, who, today3)).ok);
  check("Edit event: a model is required", !(await bm.setBookedOnAndModel(id, { booked_on: "2026-11-01" }, who, today3)).ok);
  db.sessions!.find((s: Record<string, unknown>) => s.id === id)!.price_check = { reason: "x", at: "y" };
  await bm.setBookedOnAndModel(id, { pricing_model: "service_fee" }, who, today3);
  check("Edit event: picking the model clears Price needs a check", session(id)?.price_check === null);

  const bmRoute = await import("../app/api/team/admin/booking-model/route.ts");
  signIn("bart-1", "bart-token-2");
  const r403 = await bmRoute.POST(new Request("http://x/api/team/admin/booking-model", { method: "POST", body: JSON.stringify({ sessionId: id, pricing_model: "gratuity" }) }));
  check("Edit event: only admins can change the model", r403.status === 403);

  const ui = src("app/team/admin/e/[id]/booking-model.tsx");
  check("Edit event: changing the model asks first and says staff pay and the price breakdown will change", ui.includes("window.confirm(") && ui.includes("Staff pay and the price breakdown will change."));
  check("Edit event: a new booked on date sets the default model", ui.includes("setPick(defaultModelFor(e.target.value))") && ui.includes('"2026-11-23"'));
  const form2 = src("app/team/admin/events/new/add-event-form.tsx");
  check("Add event form: Booked on and Pricing model fields", form2.includes('label="Booked on"') && form2.includes('label="Pricing model"') && form2.includes('"2026-11-23"'));
  check("Add event form: the service fee model shows its own packages and no gratuity field", form2.includes("sfPackages") && form2.includes('model === "service_fee" ? (') && form2.includes("Add ons inside the total"));
  const edit = await import("../lib/team/admin-edit.ts");
  check("Edit event: a service fee event offers Bartender Only, not Beer and Wine", edit.packageChoices("service_fee").includes("Bartender Only") && !edit.packageChoices("service_fee").includes("Beer and Wine") && edit.packageChoices("gratuity").includes("Beer and Wine"));
  check("Edit event: Bartender Only is refused on a gratuity event", !edit.cleanAdminEdit({ package: "Bartender Only" }, "Full Bar", "gratuity").ok && edit.cleanAdminEdit({ package: "Bartender Only" }, "Full Bar", "service_fee").ok);
}

done("hand added event");
