// Markets, market time zones, open shifts, shift requests, and shift handoffs,
// run through the real code against the in-memory database
// (scripts/fake-supabase.mts) with fetch stubbed: geocoding and staff texts
// are captured instead of sent.
// Run: node --no-warnings scripts/test-shifts.mts

import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase") return nextResolve(new URL("./fake-supabase.mts", import.meta.url).href, context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

process.env.GHL_STAFF_SMS_WEBHOOK = "https://hooks.test/staff-sms";
process.env.TEAM_BASE_URL = "https://plan.test";
process.env.TEAM_GEOCODE_GAP_MS = "0";
delete process.env.GOOGLE_MAPS_API_KEY;

// Geocoding: the address names the place.
const PLACES: Record<string, { lat: number; lng: number }> = {
  Dallas: { lat: 32.7767, lng: -96.797 },
  "Fort Worth": { lat: 32.7555, lng: -97.3308 },
  Austin: { lat: 30.2672, lng: -97.7431 },
  "San Antonio": { lat: 29.4241, lng: -98.4936 },
  Houston: { lat: 29.7604, lng: -95.3698 },
  "Santa Monica": { lat: 34.0195, lng: -118.4912 },
  "Oklahoma City": { lat: 35.4676, lng: -97.5164 },
};
const texts: { phone: string; message: string }[] = [];
let geocodes = 0;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("nominatim.openstreetmap.org")) {
    geocodes++;
    const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
    const hit = Object.entries(PLACES).find(([name]) => q.includes(name));
    return new Response(JSON.stringify(hit ? [{ lat: String(hit[1].lat), lon: String(hit[1].lng) }] : []), { status: 200 });
  }
  if (url === process.env.GHL_STAFF_SMS_WEBHOOK) {
    const b = JSON.parse(String(init?.body ?? "{}"));
    texts.push({ phone: b.phone, message: b.message });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const out = console.log;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const markets = await import("../lib/team/markets.ts");
const clock = await import("../lib/team/clock.ts");
const bar = await import("../lib/team/bar-ready.ts");
const view = await import("../lib/team/event-view.ts");
const ts = await import("../lib/team/timesheet.ts");
const shifts = await import("../lib/team/shifts.ts");
const asg = await import("../lib/team/assignments.ts");
const shiftsDb = await import("../lib/team/shifts-db.ts");
const marketsDb = await import("../lib/team/markets-db.ts");
const asgDb = await import("../lib/team/assignments-db.ts");
const clockDb = await import("../lib/team/clock-db.ts");
const hidden = await import("../lib/team/hidden.ts");
const { normalizePhone } = await import("../lib/team/codes.ts");

let failed = 0;
let total = 0;
function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  out(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}

// ----- Markets -----
check("Four markets", markets.MARKETS.join() === "dallas,austin,houston,los_angeles");
check("Texas markets are Central time", ["dallas", "austin", "houston"].every((m) => markets.marketTz(m) === "America/Chicago"));
check("Los Angeles is Pacific time", markets.marketTz("los_angeles") === "America/Los_Angeles");
check("No market is Central time", markets.marketTz(null) === "America/Chicago");
check("Dallas address is the Dallas market", markets.nearestMarket(PLACES.Dallas) === "dallas");
check("Fort Worth is the Dallas market", markets.nearestMarket(PLACES["Fort Worth"]) === "dallas");
check("San Antonio is the nearest metro, Austin", markets.nearestMarket(PLACES["San Antonio"]) === "austin");
check("Houston is the Houston market", markets.nearestMarket(PLACES.Houston) === "houston");
check("Santa Monica is the Los Angeles market", markets.nearestMarket(PLACES["Santa Monica"]) === "los_angeles");
check("Farther than 150 miles from every metro has no market", markets.nearestMarket(PLACES["Oklahoma City"]) === null);
check("No location, no market", markets.nearestMarket(null) === null);
check("Staff markets need at least one", markets.cleanMarkets([]) === null && markets.cleanMarkets(["miami"]) === null && markets.cleanMarkets("dallas") === null);
check("Staff markets keep a fixed order", markets.cleanMarkets(["los_angeles", "dallas"])?.join() === "dallas,los_angeles");
check("Staff from before markets count as Dallas", markets.staffMarketsOf({}).join() === "dallas");
const sf = asg.validateStaffInput({ first: "Jordan", last: "Lee", phone: "214 555 0101", markets: ["austin", "houston"] }, normalizePhone);
check("The staff form saves markets", sf.ok && sf.value.markets.join() === "austin,houston");
check("The staff form refuses no market", !asg.validateStaffInput({ first: "Jordan", last: "Lee", phone: "214 555 0101", markets: [] }, normalizePhone).ok);
check("Adding someone requires a market: none sent is refused", (() => { const r = asg.validateStaffInput({ first: "A", last: "B", phone: "214 555 0101" }, normalizePhone, { requireMarkets: true }); return !r.ok && r.error === "Pick at least one market."; })());
check("Adding someone requires a market: none checked is refused", !asg.validateStaffInput({ first: "A", last: "B", phone: "214 555 0101", markets: [] }, normalizePhone, { requireMarkets: true }).ok);
check("Adding someone with one market checked is allowed", (() => { const r = asg.validateStaffInput({ first: "A", last: "B", phone: "214 555 0101", markets: ["houston"] }, normalizePhone, { requireMarkets: true }); return r.ok && r.value.markets.join() === "houston"; })());
check("An older edit form (no markets field) defaults to Dallas", (() => { const r = asg.validateStaffInput({ first: "A", last: "B", phone: "214 555 0101" }, normalizePhone); return r.ok && r.value.markets.join() === "dallas"; })());

// ----- Time zones: a Los Angeles event at 6:00 PM -----
const la = (day: string, start = "6:00pm", end = "10:00pm") => markets.eventData({ event_date: day, event_data: { event_date: day, bar_service_start: start, bar_service_end: end, event_type: "Birthday" }, team_market: "los_angeles" } as never);
const dal = (day: string, start = "6:00pm", end = "10:00pm") => markets.eventData({ event_date: day, event_data: { event_date: day, bar_service_start: start, bar_service_end: end, event_type: "Birthday" }, team_market: "dallas" } as never);
const pacificClock = (d: Date | null) => (d ? clock.formatInstant(d, "America/Los_Angeles") : "");
const laOpens = clock.clockInOpensAt(la("2026-12-12"));
check("LA 6:00 PM event: arrival 4:00 PM Pacific", time.eventSchedule(la("2026-12-12")).arrival?.toISOString() === "2026-12-13T00:00:00.000Z");
check("LA 6:00 PM event: clock in opens 3:30 PM Pacific", laOpens?.toISOString() === "2026-12-12T23:30:00.000Z" && pacificClock(laOpens) === "3:30 PM", laOpens?.toISOString());
check("The same event in Dallas opens 3:30 PM Central, two hours earlier", clock.clockInOpensAt(dal("2026-12-12"))?.toISOString() === "2026-12-12T21:30:00.000Z");
check("LA in summer time: clock in opens 3:30 PM Pacific daylight time", clock.clockInOpensAt(la("2026-07-11"))?.toISOString() === "2026-07-11T22:30:00.000Z");
const early = clock.checkPunch("in", [], new Date("2026-12-12T23:20:00Z"), laOpens, "America/Los_Angeles");
check("Too early says Pacific time: clock in opens at 3:30 PM", !early.ok && (early as { error: string }).error === "Clock in opens at 3:30 PM.", JSON.stringify(early));
check("At 3:31 PM Pacific clock in is open", clock.checkPunch("in", [], new Date("2026-12-12T23:31:00Z"), laOpens, "America/Los_Angeles").ok);
check("LA event with no start time opens at midnight Pacific", clock.clockInOpensAt(la("2026-12-12", "", ""))?.toISOString() === "2026-12-12T08:00:00.000Z");
check("LA bar ready opens at arrival, 4:00 PM Pacific", bar.barReadyOpensAt(la("2026-12-12"))?.toISOString() === "2026-12-13T00:00:00.000Z");
check("LA clock out reminder: 10:00 PM plus 90 minutes Pacific", clock.clockOutReminderAt(la("2026-12-12"))?.toISOString() === "2026-12-13T07:30:00.000Z");
check("LA late setup alert starts 5:30 PM Pacific", !clock.lateSetupDue(la("2026-12-12"), new Date("2026-12-13T01:29:00Z"), { hasStaff: true, hasBarReady: false }) && clock.lateSetupDue(la("2026-12-12"), new Date("2026-12-13T01:30:00Z"), { hasStaff: true, hasBarReady: false }));
check("LA service start label is the local wall time", clock.serviceStartLabel(la("2026-12-12")) === "6:00 PM");
// 48 hours before 6:00 PM Pacific on Dec 12 is 02:00Z Dec 11; in Dallas it is 00:00Z Dec 11.
const at0100 = new Date("2026-12-11T01:00:00Z");
check("48 hour contact phone rule uses Pacific time for LA", !view.showDayOfPhone(la("2026-12-12"), at0100) && view.showDayOfPhone(la("2026-12-12"), new Date("2026-12-11T02:00:00Z")));
check("48 hour contact phone rule uses Central time for Dallas", view.showDayOfPhone(dal("2026-12-12"), at0100));
check("LA timesheet time reads Pacific", ts.csvTime("2026-12-13T02:05:00Z", "America/Los_Angeles") === "2026-12-12 6:05 PM" && ts.csvTime("2026-12-13T02:05:00Z") === "2026-12-12 8:05 PM");
check("LA timesheet edits are typed in Pacific time", ts.parseLocal("2026-12-12T18:05", "America/Los_Angeles")?.toISOString() === "2026-12-13T02:05:00.000Z" && ts.toLocal("2026-12-13T02:05:00Z", "America/Los_Angeles") === "2026-12-12T18:05");
check("The event view carries the time zone", view.buildStaffEventView({ id: "x", event_data: { event_date: "2026-12-12" }, team_market: "los_angeles" }).timeZone === "America/Los_Angeles");
check("The working copy's time zone is never in the client's event_data", (() => { const s = { id: "x", event_data: { a: 1 }, team_market: "los_angeles" }; markets.eventData(s as never); return !("__tz" in s.event_data); })());

// ----- Database tests -----
const addDays = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const today = time.todayIn("America/Chicago");
const day10 = addDays(today, 10);
const day4 = addDays(today, 4);
const day1 = addDays(today, 1);

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true, markets: ["dallas"] };
const quietAdmin = { id: "a2", name: "Pat Jones", phone: "+12145550102", role: "admin" as const, active: true, alerts: false, markets: ["dallas"] };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true, markets: ["austin"] };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true, markets: ["dallas", "austin"] };
const b3 = { id: "b3", name: "Riley Park", phone: "+12145550113", role: "bartender" as const, active: true, markets: ["dallas"] };
const b4 = { id: "b4", name: "Gone Person", phone: "+12145550114", role: "bartender" as const, active: false, markets: ["austin"] };
const b5 = { id: "b5", name: "Casey Moore", phone: "+12145550115", role: "bartender" as const, active: true, markets: ["austin"] };

const CLIENT = { client_name: "Justin Reyes", client_email: "justin@example.com", client_phone: "+19725550199", event_name: "Justin's 30th" };
function event(id: string, day: string, address: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: "submitted",
    version: 1,
    event_date: day,
    guest_count: "80",
    package_type: "Full Bar",
    booked_price: { total: 1800, bartenders: 2 },
    event_data: { ...CLIENT, event_type: "Birthday", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: address, guest_count: 80, package: "Full Bar", bartenders: 2, ...extra },
    ...("team_market" in extra ? {} : {}),
  } as Record<string, unknown>;
}
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    event("s1", day10, "500 Congress Ave, Austin, TX 78701"),
    event("s2", day10, "1 Main St, Austin, TX 78701", { bar_service_start: "5:00pm", bar_service_end: "9:00pm" }), // b2 is on this one, same day
    event("s3", day4, "200 Elm St, Austin, TX 78701"),
    event("s4", day1, "10 Lake St, Austin, TX 78701"),
  ];
  db.staff = [admin, quietAdmin, b1, b2, b3, b4, b5].map((s) => ({ ...s }));
  db.event_assignments = [{ id: "as-s2-b2", session_id: "s2", staff_id: "b2", status: "accepted" }];
  db.shift_posts = [];
  db.shift_requests = [];
  db.shift_handoffs = [];
  db.team_notices = [];
  db.shift_notices = [];
  db.team_hidden_events = [];
  db.time_punches = [];
  db.staff_checks = [];
  db.staff_confirmations = [];
  texts.length = 0;
  geocodes = 0;
}
const session = (id: string) => db.sessions.find((s) => s.id === id) as never;
const textsTo = (s: { phone: string }) => texts.filter((t) => t.phone === s.phone);
const status = (sid: string, staffId: string) => db.event_assignments.find((a) => a.session_id === sid && a.staff_id === staffId)?.status;
const noClientData = (s: string) => !/Reyes|justin@example|9725550199|1800|30th|Congress|Justin/.test(s);

// ----- Event markets -----
reset();
const m1 = await marketsDb.ensureMarket(session("s1"));
const s1 = db.sessions[0];
check("An event's market is set from its address", m1 === "austin" && s1.team_market === "austin" && s1.team_market_source === "auto" && geocodes === 1);
check("The market is never written into event_data", !("team_market" in (s1.event_data as object)) && !("__tz" in (s1.event_data as object)));
await marketsDb.ensureMarket(session("s1"));
check("The market is worked out once per address", geocodes === 1);
(s1.event_data as Record<string, unknown>).event_address = "1 Ocean Ave, Santa Monica, CA";
check("A new address works the market out again", (await marketsDb.ensureMarket(session("s1"))) === "los_angeles" && geocodes === 2);
const set = await marketsDb.setEventMarket("s1", "houston", admin);
check("An admin can change the market", set.ok && s1.team_market === "houston" && s1.team_market_source === "admin" && s1.team_market_set_by === "a1");
(s1.event_data as Record<string, unknown>).event_address = "500 Congress Ave, Austin, TX";
check("A market an admin picked is kept when the address changes", (await marketsDb.ensureMarket(session("s1"))) === "houston");
check("An unknown market is refused", !(await marketsDb.setEventMarket("s1", "miami", admin)).ok);
(db.sessions[1].event_data as Record<string, unknown>).event_address = "1 Main St, Oklahoma City, OK";
check("An address far from every market gets no market", (await marketsDb.ensureMarket(session("s2"))) === null && db.sessions[1].team_market_source === "none");
check("ensureMarkets stops at the limit", (await marketsDb.ensureMarkets(db.sessions as never, 1)) === 1);

// ----- Adding staff: a market is required -----
reset();
const before = db.staff.length;
const noMk = await asgDb.createStaff({ first: "New", last: "Person", phone: "214 555 0199", role: "bartender" });
check("The add path refuses someone with no market", !noMk.ok && noMk.error === "Pick at least one market." && db.staff.length === before);
const emptyMk = await asgDb.createStaff({ first: "New", last: "Person", phone: "214 555 0199", role: "bartender", markets: [] });
check("The add path refuses an empty market list", !emptyMk.ok && db.staff.length === before);
const okMk = await asgDb.createStaff({ first: "New", last: "Person", phone: "214 555 0199", role: "bartender", markets: ["austin", "los_angeles"] });
check("The add path saves the markets checked", okMk.ok && okMk.staff.markets.join() === "austin,los_angeles" && db.staff.length === before + 1);
check("The staff list shows each person's markets", (await asgDb.listStaff()).find((x) => x.name === "New Person")?.markets.join() === "austin,los_angeles");
const staffForm = readFileSync(new URL("../app/team/admin/staff/staff-manager.tsx", import.meta.url), "utf8");
check("The add form starts with no market checked", staffForm.includes('initial={{ first: "", last: "", phone: "", role: "bartender", markets: [] }}'));
check("The add form cannot save until a market is checked", staffForm.includes("disabled={busy || v.markets.length === 0}") && staffForm.includes("if (v.markets.length === 0) {"));
check("The staff list shows markets on each row", staffForm.includes("Markets: {marketNames(s.markets)"));

// ----- Quiet hours and batching: the pure rules -----
const CT = "America/Chicago", PT = "America/Los_Angeles";
const ct = (ymd: string, h: number, m = 0) => time.zonedInstant(ymd, h * 60 + m, CT);
const pt = (ymd: string, h: number, m = 0) => time.zonedInstant(ymd, h * 60 + m, PT);
check("Quiet hours start at 9:00 PM", !shifts.inQuietHours(ct("2026-12-01", 20, 59), CT) && shifts.inQuietHours(ct("2026-12-01", 21), CT));
check("Quiet hours end at 8:00 AM", shifts.inQuietHours(ct("2026-12-02", 7, 59), CT) && !shifts.inQuietHours(ct("2026-12-02", 8), CT));
check("10:00 PM Central is 8:00 PM Pacific: quiet in Dallas, not in Los Angeles", shifts.inQuietHours(ct("2026-12-01", 22), CT) && !shifts.inQuietHours(ct("2026-12-01", 22), PT));
check("Held at night, sent at 8:00 AM the next morning", shifts.sendableAt(ct("2026-12-01", 23, 30), CT).getTime() === ct("2026-12-02", 8).getTime());
check("Held after midnight, sent at 8:00 AM the same morning", shifts.sendableAt(ct("2026-12-02", 2), CT).getTime() === ct("2026-12-02", 8).getTime());
check("8:00 AM is local: Pacific morning for Los Angeles", shifts.sendableAt(pt("2026-12-01", 23), PT).getTime() === pt("2026-12-02", 8).getTime());
check("Across the spring clock change, still 8:00 AM", shifts.sendableAt(ct("2027-03-13", 22), CT).getTime() === ct("2027-03-14", 8).getTime());
check("A single post waits 10 minutes", shifts.noticeSendAfter(ct("2026-12-01", 12), CT, "hold").getTime() === ct("2026-12-01", 12, 10).getTime());
check("A post at 8:55 PM would land in quiet hours, so it waits for 8:00 AM", shifts.noticeSendAfter(ct("2026-12-01", 20, 55), CT, "hold").getTime() === ct("2026-12-02", 8).getTime());
check("Post all is due right away", shifts.noticeSendAfter(ct("2026-12-01", 12), CT, "now").getTime() === ct("2026-12-01", 12).getTime());
check("The batch text wording", shifts.batchText({ count: 3, market: "Austin", link: "https://plan.test/team/events?tab=open" }) === "3 new Mix Fix shifts posted in Austin. See them and request: https://plan.test/team/events?tab=open");

// ----- Posting: one shift, held 10 minutes, then the detailed text -----
const NOON = ct(today, 12);
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const OPEN_LINK = "https://plan.test/team/events?tab=open";
const BATCH2 = `2 new Mix Fix shifts posted in Austin. See them and request: ${OPEN_LINK}`;
reset();
const noMarket = await shiftsDb.postShift(session("s1"), admin, NOON);
check("Posting works the market out first", noMarket.ok && db.sessions[0].team_market === "austin", JSON.stringify(noMarket));
check("Posting queues a text for every active bartender in the market", noMarket.ok && noMarket.plan.queued === 3 && db.shift_notices.map((n) => n.staff_id).sort().join() === "b1,b2,b5", JSON.stringify(db.shift_notices));
check("Nothing is sent at the moment of posting", texts.length === 0, JSON.stringify(texts));
check("The texts are due 10 minutes after posting", db.shift_notices.every((n) => n.send_after === plus(NOON, 10).toISOString() && n.status === "pending"));
check("The admin is told who gets a text and when", noMarket.ok && noMarket.message === "Posted. 3 bartenders get a text within 10 minutes, together with any other shifts you post to Austin.", noMarket.ok ? noMarket.message : "");
check("Not sent before the 10 minutes are up", (await shiftsDb.deliverShiftNotices(plus(NOON, 9))) === 0 && texts.length === 0);
const sentCount = await shiftsDb.deliverShiftNotices(plus(NOON, 10));
const notified = textsTo(b1).length + textsTo(b2).length;
check("After 10 minutes each bartender in the market gets one text", sentCount === 3 && notified === 2 && textsTo(b5).length === 1, JSON.stringify(texts));
check("Bartenders in other markets, inactive staff, and admins are not texted", textsTo(b3).length === 0 && textsTo(b4).length === 0 && textsTo(admin).length === 0);
const postMsg = textsTo(b1)[0]?.message ?? "";
const postId = (db.shift_posts[0]?.id as string) ?? "";
check(
  "A single shift keeps the detailed text",
  postMsg === `New Mix Fix shift: ${time.shortDate(day10)}, Austin, arrive 4:00 PM, service 6:00 PM to 10:00 PM. Details and request: https://plan.test/team/shifts/${postId}`,
  postMsg
);
check("The shift text has no client details", noClientData(postMsg));
check("Sent texts are marked sent, batch of 1", db.shift_notices.every((n) => n.status === "sent" && n.batch_size === 1 && n.sent_at === plus(NOON, 10).toISOString()));
check("The cron running again sends nothing twice", (await shiftsDb.deliverShiftNotices(plus(NOON, 25))) === 0 && texts.length === 3);
check("A second post is refused", !(await shiftsDb.postShift(session("s1"), admin, NOON)).ok && db.shift_posts.length === 1);
check("A second post queues nothing more", db.shift_notices.length === 3);

// ----- Batching: several shifts to one market within 10 minutes -----
reset();
await shiftsDb.postShift(session("s1"), admin, NOON);
await shiftsDb.postShift(session("s3"), admin, plus(NOON, 4));
await shiftsDb.deliverShiftNotices(plus(NOON, 10));
check("Two shifts posted 4 minutes apart: one text each", textsTo(b1).length === 1 && textsTo(b5).length === 1 && textsTo(b2).length === 1, JSON.stringify(texts));
check("The batch text names the count and the market, and links to Open shifts", textsTo(b1)[0]?.message === BATCH2, textsTo(b1)[0]?.message);
check("Batched rows are all marked sent with the batch size", db.shift_notices.every((n) => n.status === "sent" && n.batch_size === 2));
check("The batch text has no client details", noClientData(BATCH2));
reset();
await shiftsDb.postShift(session("s1"), admin, NOON);
await shiftsDb.deliverShiftNotices(plus(NOON, 10));
await shiftsDb.postShift(session("s3"), admin, plus(NOON, 12));
await shiftsDb.deliverShiftNotices(plus(NOON, 15));
check("A shift posted after the first text went out waits its own 10 minutes", textsTo(b1).length === 1);
await shiftsDb.deliverShiftNotices(plus(NOON, 22));
check("Then goes out as its own detailed text", textsTo(b1).length === 2 && textsTo(b1)[1].message.startsWith(`New Mix Fix shift: ${time.shortDate(day4)}, Austin`), JSON.stringify(textsTo(b1)));

// Different markets go out separately.
reset();
db.sessions.push(event("s8", day10, "1 Main St, Dallas, TX"));
await shiftsDb.postShift(session("s1"), admin, NOON);
await shiftsDb.postShift(session("s8"), admin, plus(NOON, 2));
await shiftsDb.deliverShiftNotices(plus(NOON, 10));
check("Each market's batch keeps its own 10 minutes", textsTo(b2).length === 1 && textsTo(b2)[0].message.includes(", Austin,") && textsTo(b3).length === 0);
await shiftsDb.deliverShiftNotices(plus(NOON, 12));
check("A bartender in two markets gets one text per market", textsTo(b2).length === 2 && textsTo(b2).some((t) => t.message.includes(", Austin,")) && textsTo(b2).some((t) => t.message.includes(", Dallas,")), JSON.stringify(textsTo(b2)));
check("Dallas only bartenders get only the Dallas shift", textsTo(b3).length === 1 && textsTo(b3)[0].message.includes(", Dallas,") && textsTo(b1).length === 1 && textsTo(b1)[0].message.includes(", Austin,"));

// Filled or unposted in the meantime.
reset();
await shiftsDb.postShift(session("s1"), admin, NOON);
await shiftsDb.postShift(session("s3"), admin, plus(NOON, 1));
await shiftsDb.unpostShift(db.shift_posts.find((p) => p.session_id === "s3")!.id as string, admin);
await shiftsDb.deliverShiftNotices(plus(NOON, 10));
check("An unposted shift is skipped: the other one goes out as the detailed text", textsTo(b1).length === 1 && textsTo(b1)[0].message.startsWith(`New Mix Fix shift: ${time.shortDate(day10)}`), JSON.stringify(textsTo(b1)));
check("Its rows are marked skipped", db.shift_notices.filter((n) => n.post_id === db.shift_posts.find((p) => p.session_id === "s3")!.id).every((n) => n.status === "skipped"));
reset();
await shiftsDb.postShift(session("s1"), admin, NOON);
await asgDb.assignStaff(session("s1"), "b1", admin, "https://plan.test");
await asgDb.assignStaff(session("s1"), "b3", admin, "https://plan.test");
texts.length = 0;
await shiftsDb.deliverShiftNotices(plus(NOON, 10));
check("A shift filled in the meantime is skipped for everyone", texts.length === 0 && db.shift_posts[0].status === "filled" && db.shift_notices.every((n) => n.status === "skipped"), JSON.stringify(texts));
reset();
await shiftsDb.postShift(session("s1"), admin, NOON);
await asgDb.assignStaff(session("s1"), "b1", admin, "https://plan.test");
texts.length = 0;
await shiftsDb.deliverShiftNotices(plus(NOON, 10));
check("Someone put on the event in the meantime is not texted about it; the others are", textsTo(b1).length === 0 && textsTo(b2).length === 1 && textsTo(b5).length === 1);
reset();
await shiftsDb.postShift(session("s1"), admin, NOON);
db.staff.find((x) => x.id === "b5")!.active = false;
await shiftsDb.deliverShiftNotices(plus(NOON, 10));
check("Someone deactivated in the meantime is not texted", textsTo(b5).length === 0 && textsTo(b1).length === 1);

// ----- Quiet hours -----
const TEN_PM = ct(today, 22);
const tomorrow = addDays(today, 1);
reset();
const late = await shiftsDb.postShift(session("s1"), admin, TEN_PM);
check("A post at 10:00 PM Central is held for 8:00 AM", late.ok && late.plan.quiet && db.shift_notices.every((n) => n.send_after === ct(tomorrow, 8).toISOString()), JSON.stringify(db.shift_notices));
check("The admin is told it goes out at 8:00 AM", late.ok && late.message === "Posted. It is quiet hours in Austin, so 3 bartenders get a text at 8:00 AM.", late.ok ? late.message : "");
await shiftsDb.deliverShiftNotices(plus(TEN_PM, 15));
await shiftsDb.deliverShiftNotices(ct(tomorrow, 3));
await shiftsDb.deliverShiftNotices(ct(tomorrow, 7, 59));
check("Nothing goes out overnight", texts.length === 0);
await shiftsDb.postShift(session("s3"), admin, ct(tomorrow, 1));
await shiftsDb.deliverShiftNotices(ct(tomorrow, 8));
check("At 8:00 AM the held shifts go out, batched", textsTo(b1).length === 1 && textsTo(b1)[0].message === BATCH2 && textsTo(b5).length === 1, JSON.stringify(texts));
reset();
await shiftsDb.postShift(session("s1"), admin, ct(today, 20, 55));
check("A post at 8:55 PM is held for the morning, not sent at 9:05 PM", db.shift_notices.every((n) => n.send_after === ct(tomorrow, 8).toISOString()));
// A row due before quiet hours, still pending when they start, waits too.
reset();
await shiftsDb.postShift(session("s1"), admin, ct(today, 20, 40));
await shiftsDb.deliverShiftNotices(ct(today, 21, 5));
check("A text due at 8:50 PM but not run until 9:05 PM waits for 8:00 AM", texts.length === 0 && db.shift_notices.every((n) => n.status === "pending"));
await shiftsDb.deliverShiftNotices(ct(tomorrow, 8, 15));
check("And goes out in the morning", textsTo(b1).length === 1);
// Overnight, a held shift that gets unposted is skipped.
reset();
await shiftsDb.postShift(session("s1"), admin, TEN_PM);
await shiftsDb.unpostShift(db.shift_posts[0].id as string, admin);
await shiftsDb.deliverShiftNotices(ct(tomorrow, 8));
check("A shift unposted overnight is never texted", texts.length === 0 && db.shift_notices.every((n) => n.status === "skipped"));
// Los Angeles keeps its own clock.
reset();
const b6 = { id: "b6", name: "Avery Kim", phone: "+13105550116", role: "bartender" as const, active: true, markets: ["los_angeles"] };
db.staff.push({ ...b6 });
db.sessions.push({ ...event("la2", day10, "1 Ocean Ave, Santa Monica, CA"), team_market: "los_angeles", team_market_source: "admin", team_market_address: "1 Ocean Ave, Santa Monica, CA" });
const laPost = await shiftsDb.postShift(session("la2"), admin, TEN_PM);
check("10:00 PM Central is 8:00 PM in Los Angeles: not quiet there", laPost.ok && !laPost.plan.quiet && db.shift_notices[0]?.send_after === plus(TEN_PM, 10).toISOString(), JSON.stringify(laPost));
await shiftsDb.deliverShiftNotices(plus(TEN_PM, 10));
check("The Los Angeles bartender is texted at 8:10 PM Pacific", textsTo(b6).length === 1);
reset();
db.staff.push({ ...b6 });
db.sessions.push({ ...event("la2", day10, "1 Ocean Ave, Santa Monica, CA"), team_market: "los_angeles", team_market_source: "admin", team_market_address: "1 Ocean Ave, Santa Monica, CA" });
await shiftsDb.postShift(session("la2"), admin, ct(tomorrow, 9)); // 7:00 AM Pacific
check("9:00 AM Central is 7:00 AM Pacific: held for 8:00 AM Pacific", db.shift_notices[0]?.send_after === pt(tomorrow, 8).toISOString());
await shiftsDb.deliverShiftNotices(ct(tomorrow, 9, 30));
check("Not sent at 7:30 AM Pacific", textsTo(b6).length === 0);
await shiftsDb.deliverShiftNotices(pt(tomorrow, 8));
check("Sent at 8:00 AM Pacific", textsTo(b6).length === 1);

// Urgent cover posts ignore quiet hours; others wait.
reset();
db.event_assignments.push({ id: "h4", session_id: "s4", staff_id: "b1", status: "accepted" });
await shiftsDb.startHandoff(session("s4"), b1, { mode: "market", reason: "Sick" }, TEN_PM);
check("An urgent cover post at 10:00 PM texts the market right away", textsTo(b5).length === 1 && textsTo(b5)[0].message.startsWith("Mix Fix shift, cover needed:") && textsTo(b2).length === 1 && db.shift_notices.length === 0, JSON.stringify(texts));
check("And the urgent admin alert goes too", textsTo(admin).length === 1 && textsTo(admin)[0].message.startsWith("URGENT:"));
reset();
db.event_assignments.push({ id: "h1", session_id: "s1", staff_id: "b1", status: "accepted" });
await shiftsDb.startHandoff(session("s1"), b1, { mode: "market", reason: "Family thing" }, TEN_PM);
check("A cover post 10 days out at 10:00 PM is held for 8:00 AM", textsTo(b5).length === 0 && db.shift_notices.length === 2 && db.shift_notices.every((n) => n.send_after === ct(tomorrow, 8).toISOString()), JSON.stringify(db.shift_notices));
check("The giver is never queued for their own cover post", !db.shift_notices.some((n) => n.staff_id === "b1"));
await shiftsDb.deliverShiftNotices(ct(tomorrow, 8));
check("At 8:00 AM it goes out as cover needed", textsTo(b5).length === 1 && textsTo(b5)[0].message.startsWith("Mix Fix shift, cover needed:"));
reset();
db.event_assignments.push({ id: "h1", session_id: "s1", staff_id: "b1", status: "accepted" });
await shiftsDb.startHandoff(session("s1"), b1, { mode: "market", reason: "Family thing" }, TEN_PM);
await shiftsDb.cancelHandoff(db.shift_handoffs[0].id as string, b1);
await shiftsDb.deliverShiftNotices(ct(tomorrow, 8));
check("A cover post cancelled overnight is never texted", textsTo(b5).length === 0 && db.shift_notices.every((n) => n.status === "skipped"));

// Texts about a bartender's own shift go right away, quiet hours or not.
reset();
await shiftsDb.postShift(session("s1"), admin, TEN_PM);
await shiftsDb.requestShift(db.shift_posts[0].id as string, b1);
await shiftsDb.requestShift(db.shift_posts[0].id as string, b5);
texts.length = 0;
await shiftsDb.approveRequest(admin, db.shift_posts[0].id as string, "b1");
check("An approval texts the bartender right away, even with new shift texts held", textsTo(b1).length === 1 && textsTo(b1)[0].message.startsWith("You got the shift"));
await asgDb.assignStaff(session("s1"), "b3", admin, "https://plan.test");
check("Filled texts go right away too", textsTo(b5).some((t) => /has been filled/.test(t.message)));
await shiftsDb.deliverShiftNotices(ct(tomorrow, 8));
check("The held new shift text for a filled shift is skipped in the morning", textsTo(b2).length === 0 && db.shift_notices.every((n) => n.status === "skipped"));

// The claim step: two cron runs at once send once.
reset();
await shiftsDb.postShift(session("s1"), admin, NOON);
const [ra, rb] = await Promise.all([shiftsDb.deliverShiftNotices(plus(NOON, 10)), shiftsDb.deliverShiftNotices(plus(NOON, 10))]);
check("Two deliveries at once never double send", ra + rb === 3 && textsTo(b1).length === 1 && textsTo(b5).length === 1, `${ra} ${rb} ${JSON.stringify(texts)}`);

// A failed text never blocks the post.
reset();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => (String(input) === process.env.GHL_STAFF_SMS_WEBHOOK ? new Response("down", { status: 500 }) : realFetch(input, init))) as typeof fetch;
const okPost = await shiftsDb.postShift(session("s1"), admin, NOON);
await shiftsDb.deliverShiftNotices(plus(NOON, 10));
globalThis.fetch = realFetch;
check("A failed text never blocks posting, and is marked failed", okPost.ok && db.shift_posts[0].status === "posted" && db.shift_notices.every((n) => n.status === "failed"));

reset();
db.team_hidden_events = [{ session_id: "s1" }];
const hid = await shiftsDb.postShift(session("s1"), admin);
check("Hidden events cannot be posted", !hid.ok && /hidden/i.test(hid.error) && db.shift_posts.length === 0);
reset();
(db.sessions[0].event_data as Record<string, unknown>).event_address = "1 Main St, Oklahoma City, OK";
const nm = await shiftsDb.postShift(session("s1"), admin);
check("An event with no market cannot be posted", !nm.ok && /market/i.test(nm.error));
reset();
db.event_assignments.push({ id: "x1", session_id: "s1", staff_id: "b1", status: "accepted" }, { id: "x2", session_id: "s1", staff_id: "b5", status: "offered" });
check("A fully staffed event cannot be posted", !(await shiftsDb.postShift(session("s1"), admin)).ok);
reset();
await shiftsDb.postShift(session("s1"), admin);
const posted = db.shift_posts[0];
const hideTry = await hidden.hideEvent("s1", admin);
check("A posted event cannot be hidden until it is unposted", !hideTry.ok && /Unpost/.test(hideTry.error));
check("An admin can unpost", (await shiftsDb.unpostShift(posted.id as string, admin)).ok && posted.status === "unposted");
check("Unposted, it can be posted again", (await shiftsDb.postShift(session("s1"), admin)).ok);

// ----- Post all unstaffed -----
reset();
db.sessions.push(event("s5", addDays(today, -3), "1 Past St, Austin, TX"), event("s6", day10, "Hidden Rd, Austin, TX"), event("s7", day10, "9 Far Rd, Oklahoma City, OK"));
db.team_hidden_events = [{ session_id: "s6" }];
db.event_assignments.push({ id: "full1", session_id: "s3", staff_id: "b1", status: "accepted" }, { id: "full2", session_id: "s3", staff_id: "b5", status: "accepted" });
const all = await shiftsDb.postAllUnstaffed(admin, null, NOON);
const postedIds = db.shift_posts.map((p) => p.session_id).sort().join();
check("Post all posts every unstaffed upcoming event", all.posted === 3 && postedIds === "s1,s2,s4", `${JSON.stringify(all)} ${postedIds}`);
check("Post all skips past, hidden, and fully staffed events, and counts events with no market", all.noMarket === 1 && !postedIds.includes("s5") && !postedIds.includes("s6") && !postedIds.includes("s3"));
check("Post all texts right away, one text per bartender per market", textsTo(b1).length === 1 && textsTo(b5).length === 1 && textsTo(b2).length === 1, JSON.stringify(texts));
check("Post all: 3 shifts for someone free for all of them", textsTo(b1)[0]?.message === `3 new Mix Fix shifts posted in Austin. See them and request: ${OPEN_LINK}`, textsTo(b1)[0]?.message);
check("Post all: a bartender already on one event hears about the other two", textsTo(b2)[0]?.message === BATCH2, textsTo(b2)[0]?.message);
check("Post all reports texts sent and none held at noon", all.texted === 3 && all.held === 0, JSON.stringify(all));
check("Post all again posts nothing new", (await shiftsDb.postAllUnstaffed(admin, null, plus(NOON, 1))).posted === 0 && texts.length === 3);
reset();
const allLate = await shiftsDb.postAllUnstaffed(admin, null, TEN_PM);
check("Post all at 10:00 PM sends nothing and holds one text per bartender", texts.length === 0 && allLate.texted === 0 && allLate.held === 3, JSON.stringify(allLate));
await shiftsDb.deliverShiftNotices(ct(tomorrow, 8));
check("Post all's held texts go out at 8:00 AM, batched", textsTo(b1).length === 1 && textsTo(b1)[0].message === `4 new Mix Fix shifts posted in Austin. See them and request: ${OPEN_LINK}`, JSON.stringify(textsTo(b1)));
reset();
db.sessions.push(event("s8", day10, "1 Main St, Houston, TX"));
const onlyHouston = await shiftsDb.postAllUnstaffed(admin, "houston", NOON);
check("Post all can be limited to one market", onlyHouston.posted === 1 && db.shift_posts.map((p) => p.session_id).join() === "s8", JSON.stringify(onlyHouston));

// ----- Bartender view and requests -----
reset();
await shiftsDb.postShift(session("s1"), admin);
const pid = db.shift_posts[0].id as string;
texts.length = 0;
check("Bartenders in other markets see no open shifts", (await shiftsDb.openShiftsFor(b3)).length === 0);
const list1 = await shiftsDb.openShiftsFor(b1);
check("Bartenders see shifts posted to their markets", list1.length === 1 && list1[0].shift.postId === pid);
const sum = list1[0].shift;
check("The shift shows date, times, city, type, guests, package, and bartenders", sum.arrival === "4:00 PM" && sum.serviceStart === "6:00 PM" && sum.serviceEnd === "10:00 PM" && sum.city === "Austin" && sum.eventType === "Birthday" && sum.guestCount === "80" && sum.package === "Full Bar" && sum.bartenders === 2, JSON.stringify(sum));
check("The shift never shows the client name, event name, street address, contact details, or pricing", noClientData(JSON.stringify(list1)), JSON.stringify(list1));
check("A shift detail outside your markets is not shown", (await shiftsDb.shiftForStaff(pid, b3)).state === "gone");
check("An inactive bartender sees nothing", (await shiftsDb.openShiftsFor(b4)).length === 0 && (await shiftsDb.shiftForStaff(pid, b4)).state === "gone");
const b2view = await shiftsDb.shiftForStaff(pid, b2);
check("The detail says when they already have an event that day, and that it overlaps", b2view.state === "open" && b2view.item.sameDay.length === 1 && b2view.item.sameDay[0].overlaps, JSON.stringify(b2view));
check("No other event that day for someone free", (await shiftsDb.shiftForStaff(pid, b1)).state === "open" && ((await shiftsDb.shiftForStaff(pid, b1)) as { item: { sameDay: unknown[] } }).item.sameDay.length === 0);
check("Requesting outside your markets is refused", !(await shiftsDb.requestShift(pid, b3)).ok && db.shift_requests.length === 0);
const r1 = await shiftsDb.requestShift(pid, b1);
check("A bartender requests the shift", r1.ok && !r1.overlap && db.shift_requests.length === 1 && db.shift_requests[0].status === "requested");
check("The first request texts admins with alerts on", textsTo(admin).length === 1 && textsTo(quietAdmin).length === 0 && textsTo(admin)[0].message.startsWith("Jordan requested the open shift for") && textsTo(admin)[0].message.endsWith("https://plan.test/team/admin/e/s1"), JSON.stringify(texts));
const r2 = await shiftsDb.requestShift(pid, b2);
check("An overlapping request is allowed, with a warning", r2.ok && r2.overlap);
check("Only the first request texts admins", textsTo(admin).length === 1);
check("A request can be withdrawn", (await shiftsDb.withdrawRequest(pid, b2)).ok && db.shift_requests.find((r) => r.staff_id === "b2")?.status === "withdrawn");
check("Withdrawn twice is refused", !(await shiftsDb.withdrawRequest(pid, b2)).ok);
check("And requested again", (await shiftsDb.requestShift(pid, b2)).ok && db.shift_requests.find((r) => r.staff_id === "b2")?.status === "requested" && db.shift_requests.length === 2);
await shiftsDb.requestShift(pid, b5);

// ----- Choosing -----
const panel = await shiftsDb.postPanel(session("s1"));
check("The admin sees everyone who asked, in order", panel.requesters.map((r) => r.staffId).join() === "b1,b2,b5" && panel.spotsOpen === 2, JSON.stringify(panel.requesters));
check("With their other events that day", panel.requesters.find((r) => r.staffId === "b2")?.sameDay.length === 1);
db.sessions.push(event("past1", addDays(today, -20), "1 Old St, Austin, TX"));
db.event_assignments.push({ id: "p1", session_id: "past1", staff_id: "b1", status: "accepted" });
check("And how many events they have worked", (await shiftsDb.postPanel(session("s1"))).requesters.find((r) => r.staffId === "b1")?.eventsWorked === 1);
texts.length = 0;
const ap1 = await shiftsDb.approveRequest(admin, pid, "b1");
check("Approving makes an accepted assignment with no accept step", ap1.ok && status("s1", "b1") === "accepted");
check("The approved bartender is texted the event page", textsTo(b1).length === 1 && textsTo(b1)[0].message === `You got the shift on ${time.shortDate(day10)}. Event page: https://plan.test/team/e/s1`, JSON.stringify(texts));
check("The shift stays posted while a spot is open", db.shift_posts[0].status === "posted");
check("Approving someone who did not ask is refused", !(await shiftsDb.approveRequest(admin, pid, "b3")).ok);
const ap2 = await shiftsDb.approveRequest(admin, pid, "b2");
check("The last spot fills and the shift unposts", ap2.ok && db.shift_posts[0].status === "filled");
check("Everyone else who asked is texted that it is filled", textsTo(b5).length === 1 && textsTo(b5)[0].message.startsWith(`The Mix Fix shift on ${time.shortDate(day10)} has been filled.`) && db.shift_requests.find((r) => r.staff_id === "b5")?.status === "not_chosen");
check("The people who got it are not texted that it filled", textsTo(b1).length === 1 && textsTo(b2).length === 1);
check("No more approvals once filled", !(await shiftsDb.approveRequest(admin, pid, "b5")).ok);
check("A filled shift is gone from the open list", (await shiftsDb.openShiftsFor(b5)).length === 0);
check("Whoever got it sees it on the detail page", (await shiftsDb.shiftForStaff(pid, b1)).state === "got");

// Assigning directly still works, and fills a posted shift.
reset();
await shiftsDb.postShift(session("s1"), admin);
const pid2 = db.shift_posts[0].id as string;
await shiftsDb.requestShift(pid2, b5);
texts.length = 0;
await asgDb.assignStaff(session("s1"), "b1", admin, "https://plan.test");
check("Assigning directly still offers and texts as before", status("s1", "b1") === "offered" && textsTo(b1).length === 1 && textsTo(b1)[0].message.includes("Accept or decline"));
check("One spot still open, still posted", db.shift_posts[0].status === "posted");
await asgDb.assignStaff(session("s1"), "b3", admin, "https://plan.test");
check("A direct assign that fills the last spot unposts the shift and texts the requesters", db.shift_posts[0].status === "filled" && textsTo(b5).length === 1 && /filled/.test(textsTo(b5)[0].message));

// ----- Short shift alert, 5 days out -----
reset();
await shiftsDb.postShift(session("s3"), admin); // 4 days out
await shiftsDb.postShift(session("s1"), admin); // 10 days out
texts.length = 0;
const short1 = await shiftsDb.sendShortShiftAlerts(new Date());
check("A posted shift still short 5 days out texts admins once", short1 === 1 && textsTo(admin).length === 1 && textsTo(admin)[0].message.includes("is still short 2 bartenders, 0 requests so far.") && textsTo(quietAdmin).length === 0, JSON.stringify(texts));
check("The short alert goes once", (await shiftsDb.sendShortShiftAlerts(new Date())) === 0 && textsTo(admin).length === 1);
check("Not yet for a shift 10 days out", !textsTo(admin)[0].message.includes(time.shortDate(day10)));

// ----- Handoffs: named teammate -----
reset();
db.event_assignments.push({ id: "h1", session_id: "s1", staff_id: "b1", status: "accepted" });
db.staff_checks.push({ staff_id: "b1", session_id: "s1", list: "checklist", item_key: "ice", checked: true }, { staff_id: "b5", session_id: "s1", list: "checklist", item_key: "ice", checked: true });
db.staff_confirmations.push({ staff_id: "b5", session_id: "s1", confirmed_at: "x" });
check("A handoff needs a reason", !(await shiftsDb.startHandoff(session("s1"), b1, { mode: "teammate", teammateId: "b5", reason: " " })).ok);
check("A handoff needs a choice", !(await shiftsDb.startHandoff(session("s1"), b1, { mode: "other", reason: "Family thing" })).ok);
const wrong = await shiftsDb.startHandoff(session("s1"), b1, { mode: "teammate", teammateId: "b3", reason: "Family thing" });
check("The named teammate must work the event's market", !wrong.ok && /market/.test(wrong.error), JSON.stringify(wrong));
check("Not to yourself", !(await shiftsDb.startHandoff(session("s1"), b1, { mode: "teammate", teammateId: "b1", reason: "Family thing" })).ok);
const choices = await shiftsDb.teammateChoices(session("s1"), "b1");
check("The teammate list is the event's market, active, and not on the event", choices.map((c) => c.id).sort().join() === "b2,b5", JSON.stringify(choices));
texts.length = 0;
const h1 = await shiftsDb.startHandoff(session("s1"), b1, { mode: "teammate", teammateId: "b5", reason: "Family thing" });
const hRow = db.shift_handoffs[0];
check("Offering to a named teammate texts them to accept or decline", h1.ok && hRow.status === "asked" && textsTo(b5).length === 1 && textsTo(b5)[0].message.includes(`https://plan.test/team/handoff/${hRow.id}`) && textsTo(b5)[0].message.startsWith("Hi Casey, Jordan asked you to take"), JSON.stringify(texts));
check("No admin text until the teammate accepts", textsTo(admin).length === 0);
check("Until approved the original bartender stays assigned", status("s1", "b1") === "accepted" && !status("s1", "b5"));
const mine = await shiftsDb.myHandoff("s1", "b1");
check("Their page shows the open handoff", mine?.status === "asked" && mine.teammateName === "Casey Moore");
check("A second handoff on the same event is refused", !(await shiftsDb.startHandoff(session("s1"), b1, { mode: "market", reason: "Family thing" })).ok);
const tview = await shiftsDb.handoffForTeammate(hRow.id as string, b5);
check("The teammate sees only the shift summary", !!tview && noClientData(JSON.stringify(tview.shift)) && tview.fromName === "Jordan");
check("Nobody else can open the teammate request", !(await shiftsDb.handoffForTeammate(hRow.id as string, b2)));
check("Only the named teammate can answer", !(await shiftsDb.respondHandoff(hRow.id as string, b2, "accept")).ok);
check("An admin cannot approve before the teammate accepts", !(await shiftsDb.approveHandoff(hRow.id as string, admin)).ok);
await shiftsDb.respondHandoff(hRow.id as string, b5, "accept");
check("When the teammate accepts, admins with alerts on are texted to approve", hRow.status === "teammate_accepted" && textsTo(admin).length === 1 && textsTo(admin)[0].message.startsWith("Casey agreed to take Jordan's shift") && textsTo(quietAdmin).length === 0, JSON.stringify(texts));
check("Not marked URGENT 10 days out", !textsTo(admin)[0].message.includes("URGENT"));
check("The reason is in the admin text", textsTo(admin)[0].message.includes('Reason: "Family thing"'));
check("Still on the shift until an admin approves", status("s1", "b1") === "accepted");
texts.length = 0;
const appr = await shiftsDb.approveHandoff(hRow.id as string, admin);
check("Approving moves the assignment", appr.ok && !status("s1", "b1") && status("s1", "b5") === "accepted" && hRow.status === "approved");
check("The original bartender is texted that they are released", textsTo(b1).length === 1 && textsTo(b1)[0].message.includes("You are released from the Mix Fix shift"));
check("The replacement is texted the event page", textsTo(b5).length === 1 && textsTo(b5)[0].message === `You got the shift on ${time.shortDate(day10)}. Event page: https://plan.test/team/e/s1`);
check("Checklist progress does not carry over to the replacement", !db.staff_checks.some((c) => c.staff_id === "b5" && c.session_id === "s1") && !db.staff_confirmations.some((c) => c.staff_id === "b5"));
check("An approved handoff cannot be cancelled", !(await shiftsDb.cancelHandoff(hRow.id as string, b1)).ok);

// Teammate declines.
reset();
db.event_assignments.push({ id: "h1", session_id: "s1", staff_id: "b1", status: "accepted" });
await shiftsDb.startHandoff(session("s1"), b1, { mode: "teammate", teammateId: "b5", reason: "Family thing" });
texts.length = 0;
await shiftsDb.respondHandoff(db.shift_handoffs[0].id as string, b5, "decline");
check("A teammate decline texts the original bartender, who stays on", db.shift_handoffs[0].status === "teammate_declined" && textsTo(b1).length === 1 && textsTo(b1)[0].message.includes("can't take your Mix Fix shift") && status("s1", "b1") === "accepted");
check("After a decline they can ask again", (await shiftsDb.startHandoff(session("s1"), b1, { mode: "market", reason: "Family thing" })).ok);

// ----- Handoffs: open to the market, inside 48 hours -----
reset();
db.event_assignments.push({ id: "h4", session_id: "s4", staff_id: "b1", status: "accepted" });
texts.length = 0;
const hm = await shiftsDb.startHandoff(session("s4"), b1, { mode: "market", reason: "Sick" });
const cover = db.shift_posts.find((p) => p.kind === "cover");
check("Opening to the market posts it as cover needed", hm.ok && !!cover && cover.status === "posted" && db.shift_handoffs[0].status === "open");
check("Bartenders in the market are texted, cover needed", textsTo(b5).length === 1 && textsTo(b5)[0].message.startsWith("Mix Fix shift, cover needed:") && textsTo(b1).length === 0);
check("Inside 48 hours the admin alert is marked URGENT", textsTo(admin).length === 1 && textsTo(admin)[0].message.startsWith("URGENT: Jordan wants to give up") && db.shift_handoffs[0].urgent === true, JSON.stringify(texts));
const coverList = await shiftsDb.openShiftsFor(b5);
check("The cover shift shows in Open shifts as cover needed", coverList.length === 1 && coverList[0].shift.cover);
check("The original bartender does not see their own cover post", (await shiftsDb.openShiftsFor(b1)).length === 0 && !(await shiftsDb.requestShift(cover!.id as string, b1)).ok);
check("Bartenders request it the same way", (await shiftsDb.requestShift(cover!.id as string, b5)).ok && (await shiftsDb.requestShift(cover!.id as string, b2)).ok);
check("Cover posts are not unposted directly", !(await shiftsDb.unpostShift(cover!.id as string, admin)).ok);
const hp = await shiftsDb.handoffPanel(session("s4"));
check("The admin page lists the handoff with its requests", hp.length === 1 && hp[0].urgent && hp[0].requesters.length === 2 && hp[0].fromName === "Jordan Lee");
texts.length = 0;
const pick = await shiftsDb.approveRequest(admin, cover!.id as string, "b5");
check("Approving a requester moves the shift to them", pick.ok && !status("s4", "b1") && status("s4", "b5") === "accepted" && db.shift_handoffs[0].status === "approved" && cover!.status === "filled");
check("Released, replacement, and filled texts", textsTo(b1).some((t) => t.message.includes("released")) && textsTo(b5).some((t) => t.message.startsWith("You got the shift")) && textsTo(b2).some((t) => t.message.includes("has been filled")));

// Cancel and admin decline.
reset();
db.event_assignments.push({ id: "h4", session_id: "s4", staff_id: "b1", status: "accepted" });
await shiftsDb.startHandoff(session("s4"), b1, { mode: "market", reason: "Sick" });
await shiftsDb.requestShift(db.shift_posts[0].id as string, b5);
texts.length = 0;
check("Someone else cannot cancel it", !(await shiftsDb.cancelHandoff(db.shift_handoffs[0].id as string, b5)).ok);
const cx = await shiftsDb.cancelHandoff(db.shift_handoffs[0].id as string, b1);
check("The bartender cancels their own handoff before approval", cx.ok && db.shift_handoffs[0].status === "cancelled" && db.shift_posts[0].status === "unposted" && status("s4", "b1") === "accepted");
check("Requesters are told it is no longer open", textsTo(b5).length === 1 && textsTo(b5)[0].message.includes("no longer open"));
await shiftsDb.startHandoff(session("s4"), b1, { mode: "teammate", teammateId: "b5", reason: "Sick" });
const h2 = db.shift_handoffs.find((h) => h.status === "asked")!;
texts.length = 0;
const dec = await shiftsDb.declineHandoff(h2.id as string, admin);
check("An admin declines: the original bartender is texted they are still on", dec.ok && h2.status === "admin_declined" && textsTo(b1).length === 1 && textsTo(b1)[0].message.includes("You are still on the shift") && status("s4", "b1") === "accepted");
check("The teammate is told they are not needed", textsTo(b5).length === 1 && textsTo(b5)[0].message.includes("no longer needs you"));

// Rules.
reset();
db.event_assignments.push({ id: "h1", session_id: "s1", staff_id: "b1", status: "accepted" }, { id: "h5", session_id: "s1", staff_id: "b5", status: "offered" });
db.time_punches.push({ id: "tp", assignment_id: "h1", staff_id: "b1", session_id: "s1", type: "in", punched_at: new Date().toISOString() });
const clocked = await shiftsDb.startHandoff(session("s1"), b1, { mode: "market", reason: "Sick" });
check("No handoff after clocking in", !clocked.ok && /clocked in/.test(clocked.error));
check("Only an accepted event can be given up", !(await shiftsDb.startHandoff(session("s1"), b5, { mode: "market", reason: "Sick" })).ok);
check("A bartender not on the event cannot hand it off", !(await shiftsDb.startHandoff(session("s1"), b2, { mode: "market", reason: "Sick" })).ok);
reset();
db.event_assignments.push({ id: "h1", session_id: "s1", staff_id: "b1", status: "accepted" });
await shiftsDb.startHandoff(session("s1"), b1, { mode: "market", reason: "Sick" });
await asgDb.removeStaff(session("s1"), "b1");
check("Removing the bartender closes their handoff and its cover post", db.shift_handoffs[0].status === "cancelled" && db.shift_posts[0].status === "unposted");
reset();
db.event_assignments.push({ id: "h1", session_id: "s1", staff_id: "b1", status: "accepted" });
await shiftsDb.startHandoff(session("s1"), b1, { mode: "market", reason: "Sick" });
await asgDb.respondToAssignment("s1", b1, "decline", "https://plan.test");
check("Declining the event closes their handoff", db.shift_handoffs[0].status === "cancelled");

// No bartender text anywhere carries client details.
check("No text to a bartender carries client details", texts.filter((t) => ![admin.phone, quietAdmin.phone].includes(t.phone)).every((t) => noClientData(t.message)), JSON.stringify(texts));

// LA punch through the database: refused at 3:20 PM Pacific, saved at 3:31 PM.
reset();
const laDay = "2026-12-12";
db.sessions.push({ id: "la1", status: "submitted", version: 1, event_date: laDay, team_market: "los_angeles", team_market_source: "admin", event_data: { event_type: "Birthday", event_date: laDay, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: "1 Ocean Ave, Santa Monica, CA" } });
db.event_assignments.push({ id: "la-a", session_id: "la1", staff_id: "b5", status: "accepted" });
const RealDate = Date;
const freeze = (iso: string) => {
  const t = new RealDate(iso).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...a: ConstructorParameters<typeof Date>) {
      if (a.length === 0) super(t);
      else super(...a);
    }
    static now() {
      return t;
    }
  } as DateConstructor;
};
freeze("2026-12-12T23:20:00Z");
const tooEarly = await clockDb.recordPunch({ session: session("la1"), staff: b5, type: "in", location: null, clientTime: null, clientId: null });
check("An LA punch at 3:20 PM Pacific is refused: clock in opens at 3:30 PM", !tooEarly.ok && tooEarly.error === "Clock in opens at 3:30 PM.", JSON.stringify(tooEarly));
freeze("2026-12-12T23:31:00Z");
const onTime = await clockDb.recordPunch({ session: session("la1"), staff: b5, type: "in", location: null, clientTime: null, clientId: null });
check("At 3:31 PM Pacific it saves, and the clock card shows Pacific time", onTime.ok && onTime.view.timeZone === "America/Los_Angeles" && onTime.view.opensAt === "2026-12-12T23:30:00.000Z");
globalThis.Date = RealDate;

// ----- Source checks -----
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const shiftsSrc = src("lib/team/shifts-db.ts");
check("Every shift text goes through sendStaffText", !/fetch\(/.test(shiftsSrc) && shiftsSrc.includes("sendStaffText("));
check("Shift pages only show the allowlisted summary", src("app/team/shifts/shift-card.tsx").includes("ShiftSummary") && !/event_data|client_name|event_address/.test(src("app/team/shifts/shift-card.tsx")));
check("Admin shift and handoff routes are admin only", ["app/api/team/admin/shifts/route.ts", "app/api/team/admin/handoff/route.ts", "app/api/team/admin/market/route.ts"].every((p) => src(p).includes('role !== "admin"') && src(p).includes("status: 403")));
check("Bartender shift routes need a sign in", ["app/api/team/shifts/route.ts", "app/api/team/handoff/route.ts"].every((p) => src(p).includes("getCurrentStaff()") && src(p).includes("status: 401")));
check("The cron sends held shift texts", src("app/api/cron/team/route.ts").includes("deliverShiftNotices(now)"));
check("Only new shift texts are queued: one place writes shift_notices rows", (shiftsSrc.match(/from\("shift_notices"\)\.upsert/g) ?? []).length === 1);
check("Own shift texts are sent directly, never queued", ["gotShiftText(", "filledText(", "releasedText(", "stillOnShiftText(", "teammateDeclinedText("].every((f) => shiftsSrc.includes(f)) && !/shift_notices[\s\S]{0,200}(gotShiftText|filledText|releasedText)/.test(shiftsSrc));
const noticeMig = src("supabase/migrations/20261119_shift_notices.sql");
check("Migration: one queued text per person per post", noticeMig.includes("unique (post_id, staff_id)"));
check("Migration: queued texts go with their post", noticeMig.includes("references public.shift_posts(id) on delete cascade"));
check("Migration: shift_notices has RLS on", noticeMig.includes("alter table public.shift_notices enable row level security"));
const mig = src("supabase/migrations/20261118_markets_shifts.sql");
check("Migration: existing staff default to Dallas", mig.includes("markets text[] not null default '{dallas}'"));
check("Migration: one posted open shift per event", mig.includes("create unique index if not exists shift_posts_one_open on public.shift_posts (session_id) where kind = 'open' and status = 'posted'"));
check("Migration: one open handoff per person per event", mig.includes("shift_handoffs_one_active"));
check("Migration: the market is never in event_data", !/event_data/.test(mig.replace(/--.*$/gm, "")));

console.log = out;
if (failed > 0) {
  console.error(`\n${failed} of ${total} shift checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} shift checks pass.`);
