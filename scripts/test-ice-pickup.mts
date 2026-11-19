// Ice pickup: one person, a two person split with bag counts, an admin
// checking for someone, an unassigned person picking up instead (extra, or
// covering for someone), undo, who can
// do what, the texts (quiet hours, re-text only when the bags or location
// change), the Details count (24 hours), the "Ice not assigned" flag (48
// hours), the Shopping list prefill, and events without a shopping list.
// Run: node --no-warnings scripts/test-ice-pickup.mts

import { check, done, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const ice = await import("../lib/team/ice-pickup.ts");
const iceDb = await import("../lib/team/ice-pickup-db.ts");

const DAY = "2026-12-05"; // a Saturday; service 6:00 PM Central
const at = (day: string, hh: number, mm = 0) => time.zonedInstant(day, hh * 60 + mm, "America/Chicago");
const CLIENT = { client_name: "Justin Reyes", client_email: "justin@example.com", client_phone: "+1 (972) 555-0199", event_type: "Birthday" };
const ev = (id: string, day: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "submitted",
  version: 1,
  event_date: day,
  team_market: "dallas",
  team_market_source: "admin",
  event_data: { ...CLIENT, event_name: "Justin's 30th", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: "1 Main St, Dallas, TX", bartenders: 2, guest_count: 80, package: "Full Bar", ...extra },
});
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const taylor = { id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender" as const, active: true };
const sam = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const riley = { id: "b3", name: "Riley Fox", phone: "+12145550113", role: "bartender" as const, active: true }; // not on the event
const gone = { id: "b9", name: "Gone Person", phone: "+12145550119", role: "bartender" as const, active: false };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [ev("s1", DAY), ev("s2", "2026-12-06"), { ...ev("s3", DAY), created_by: "admin", event_data: { event_name: "Hand added party", event_date: DAY, bar_service_start: "6:00pm", bar_service_end: "9:00pm" } }];
  db.staff = [admin, taylor, sam, riley, gone].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "as1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "s1", staff_id: "b2", status: "accepted" },
  ];
  for (const t of ["event_ice_pickups", "event_ice_pickup_people", "event_ice_pickup_log", "team_notices", "team_hidden_events"]) db[t] = [];
  texts.length = 0;
}
const people = (id = "s1") => db.event_ice_pickup_people.filter((r) => r.session_id === id) as Record<string, unknown>[];
const personRow = (staffId: string, id = "s1") => people(id).find((r) => r.staff_id === staffId);
const noClient = (s: string) => !/Reyes|justin@example|972\D*555\D*0199/.test(s);
const noon = at("2026-12-03", 12);
const session = (id = "s1") => db.sessions.find((s) => s.id === id) as never;

// ----- 1. One person -----
reset();
const s1 = await iceDb.saveIce("s1", admin, { location_name: "Kroger on Lemmon", location_address: "4142 Lemmon Ave", total_bags: "8", notes: "Use the side door" }, noon);
check("An admin saves the location, address, total and notes", s1.ok && s1.view.location === "Kroger on Lemmon, 4142 Lemmon Ave" && s1.view.totalBags === 8 && s1.view.notes === "Use the side door");
const a1 = await iceDb.assignIce("s1", admin, "b1", "", noon);
check("One person assigned, no bag count: they carry the total", a1.ok && a1.view.people.length === 1 && a1.view.people[0].bags === 8 && a1.view.state === "assigned");
const t1 = textsTo(taylor);
check("They get one text with the event, date, bags and location", t1.length === 1 && /Justin · Birthday/.test(t1[0].message) && /Sat, Dec 5/.test(t1[0].message) && /8 bags/.test(t1[0].message) && /Kroger on Lemmon, 4142 Lemmon Ave/.test(t1[0].message) && /plan\.test\/team\/events/.test(t1[0].message), t1[0]?.message);
check("The text carries no client contact details", noClient(t1[0].message));
await iceDb.assignIce("s1", admin, "b1", "", noon);
await iceDb.saveIce("s1", admin, { location_name: "Kroger on Lemmon", location_address: "4142 Lemmon Ave", total_bags: "8", notes: "Changed the note only" }, noon);
check("Saving again with nothing that matters changed sends no second text", textsTo(taylor).length === 1);
const mine = await iceDb.markIce("s1", taylor, { location: "Kroger on Lemmon", bags: "8" }, at(DAY, 15, 40));
check("They mark it picked up with where and how many", mine.ok && mine.view.state === "complete" && mine.view.people[0].line === "Picked up, checked by Taylor, Dec 5, 3:40 PM · Kroger on Lemmon · 8 bags", mine.ok ? mine.view.people[0].line : "");
check("Who checked it is recorded", personRow("b1")!.picked_up_by === "b1" && personRow("b1")!.actual_bags === 8);
const blank = await iceDb.markIce("s1", taylor, {}, at(DAY, 16));
check("Marking again keeps the first record", blank.ok && personRow("b1")!.picked_up_at === at(DAY, 15, 40).toISOString());
check("Where and how many are optional", ice.cleanPickedUp({}).ok && ice.icePickedUpLine({ picked_up_at: at(DAY, 15).toISOString(), picked_up_by_name: "Sam", actual_location: null, actual_bags: null }, "America/Chicago") === "Picked up, checked by Sam, Dec 5, 3:00 PM");
check("A bad bag count is refused", !(await iceDb.markIce("s1", taylor, { bags: "lots" }, noon)).ok);

// ----- 2. Two people, split with bag counts -----
reset();
await iceDb.saveIce("s1", admin, { location_name: "Kroger on Lemmon", total_bags: "12" }, noon);
await iceDb.assignIce("s1", admin, "b1", "6", noon);
const split = await iceDb.assignIce("s1", admin, "b2", "4", noon);
check('"10 of 12 bags assigned" with a mismatch warning', split.ok && split.view.bagLine === "10 of 12 bags assigned" && split.view.bagWarning === "2 bags are not assigned to anyone.", split.ok ? `${split.view.bagLine} / ${split.view.bagWarning}` : "");
check("Each gets their own text with their own bags", /6 bags/.test(textsTo(taylor)[0]?.message ?? "") && /4 bags/.test(textsTo(sam)[0]?.message ?? ""));
const fixed = await iceDb.assignIce("s1", admin, "b2", "6", noon);
check("Fixing the split clears the warning", fixed.ok && fixed.view.bagLine === "12 of 12 bags assigned" && fixed.view.bagWarning === "");
check("Sam's bag count changed: Sam is texted again, Taylor is not", textsTo(sam).length === 2 && /update/i.test(textsTo(sam)[1].message) && /6 bags/.test(textsTo(sam)[1].message) && textsTo(taylor).length === 1);
check("Too many bags assigned is a warning too", ice.bagSummary([{ bags_assigned: 8 }, { bags_assigned: 6 }], 12).warning === "2 more bags assigned than the total.");
await iceDb.saveIce("s1", admin, { location_name: "Tom Thumb on Mockingbird", total_bags: "12" }, noon);
check("The location changes: both are texted again", textsTo(taylor).length === 2 && textsTo(sam).length === 3 && /Tom Thumb on Mockingbird/.test(textsTo(taylor)[1].message));
await iceDb.markIce("s1", taylor, { location: "Tom Thumb on Mockingbird", bags: "6" }, at(DAY, 14));
const half = await iceDb.iceView(session(), admin, { now: at(DAY, 14) });
check("One of two picked up: not complete", half.state === "assigned" && half.outstanding);
await iceDb.saveIce("s1", admin, { location_name: "Walmart on Northwest Hwy", total_bags: "12" }, at(DAY, 14));
check("Someone already picked up is not texted about a new location", textsTo(taylor).length === 2 && textsTo(sam).length === 4);

// ----- 3. An admin checks for someone -----
const forSam = await iceDb.markIce("s1", admin, { staffId: "b2", location: "Walmart on Northwest Hwy", bags: "6" }, at(DAY, 14, 30));
check("An admin marks Sam picked up: the row says who checked it", forSam.ok && personRow("b2")!.picked_up_by === "a1" && forSam.view.people.find((p) => p.staffId === "b2")!.line.startsWith("Picked up, checked by Kenneth, Dec 5, 2:30 PM"));
check("Every assigned person picked up: complete", forSam.ok && forSam.view.state === "complete" && !forSam.view.outstanding);
check("A bartender cannot mark someone else", !(await iceDb.markIce("s2", taylor, { staffId: "b2" }, noon)).ok && (await iceDb.markIce("s1", taylor, { staffId: "b2" }, noon)).ok === false);
check("An admin in Bartender view is treated as a bartender", (await iceDb.markIce("s1", { ...admin, role: "bartender" }, { staffId: "b2" }, noon)).ok === false);

// ----- 4. Undo -----
check("A bartender cannot undo", !(await iceDb.undoIce("s1", taylor, "b2", noon)).ok && !!personRow("b2")!.picked_up_at);
const undone = await iceDb.undoIce("s1", admin, "b2", at(DAY, 15));
check("An admin undoes Sam's: Sam is Not picked up and ice is not complete", undone.ok && !personRow("b2")!.picked_up_at && personRow("b2")!.actual_bags === null && undone.view.state === "assigned");
check("The undo is logged", db.event_ice_pickup_log.some((l) => l.action === "undo" && l.by_name === "Kenneth"));
const removed = await iceDb.removeIce("s1", admin, "b2", at(DAY, 15));
check("One tap remove takes them off", removed.ok && !personRow("b2") && removed.view.people.length === 1 && removed.view.state === "complete");

// ----- 5. An unassigned person picks up instead -----
reset();
await iceDb.saveIce("s1", admin, { location_name: "Kroger on Lemmon", total_bags: "8" }, noon);
await iceDb.assignIce("s1", admin, "b1", "", noon);
const samView = await iceDb.staffIceView(session(), sam, noon);
check("Everyone on the event sees the card, who is picking up and the location", !!samView && samView.people[0].name === "Taylor" && samView.location === "Kroger on Lemmon" && samView.canInstead && !samView.canEdit);
check("Taylor sees their own row with the button, and no instead", (await iceDb.staffIceView(session(), taylor, noon))!.people[0].mine && !(await iceDb.staffIceView(session(), taylor, noon))!.canInstead);
const instead = await iceDb.iceInstead("s1", sam, { location: "Kroger on Lemmon", bags: "8" }, at(DAY, 13));
check('"I picked up the ice instead" adds Sam, picked up', instead.ok && personRow("b2")!.self_added === true && !!personRow("b2")!.picked_up_at && instead.view.people.find((p) => p.staffId === "b2")!.line.includes("checked by Sam"));
check("Sam gets no assignment text for it", textsTo(sam).length === 0);
check('"Nobody, this is extra": Taylor is still assigned and not picked up, so ice is not complete', instead.ok && instead.view.state === "assigned" && !personRow("b1")!.picked_up_at);
check("Someone not on the event cannot pick up instead", !(await iceDb.iceInstead("s1", riley, {}, noon)).ok && !personRow("b3"));
check("Someone not on the event does not see the event card", (await iceDb.staffIceView(session(), riley, noon)) === null);
db.event_assignments.push({ id: "as3", session_id: "s1", staff_id: "b3", status: "offered" });
check("An offer not yet accepted cannot pick up instead", !(await iceDb.iceInstead("s1", riley, {}, noon)).ok);

// ----- 5b. Picking up instead, covering for someone -----
reset();
await iceDb.saveIce("s1", admin, { location_name: "Kroger on Lemmon", total_bags: "8" }, noon);
await iceDb.assignIce("s1", admin, "b1", "", noon);
const before = await iceDb.iceView(session(), admin, { now: at(DAY, 10) });
check("Before: ice is outstanding inside 24 hours and on Taylor's home screen", before.outstanding && (await iceDb.myIcePickups(taylor, at(DAY, 10))).length === 1);
const card = src("app/team/ice-pickup-card.tsx");
check('Tapping instead asks "Who are you covering for?" with the people not picked up, plus "Nobody, this is extra"', card.includes("Who are you covering for?") && card.includes("Nobody, this is extra") && card.includes("view.people.filter((p) => !p.pickedUp)") && card.includes("coveringFor: covering"));
const cover = await iceDb.iceInstead("s1", sam, { coveringFor: "b1", location: "Kroger on Lemmon", bags: "8" }, at(DAY, 13));
const taylorRow = cover.ok ? cover.view.people.find((p) => p.staffId === "b1") : undefined;
check("Sam covers for Taylor: Taylor's row is picked up, covered by Sam", cover.ok && !!personRow("b1")!.picked_up_at && personRow("b1")!.covered_by === "b2" && personRow("b1")!.covered_by_name === "Sam" && personRow("b1")!.picked_up_by === "b2");
check('The row shows "Covered by Sam"', taylorRow?.line === "Covered by Sam, Dec 5, 1:00 PM · Kroger on Lemmon · 8 bags" && taylorRow?.coveredBy === "Sam", taylorRow?.line);
check("Sam is not added as another row", !personRow("b2") && cover.ok && cover.view.people.length === 1);
check("The covered row counts as done: ice is complete, no admin removal needed", cover.ok && cover.view.state === "complete" && !cover.view.outstanding);
check("The alerts stop: not outstanding, off Taylor's home screen, and no held text sent", !(await iceDb.iceView(session(), admin, { now: at(DAY, 14) })).outstanding && (await iceDb.myIcePickups(taylor, at(DAY, 14))).length === 0 && personRow("b1")!.notify_after === null);
check("The cover is logged", db.event_ice_pickup_log.some((l) => l.action === "covered" && l.by_name === "Sam" && l.detail === "for Taylor"));
check("Covering someone already picked up is refused", !(await iceDb.iceInstead("s1", sam, { coveringFor: "b1" }, at(DAY, 14))).ok && personRow("b1")!.covered_by_name === "Sam");
check("Covering someone not on the ice pickup is refused", !(await iceDb.iceInstead("s1", sam, { coveringFor: "b3" }, at(DAY, 14))).ok && !personRow("b2"));
check("Someone not on the event cannot cover", !(await iceDb.iceInstead("s1", riley, { coveringFor: "b1" }, at(DAY, 14))).ok);
const uncover = await iceDb.undoIce("s1", admin, "b1", at(DAY, 15));
check("An admin undo clears the cover too", uncover.ok && !personRow("b1")!.picked_up_at && personRow("b1")!.covered_by === null && personRow("b1")!.covered_by_name === null && uncover.view.state === "assigned" && db.event_ice_pickup_log.some((l) => l.action === "undo" && l.detail === "was covered by Sam"));
// Two people: covering one leaves the other
reset();
await iceDb.assignIce("s1", admin, "b1", "4", noon);
await iceDb.assignIce("s1", admin, "b3", "4", noon);
const one = await iceDb.iceInstead("s1", sam, { coveringFor: "b3" }, at(DAY, 13));
check("Two assigned, Sam covers one: the other is still outstanding", one.ok && one.view.state === "assigned" && !!personRow("b3")!.picked_up_at && !personRow("b1")!.picked_up_at && one.view.canInstead);
const two = await iceDb.iceInstead("s1", sam, { coveringFor: "b1" }, at(DAY, 13, 5));
check("Sam covers the other too: complete", two.ok && two.view.state === "complete" && two.view.people.every((p) => p.coveredBy === "Sam"));
check("The cover columns have a migration that is safe to run twice", /add column if not exists covered_by uuid/.test(src("supabase/migrations/20261205_ice_cover.sql")) && /add column if not exists covered_by_name text/.test(src("supabase/migrations/20261205_ice_cover.sql")));

// ----- 6. Who can be picked, and admin only changes -----
reset();
check("A bartender cannot set the location or assign", !(await iceDb.saveIce("s1", taylor, { location_name: "X" }, noon)).ok && !(await iceDb.assignIce("s1", taylor, "b1", "", noon)).ok && !(await iceDb.removeIce("s1", taylor, "b1", noon)).ok);
const off = await iceDb.assignIce("s1", admin, "b3", "3", noon);
check("Someone not on the event can be picked, and gets the text", off.ok && textsTo(riley).length === 1 && /3 bags/.test(textsTo(riley)[0].message));
check("Admins can be picked", (await iceDb.assignIce("s1", admin, "a1", "", noon)).ok && textsTo(admin).length === 1);
check("Inactive staff cannot be picked", !(await iceDb.assignIce("s1", admin, "b9", "", noon)).ok && !personRow("b9"));
const home = await iceDb.myIcePickups(riley, noon);
check("Their home screen shows the ice card, with no link to an event they are not on", home.length === 1 && home[0].eventHref === null && home[0].people.some((p) => p.mine));
await iceDb.markIce("s1", riley, { bags: "3" }, noon);
check("They can mark it from there, and the home card goes away", !!personRow("b3")!.picked_up_at && (await iceDb.myIcePickups(riley, noon)).length === 0);
const route = src("app/api/team/ice-pickup/route.ts");
check("The route needs a sign in, and changes are admin only on the server", route.includes("getCurrentStaff()") && route.includes('if (ADMIN_ACTIONS.has(action) && !isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });'));

// ----- 7. Quiet hours -----
reset();
const late = at("2026-12-03", 22, 30);
await iceDb.saveIce("s1", admin, { location_name: "Kroger on Lemmon", total_bags: "8" }, late);
await iceDb.assignIce("s1", admin, "b1", "", late);
check("Assigned in quiet hours: no text yet, held until 8:00 AM", textsTo(taylor).length === 0 && new Date(String(personRow("b1")!.notify_after)).getTime() === at("2026-12-04", 8).getTime());
await iceDb.saveIce("s1", admin, { location_name: "Tom Thumb", total_bags: "8" }, at("2026-12-03", 23));
await iceDb.sendIcePickupNotices(at("2026-12-04", 7, 55));
check("The cron does not send before 8:00 AM", textsTo(taylor).length === 0);
await iceDb.sendIcePickupNotices(at("2026-12-04", 8, 5));
await iceDb.sendIcePickupNotices(at("2026-12-04", 8, 10));
check("At 8:00 AM one text goes, with the latest location", textsTo(taylor).length === 1 && /Tom Thumb/.test(textsTo(taylor)[0].message) && !/update/i.test(textsTo(taylor)[0].message));
await iceDb.assignIce("s1", admin, "b1", "5", at("2026-12-04", 23));
check("A bag change in quiet hours waits too", textsTo(taylor).length === 1 && !!personRow("b1")!.notify_after);
await iceDb.sendIcePickupNotices(at(DAY, 8, 1));
check("and goes as an update at 8:00 AM", textsTo(taylor).length === 2 && /update/i.test(textsTo(taylor)[1].message) && /5 bags/.test(textsTo(taylor)[1].message));
check("The ice texts run in the 5 minute cron", src("app/api/cron/team/route.ts").includes("sendIcePickupNotices(now)"));

// ----- 8. The Details count (24 hours) and the "Ice not assigned" flag (48 hours) -----
const ed = ev("x", DAY).event_data;
const p = (picked: boolean) => ({ picked_up_at: picked ? "x" : null });
const in20h = at("2026-12-04", 22); // 20 hours before service
const in30h = at("2026-12-04", 12); // 30 hours before service
check("Inside 24 hours, nobody assigned: counted", ice.iceOutstanding([], ed, in20h));
check("Inside 24 hours, anyone not picked up: counted", ice.iceOutstanding([p(true), p(false)], ed, in20h));
check("Everyone picked up: not counted", !ice.iceOutstanding([p(true), p(true)], ed, in20h));
check("More than 24 hours out: not counted yet", !ice.iceOutstanding([], ed, in30h));
check("After service starts: not counted", !ice.iceOutstanding([], ed, at(DAY, 18, 30)));
check("Ice not assigned: inside 48 hours with nobody assigned", ice.iceUnassignedFlag([], ed, in30h) && !ice.iceUnassignedFlag([p(false)], ed, in30h) && !ice.iceUnassignedFlag([], ed, at("2026-12-03", 12)));
reset();
await iceDb.assignIce("s2", admin, "b1", "", noon);
const flags = await iceDb.iceUnassignedIds(db.sessions as never, at("2026-12-04", 12));
check("The Staffing list flags only events inside 48 hours with nobody assigned", flags.has("s1") && flags.has("s3") && !flags.has("s2"));
check("The Details count is on the manager view", src("app/team/admin/e/[id]/page.tsx").includes("+ (ice.outstanding ? 1 : 0)") && /<IcePickupPanel\s+initial=\{ice\}/.test(src("app/team/admin/e/[id]/page.tsx")));
const mgr = src("app/team/admin/e/[id]/page.tsx");
check("The Ice pickup card is directly under the Menu pickup card", mgr.indexOf("<IcePickupPanel") > mgr.indexOf("<MenuPickupPanel") && !mgr.slice(mgr.indexOf("<MenuPickupPanel"), mgr.indexOf("<IcePickupPanel")).includes("<ClientLinksCard"));
check("The Staffing page, the list and the calendar show Ice not assigned", src("app/team/admin/events/page.tsx").includes('noIce.has(s.id) ? "ice not assigned" : ""') && src("app/team/calendar-view.tsx").includes("Ice not assigned") && src("app/team/events/event-list.tsx").includes("Ice not assigned") && src("lib/team/my-events.ts").includes("iceUnassignedIds(rows)"));
check("The bartender event page shows the card on Details", src("app/team/e/[id]/event-tabs.tsx").includes("{ice && <IcePickupCard initial={ice} />}") && src("app/team/e/[id]/page.tsx").includes("staffIceView(access.session, staff)"));

// ----- 9. The Shopping list prefill, and events without one -----
reset();
const v1 = await iceDb.iceView(session(), admin, { now: noon });
check("Total bags come from the Shopping list's ice when it is calculated (80 guests: 8 bags)", v1.listBags === 8 && v1.totalBags === 8 && v1.savedTotal === null, `${v1.listBags}`);
check("The parser reads the sheet's ice line", ice.shoppingIceBags([{ id: "ice", lines: [{ fields: { name: "Cups", quantity: "200 count" } }, { fields: { name: "Ice", quantity: "12 bags" } }] }]) === 12);
await iceDb.saveIce("s1", admin, { location_name: "Kroger", total_bags: "10" }, noon);
check("A saved total wins over the Shopping list", (await iceDb.iceView(session(), admin, { now: noon })).totalBags === 10);
const v3 = await iceDb.iceView(session("s3"), admin, { now: noon });
check("A hand added event with no shopping list: total bags blank", v3.listBags === null && v3.totalBags === null);
const h = await iceDb.assignIce("s3", admin, "b1", "", noon);
check("and it works the same: assigned, texted with the bag count to ask about", h.ok && h.view.state === "assigned" && /Bag count: ask the office/.test(textsTo(taylor).at(-1)!.message) && /Where: ask the office/.test(textsTo(taylor).at(-1)!.message));
check("No bag line without a total or counts", h.ok && h.view.bagLine === "" && h.view.bagWarning === "");

// ----- 10. The migration -----
const sql = src("supabase/migrations/20261204_ice_pickups.sql");
check("The migration is safe to run twice", !/create table (?!if not exists)/i.test(sql) && !/create index (?!if not exists)/i.test(sql) && /unique \(session_id, staff_id\)/.test(sql));
check("The tables are server only, like the menu pickup tables", /revoke all on public\.event_ice_pickups, public\.event_ice_pickup_people, public\.event_ice_pickup_log from anon, authenticated/.test(sql));

// ----- The ice rule: a team setting, under Recommended location and in the text -----
const cldb = await import("../lib/client-list-db.ts");
reset();
db.team_settings = [];
await iceDb.saveIce("s1", admin, { location_name: "Ice House on Elm", total_bags: "8" }, noon);
const r1 = await iceDb.assignIce("s1", admin, "b1", "", noon);
check("The ice rule defaults to No gas stations. No grocery stores.", r1.ok && r1.view.rule === "No gas stations. No grocery stores.");
check("The assignment text has the rule right after where to go", (textsTo(taylor)[0]?.message ?? "").includes("Where: Ice House on Elm. No gas stations. No grocery stores. Mark it picked up"), textsTo(taylor)[0]?.message);
const asTaylor = await iceDb.staffIceView(session(), taylor, noon);
check("The bartender's card gets the rule too", asTaylor?.rule === "No gas stations. No grocery stores.");
const rulePanel = src("app/team/admin/e/[id]/ice-pickup-panel.tsx");
const ruleCard = src("app/team/ice-pickup-card.tsx");
check("Admin card: the rule is directly under Recommended location", rulePanel.indexOf("Recommended location") < rulePanel.indexOf("{view.rule && <span") && rulePanel.indexOf("{view.rule && <span") < rulePanel.indexOf("value={name}"));
check("Staff card: the rule is directly under Recommended location", ruleCard.indexOf("Recommended location: </dt>") < ruleCard.indexOf("{view.rule && (") && ruleCard.indexOf("{view.rule && (") < ruleCard.indexOf("Total: </dt>"));
check("The admin example is no longer a grocery store", !/Kroger/.test(rulePanel));
check("A bartender cannot change the rule", !(await cldb.setTeamText(taylor, cldb.ICE_RULE_KEY, "Anywhere")).ok);
const ruleMgr = { id: "m1", name: "Alex Rivera", phone: "+12145550101", role: "manager" as const, active: true };
const saved = await cldb.setTeamText(ruleMgr, cldb.ICE_RULE_KEY, "  Ice houses   only. ");
check("An admin or manager edits the wording", saved.ok && saved.value === "Ice houses only." && (await cldb.teamText(cldb.ICE_RULE_KEY)) === "Ice houses only.");
check("Too long is refused, unknown keys are refused", !(await cldb.setTeamText(admin, cldb.ICE_RULE_KEY, "x".repeat(201))).ok && !(await cldb.setTeamText(admin, "nope", "x")).ok);
check("The cards and the next text use the new wording", (await iceDb.iceView(session(), admin, { now: noon })).rule === "Ice houses only.");
await iceDb.assignIce("s1", admin, "b2", "", noon);
check("The next text says the new wording", (textsTo(sam)[0]?.message ?? "").includes("Ice houses only. Mark it"), textsTo(sam)[0]?.message);
check("Empty puts the default back", (await cldb.setTeamText(admin, cldb.ICE_RULE_KEY, "  ")).ok && (await cldb.teamText(cldb.ICE_RULE_KEY)) === "No gas stations. No grocery stores.");
check("The editor is on the Staff page with the other team settings", src("app/team/admin/staff/page.tsx").includes("settingKey={ICE_RULE_KEY}") && src("app/api/team/admin/settings/route.ts").includes("setTeamText(staff, body.key, body.text)"));
check("The text keeps no client details", noClient(textsTo(taylor)[0]?.message ?? ""));

// ----- Ice machine onsite -----
reset();
const notAdmin = await iceDb.setIceMachine("s1", taylor, true, noon);
check("Ice machine onsite: a bartender cannot set it", !notAdmin.ok && !(await iceDb.iceMachine("s1")));
const mOn = await iceDb.setIceMachine("s1", admin, true, noon);
check("Ice machine onsite: an admin sets it, with no one assigned, no store, no bags", mOn.ok && mOn.view.machineOnsite && mOn.view.people.length === 0 && mOn.view.location === "" && src("app/team/admin/e/[id]/ice-pickup-panel.tsx").indexOf("if (view.machineOnsite)") < src("app/team/admin/e/[id]/ice-pickup-panel.tsx").indexOf("Recommended location"));
check("...the card status says Ice machine onsite, with who set it and when", mOn.ok && mOn.view.machineLine === "Set by Kenneth, Dec 3, 12:00 PM" && src("app/team/ice-pickup-card.tsx").includes("view.machineOnsite\n      ? [ICE_MACHINE_ONSITE") && ice.ICE_MACHINE_ONSITE === "Ice machine onsite");
check("...logged with who and when", db.event_ice_pickup_log.some((l) => l.session_id === "s1" && l.action === "machine_on" && l.by_name === "Kenneth" && l.created_at === noon.toISOString()));
const mView = await iceDb.iceView(session(), admin, { now: at(DAY, 10) });
check("...it never counts as unfinished, even inside 24 hours with nobody assigned", !mView.outstanding);
check("...and never shows Ice not assigned inside 48 hours", !(await iceDb.iceUnassignedIds([session()], at(DAY, 10))).has("s1") && (await iceDb.iceUnassignedIds([session("s2")], at("2026-12-06", 10))).has("s2"));
const tryAssign = await iceDb.assignIce("s1", admin, "b1", "", noon);
check("...no one can be assigned while it is on (so no ice texts)", !tryAssign.ok && texts.length === 0);
const staffSees = await iceDb.staffIceView(session(), sam, noon);
check("Staff on the event see Ice machine onsite on their event page", !!staffSees && staffSees.machineOnsite && src("app/team/ice-pickup-card.tsx").includes("if (view.machineOnsite)") && src("app/team/e/[id]/event-tabs.tsx").includes("<IcePickupCard initial={ice} />"));
check("...the staff note says nobody needs to buy ice, and has no hyphens", /Nobody needs to buy ice/.test(src("app/team/ice-pickup-card.tsx")) && !/[-‐-―]/.test("The venue has an ice machine. Nobody needs to buy ice for this event. Ice machine onsite. Set by Kenneth, Dec 3, 12:00 PM"));
// Set with someone already assigned (and a text held for quiet hours): nothing goes out.
reset();
const night = at("2026-12-03", 22);
await iceDb.saveIce("s1", admin, { location_name: "Ice House on Elm", total_bags: "8" }, night);
await iceDb.assignIce("s1", admin, "b1", "", night);
check("(held for quiet hours before it was set)", !!personRow("b1")!.notify_after && textsTo(taylor).length === 0);
await iceDb.setIceMachine("s1", admin, true, at("2026-12-03", 23));
await iceDb.sendIcePickupNotices(at("2026-12-04", 8, 5));
await iceDb.saveIce("s1", admin, { location_name: "Somewhere else", total_bags: "9" }, at("2026-12-04", 9));
check("Ice machine onsite: the held text is dropped and no ice texts or reminders go out", textsTo(taylor).length === 0 && !personRow("b1")!.notify_after);
check("...and it is off the person's home screen", (await iceDb.myIcePickups(taylor, at("2026-12-04", 9))).length === 0);
await iceDb.markIce("s1", taylor, { location: "Ice House on Elm", bags: "8" }, at(DAY, 14));
const reimb = await import("../lib/team/reimbursements-db.ts");
check("...and no ice reimbursement is suggested for it", (await reimb.pickupsDone(["s1"])).get("s1")!.ice.size === 0);
// Switched back.
const mOff = await iceDb.setIceMachine("s1", admin, false, at("2026-12-04", 10));
check("It can be switched back: logged, and the card is the ice pickup again", mOff.ok && !mOff.view.machineOnsite && db.event_ice_pickup_log.some((l) => l.action === "machine_off" && l.by_name === "Kenneth") && !(await iceDb.iceMachine("s1")));
check("...the pickup counts again once switched back", (await reimb.pickupsDone(["s1"])).get("s1")!.ice.has("b1"));
check("Setting it twice logs it once", (await iceDb.setIceMachine("s1", admin, false, at("2026-12-04", 11))).ok && db.event_ice_pickup_log.filter((l) => l.action === "machine_off").length === 1);
check("The latest entry wins", ice.iceMachineFrom([{ action: "machine_on", by_name: "A", created_at: "2026-12-01T00:00:00Z" }, { action: "machine_off", by_name: "B", created_at: "2026-12-02T00:00:00Z" }]) === null && ice.iceMachineFrom([{ action: "machine_off", by_name: "A", created_at: "2026-12-01T00:00:00Z" }, { action: "machine_on", by_name: "B", created_at: "2026-12-02T00:00:00Z" }])?.byName === "B");
check("The route takes it, admins only", src("app/api/team/ice-pickup/route.ts").includes('action === "machine" ? await setIceMachine(sessionId, staff, body.on, undefined, body.mode)') && src("app/api/team/ice-pickup/route.ts").includes('"machine"]);'));

// ----- Ice machine onsite: the two choices -----
reset();
await iceDb.saveIce("s1", admin, { location_name: "Ice House on Elm", total_bags: "4" }, noon);
const bOn = await iceDb.setIceMachine("s1", admin, undefined, noon, "backup");
check("Backup bags: an admin picks Ice machine onsite, bring backup bags, logged with who and when", bOn.ok && bOn.view.machineBackup && !bOn.view.machineOnsite && db.event_ice_pickup_log.some((l) => l.action === "machine_backup" && l.by_name === "Kenneth" && l.created_at === noon.toISOString()));
check("...the full card stays, with the backup line at the top for admins and staff", bOn.ok && bOn.view.location === "Ice House on Elm" && ice.ICE_BACKUP_LINE === "Ice machine onsite. Backup bags only." && src("app/team/ice-pickup-card.tsx").includes("{view.machineBackup && (") && src("app/team/admin/e/[id]/ice-pickup-panel.tsx").includes("{ICE_BACKUP_LINE}"));
const bAssign = await iceDb.assignIce("s1", admin, "b1", "", noon);
check("...someone can be assigned, and gets the ice text", bAssign.ok && textsTo(taylor).length === 1);
const bView = await iceDb.iceView(session(), admin, { now: at(DAY, 10) });
check("...it counts as unfinished like a normal pickup", bView.outstanding);
check("...it is on the person's home screen", (await iceDb.myIcePickups(taylor, at(DAY, 9))).length === 1);
check("...and the reminder cron still covers it", !(await iceDb.iceMachines(["s1"])).has("s1") && (await iceDb.iceMachines(["s1"], { withBackup: true })).get("s1")?.mode === "backup");
const nOn = await iceDb.setIceMachine("s1", admin, undefined, at("2026-12-03", 13), "no_pickup");
const nView = await iceDb.iceView(session(), admin, { now: at(DAY, 10) });
check("No pickup: switching to it stops the count, assignment, and texts", nOn.ok && nOn.view.machineOnsite && !nView.outstanding && !(await iceDb.assignIce("s1", admin, "b2", "", at("2026-12-03", 13))).ok && (await iceDb.myIcePickups(taylor, at(DAY, 9))).length === 0);
const back = await iceDb.setIceMachine("s1", admin, undefined, at("2026-12-03", 14), "off");
check("Either can be switched back, and each switch is logged", back.ok && !back.view.machineOnsite && !back.view.machineBackup && ["machine_backup", "machine_on", "machine_off"].every((a) => db.event_ice_pickup_log.some((l) => l.action === a)));
check("The latest entry decides the mode", ice.iceMachineFrom([{ action: "machine_on", by_name: "A", created_at: "2026-12-01T00:00:00Z" }, { action: "machine_backup", by_name: "B", created_at: "2026-12-02T00:00:00Z" }])?.mode === "backup");
check("Both choices are on the admin card", src("app/team/admin/e/[id]/ice-pickup-panel.tsx").includes('machineToggle("no_pickup")') && src("app/team/admin/e/[id]/ice-pickup-panel.tsx").includes('machineToggle("backup")') && ice.ICE_MACHINE_NO_PICKUP === "Ice machine onsite, no pickup" && ice.ICE_MACHINE_BACKUP === "Ice machine onsite, bring backup bags");

done("ice pickup");
