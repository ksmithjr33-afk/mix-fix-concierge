// Cocktail menu pickup: assignment and its one text (held in quiet hours),
// the "Picked up" check recording who and when, a bartender unable to mark
// someone else's pickup, the admin undo, "No printed menu", the outstanding
// counts, and the cron's morning reminder and 24 hour admin alert.
// Run: node --no-warnings scripts/test-menu-pickup.mts

import { check, done, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const mp = await import("../lib/team/menu-pickup.ts");
const mpDb = await import("../lib/team/menu-pickup-db.ts");

const DAY = "2026-12-05"; // a Saturday; service 6:00 PM, arrive 4:00 PM Central
const at = (day: string, hh: number, mm = 0) => time.zonedInstant(day, hh * 60 + mm, "America/Chicago");
const CLIENT = { client_name: "Justin Reyes", client_email: "justin@example.com", client_phone: "+1 (972) 555-0199", event_type: "Birthday" };
const ev = (id: string, day: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "submitted",
  version: 1,
  event_date: day,
  team_market: "dallas",
  team_market_source: "admin",
  event_data: { ...CLIENT, event_name: "Justin's 30th", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: "1 Main St, Dallas, TX", bartenders: 2, ...extra },
});
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const admin2 = { id: "a2", name: "Pat Jones", phone: "+12145550102", role: "admin" as const, active: true, alerts: true };
const taylor = { id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender" as const, active: true };
const sam = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const gone = { id: "b9", name: "Gone Person", phone: "+12145550119", role: "bartender" as const, active: false };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [ev("s1", DAY), ev("s2", "2026-12-06")];
  db.staff = [admin, admin2, taylor, sam, gone].map((s) => ({ ...s }));
  db.event_assignments = [{ id: "as1", session_id: "s1", staff_id: "b1", status: "accepted" }];
  for (const t of ["event_menu_pickups", "event_menu_pickup_log", "team_notices", "team_hidden_events"]) db[t] = [];
  texts.length = 0;
}
const row = (id = "s1") => db.event_menu_pickups.find((r) => r.session_id === id) as Record<string, unknown> | undefined;
const noClient = (s: string) => !/Reyes|justin@example|972\D*555\D*0199/.test(s);
const FORM = { store: "walgreens", location_note: "Lemmon Ave, photo counter", order_number: "88231", assignee_id: "b1" };

// ----- 1. Assignment -----
reset();
const noon = at("2026-12-03", 12);
const saved = await mpDb.savePickup("s1", admin, FORM, noon);
check("An admin assigns the pickup with the store, note and order number", saved.ok && row()!.store === "walgreens" && row()!.location_note === "Lemmon Ave, photo counter" && row()!.order_number === "88231" && row()!.assignee_id === "b1" && row()!.assigned_by === "a1");
check("The card reads Assigned to Taylor", saved.ok && saved.view.state === "assigned" && saved.view.assigneeName === "Taylor");
check("The assigned person gets one text with the store, note and order number", textsTo(taylor).length === 1 && /Walgreens/.test(textsTo(taylor)[0].message) && /Lemmon Ave/.test(textsTo(taylor)[0].message) && /#88231/.test(textsTo(taylor)[0].message) && /plan\.test\/team\/events/.test(textsTo(taylor)[0].message));
check("The text carries no client contact details", noClient(textsTo(taylor)[0].message));
await mpDb.savePickup("s1", admin, { ...FORM, location_note: "Now the Oak Lawn store" }, noon);
check("Saving again with the same person sends no second text", textsTo(taylor).length === 1);
await mpDb.savePickup("s1", admin, { ...FORM, assignee_id: "a2" }, noon);
check("Admins can be assigned too, and the new person gets their one text", row()!.assignee_id === "a2" && textsTo(admin2).length === 1);
check("Inactive staff cannot be assigned", !(await mpDb.savePickup("s1", admin, { ...FORM, assignee_id: "b9" }, noon)).ok && row()!.assignee_id === "a2");
check("Other needs a typed store name", !(await mpDb.savePickup("s1", admin, { ...FORM, store: "other" }, noon)).ok && (await mpDb.savePickup("s1", admin, { ...FORM, store: "other", store_other: "FedEx Office", assignee_id: "a2" }, noon)).ok && mp.storeName(row() as never) === "FedEx Office");
check("Unknown stores are refused", !(await mpDb.savePickup("s1", admin, { ...FORM, store: "kinkos" }, noon)).ok);
check("A bartender cannot change the pickup", !(await mpDb.savePickup("s1", taylor, FORM, noon)).ok);
check("Every change is logged", db.event_menu_pickup_log.filter((l) => l.session_id === "s1").length >= 4 && db.event_menu_pickup_log.some((l) => l.action === "assigned" && l.detail === "Taylor"));

// Quiet hours: held until 8:00 AM, sent once by the cron.
reset();
const late = at("2026-12-03", 22, 30);
await mpDb.savePickup("s1", admin, FORM, late);
check("Assigned in quiet hours: no text yet", textsTo(taylor).length === 0 && !!row()!.notify_after);
check("Held until 8:00 AM in the event's time zone", new Date(String(row()!.notify_after)).getTime() === at("2026-12-04", 8).getTime());
await mpDb.sendMenuPickupNotices(at("2026-12-04", 7, 55));
check("The cron does not send it before 8:00 AM", textsTo(taylor).length === 0);
await mpDb.sendMenuPickupNotices(at("2026-12-04", 8, 5));
await mpDb.sendMenuPickupNotices(at("2026-12-04", 8, 10));
check("The cron sends it once after 8:00 AM", textsTo(taylor).length === 1 && !!row()!.notified_at);

// ----- 2. Picked up: who and when; only the assignee or an admin -----
reset();
await mpDb.savePickup("s1", admin, FORM, noon);
const when = at("2026-12-04", 15, 40);
const other = await mpDb.markPickedUp("s1", sam, when);
check("A bartender cannot mark someone else's pickup", !other.ok && other.status === 403 && !row()!.picked_up_at);
const adminInBartenderView = await mpDb.markPickedUp("s1", { ...admin, role: "bartender" }, when);
check("An admin in Bartender view is treated as a bartender", !adminInBartenderView.ok && !row()!.picked_up_at);
const mine = await mpDb.markPickedUp("s1", taylor, when);
check("The assigned person checks Picked up: who and when are recorded", mine.ok && row()!.picked_up_by === "b1" && row()!.picked_up_by_name === "Taylor" && row()!.picked_up_at === when.toISOString());
check('The card reads "Picked up by Taylor, Dec 4, 3:40 PM"', mine.ok && mine.line === "Picked up by Taylor, Dec 4, 3:40 PM", mine.ok ? mine.line : "");
const again = await mpDb.markPickedUp("s1", admin, at("2026-12-04", 16));
check("Checking it again keeps the first record", again.ok && row()!.picked_up_by === "b1" && row()!.picked_up_at === when.toISOString());
check("A bartender cannot undo it", !(await mpDb.undoPickedUp("s1", taylor, at("2026-12-04", 16))).ok && !!row()!.picked_up_at);
const undone = await mpDb.undoPickedUp("s1", admin2, at("2026-12-04", 16, 5));
check("An admin can undo it, and the undo is recorded", undone.ok && !row()!.picked_up_at && row()!.undone_by === "a2" && row()!.undone_by_name === "Pat" && db.event_menu_pickup_log.some((l) => l.action === "undo" && l.by_name === "Pat"));
check("The card says who undid it and when", undone.ok && undone.view.undoneLine === "Picked up was undone by Pat, Dec 4, 4:05 PM", undone.ok ? undone.view.undoneLine : "");
check("An admin can mark it picked up for the person", (await mpDb.markPickedUp("s1", admin, at("2026-12-04", 17))).ok && row()!.picked_up_by_name === "Kenneth");
reset();
check("Nothing to mark when nobody is assigned", !(await mpDb.markPickedUp("s1", admin, noon)).ok);
const route = src("app/api/team/menu-pickup/route.ts");
check("The route needs a sign in, and save and undo are admin only on the server", route.includes("getCurrentStaff()") && route.includes('if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });'));

// ----- 3. The assigned person's own card -----
reset();
await mpDb.savePickup("s1", admin, FORM, noon);
const cards = await mpDb.myPickups(taylor, noon);
check('The assigned person sees "Pick up the menu" with the store, note and order number', cards.length === 1 && cards[0].store === "Walgreens" && cards[0].note === "Lemmon Ave, photo counter" && cards[0].order === "88231" && cards[0].eventHref === "/team/e/s1");
check("Nobody else sees it", (await mpDb.myPickups(sam, noon)).length === 0 && (await mpDb.myPickups(admin, noon)).length === 0);
check("An assignee who is not on the event still sees it, without a link to the event", (await mpDb.savePickup("s1", admin, { ...FORM, assignee_id: "b2" }, noon)).ok && (await mpDb.myPickups(sam, noon))[0]?.eventHref === null);
await mpDb.markPickedUp("s1", sam, noon);
check("Once picked up the card goes away", (await mpDb.myPickups(sam, noon)).length === 0);
check("The card is on the home screen and the event page", src("app/team/events/page.tsx").includes("<MyPickupCard key={p.sessionId} pickup={p} />") && src("app/team/e/[id]/event-tabs.tsx").includes("<MyPickupCard pickup={menuPickup} showEvent={false} />"));

// ----- 4. Outstanding counts and status -----
const ed = ev("x", DAY).event_data;
const base = { session_id: "x", store: null, store_other: null, location_note: null, order_number: null, assignee_id: null, not_needed: false, picked_up_at: null, picked_up_by: null, picked_up_by_name: null };
const in30h = at("2026-12-04", 10); // 30 hours before arrival
check("Inside 48 hours with nobody assigned: outstanding", mp.pickupOutstanding(null, ed, in30h) && mp.pickupOutstanding(base, ed, in30h));
check("Inside 48 hours, assigned but not picked up: outstanding", mp.pickupOutstanding({ ...base, assignee_id: "b1" }, ed, in30h));
check("Picked up: not outstanding", !mp.pickupOutstanding({ ...base, assignee_id: "b1", picked_up_at: in30h.toISOString() }, ed, in30h));
check("No printed menu: not outstanding", !mp.pickupOutstanding({ ...base, not_needed: true }, ed, in30h));
check("More than 48 hours out: not outstanding yet", !mp.pickupOutstanding(null, ed, at("2026-12-02", 12)));
check("After the event starts: not outstanding", !mp.pickupOutstanding(null, ed, at(DAY, 17)));
const names = new Map([["b1", "Taylor"]]);
check("List and chip status: no one assigned, a name, or picked up", mp.pickupBadge(null, names)?.text === "Menu: no one assigned" && mp.pickupBadge({ ...base, assignee_id: "b1" }, names)?.text === "Menu: Taylor" && mp.pickupBadge({ ...base, assignee_id: "b1", picked_up_at: "x" }, names)?.text === "Menu picked up");
check("No printed menu shows no menu status", mp.pickupBadge({ ...base, not_needed: true }, names) === null);
reset();
const view = await mpDb.adminPickupView(db.sessions[0] as never, in30h);
check("The manager view's Details tab gets a count inside 48 hours", view.outstanding);
await mpDb.savePickup("s1", admin, { not_needed: true }, in30h);
check("No printed menu takes it off the count", !(await mpDb.adminPickupView(db.sessions[0] as never, in30h)).outstanding);
const mgr = src("app/team/admin/e/[id]/page.tsx");
check("The Details tab count and the Menu pickup card are on the manager view", mgr.includes("details: (pickup.outstanding ? 1 : 0) + (menuFile.missing ? 1 : 0)") && /<MenuPickupPanel\s+initial=\{pickup\}/.test(mgr));
check("The admin events list shows the status", src("app/team/admin/events/page.tsx").includes('menus.get(s.id)?.text ?? ""'));

// ----- 5. Cron: the morning reminder and the 24 hour admin alert -----
reset();
await mpDb.savePickup("s1", admin, FORM, noon);
texts.length = 0;
await mpDb.sendMenuPickupNotices(at(DAY, 7, 30));
check("No reminder before 8:00 AM", textsTo(taylor).length === 0);
await mpDb.sendMenuPickupNotices(at(DAY, 9));
await mpDb.sendMenuPickupNotices(at(DAY, 9, 5));
check("One reminder to the assigned person the morning of the event", textsTo(taylor).length === 1 && /reminder/i.test(textsTo(taylor)[0].message) && noClient(textsTo(taylor)[0].message));
reset();
await mpDb.savePickup("s1", admin, FORM, noon);
await mpDb.markPickedUp("s1", taylor, at("2026-12-04", 18));
texts.length = 0;
await mpDb.sendMenuPickupNotices(at(DAY, 9));
check("No reminder once it is picked up", textsTo(taylor).length === 0);
reset();
await mpDb.savePickup("s1", admin, FORM, noon);
texts.length = 0;
await mpDb.sendMenuPickupNotices(at(DAY, 13));
check("No morning reminder in the afternoon", textsTo(taylor).length === 0);

reset();
await mpDb.sendMenuPickupNotices(at("2026-12-04", 10)); // 30 hours out
check("No admin alert more than 24 hours out", texts.length === 0);
await mpDb.sendMenuPickupNotices(at("2026-12-04", 16, 30)); // 23.5 hours out
check("Nobody assigned 24 hours out: one alert to each admin", textsTo(admin).length === 1 && textsTo(admin2).length === 1 && /Nobody is assigned/.test(textsTo(admin)[0].message) && noClient(textsTo(admin)[0].message));
await mpDb.sendMenuPickupNotices(at("2026-12-04", 16, 35));
check("The admin alert goes once", textsTo(admin).length === 1);
check("Bartenders get no admin alert", textsTo(taylor).length === 0 && textsTo(sam).length === 0);
reset();
await mpDb.savePickup("s1", admin, { not_needed: true }, noon);
await mpDb.savePickup("s2", admin, FORM, noon);
texts.length = 0;
await mpDb.sendMenuPickupNotices(at("2026-12-04", 16, 30));
check("No admin alert for no printed menu or an assigned pickup", textsTo(admin).length === 0);
reset();
db.team_hidden_events.push({ session_id: "s1" });
await mpDb.sendMenuPickupNotices(at("2026-12-04", 16, 30));
check("No alert for a hidden event", texts.length === 0);
reset();
await mpDb.sendMenuPickupNotices(at("2026-12-04", 22)); // 18 hours out but quiet hours
check("The admin alert waits out quiet hours", texts.length === 0);
await mpDb.sendMenuPickupNotices(at(DAY, 8, 5));
check("and goes at 8:00 AM, still before the event", textsTo(admin).length === 1);
check("The pickup runs in the 5 minute cron", src("app/api/cron/team/route.ts").includes("sendMenuPickupNotices(now)"));

done("menu pickup");
