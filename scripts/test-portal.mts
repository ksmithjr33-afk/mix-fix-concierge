// Calendar view, Bartender view and Preview as, announcements, and the event
// team chat, run through the real code against the in-memory database
// (scripts/fake-supabase.mts) with staff texts captured instead of sent.
// Run: node --no-warnings scripts/test-portal.mts

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

const texts: { phone: string; message: string }[] = [];
let smsDown = false;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === process.env.GHL_STAFF_SMS_WEBHOOK) {
    if (smsDown) return new Response("down", { status: 500 });
    const b = JSON.parse(String(init?.body ?? "{}"));
    texts.push({ phone: b.phone, message: b.message });
  }
  return new Response("[]", { status: 200 });
}) as typeof fetch;

const out = console.log;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const cal = await import("../lib/team/calendar.ts");
const viewMode = await import("../lib/team/view-mode.ts");
const ann = await import("../lib/team/announcements.ts");
const annDb = await import("../lib/team/announcements-db.ts");
const chat = await import("../lib/team/chat.ts");
const chatDb = await import("../lib/team/chat-db.ts");
const myEvents = await import("../lib/team/my-events.ts");
const shiftsDb = await import("../lib/team/shifts-db.ts");

let failed = 0;
let total = 0;
function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  out(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ----- 1. Calendar -----
const item = (id: string, day: string | null, arrival: string, title = id, tone: "ok" | "warn" | "muted" = "ok") => ({ id, day, arrival, title, detail: "", search: "", badge: { text: tone, tone }, href: `/team/admin/e/${id}` });
check("Weeks start on Monday", cal.weekStart("2026-11-12") === "2026-11-09" && cal.weekStart("2026-11-15") === "2026-11-09" && cal.weekStart("2026-11-09") === "2026-11-09");
const items = [item("late", "2026-11-14", "7:00 PM"), item("early", "2026-11-14", "9:30 AM"), item("noon", "2026-11-14", "12:00 PM"), item("tbd", "2026-11-14", ""), item("next", "2026-11-16", "4:00 PM"), item("undated", null, "4:00 PM")];
const wk = cal.calendarGrid("week", "2026-11-12", "2026-11-10", items as never);
check("A week is Monday to Sunday", wk.days.length === 7 && wk.days[0].ymd === "2026-11-09" && wk.days[6].ymd === "2026-11-15" && wk.days[0].weekday === "Mon" && wk.days[6].weekday === "Sun");
check("Week label", wk.label === "Nov 9 to 15, 2026", wk.label);
check("Previous and next move a week", wk.prev === "2026-11-02" && wk.next === "2026-11-16");
const sat = wk.days.find((d) => d.ymd === "2026-11-14")!;
check("Events sit on their day in arrival order, unknown times last", sat.events.map((e) => e.id).join() === "early,noon,late,tbd", sat.events.map((e) => e.id).join());
check("Events outside the week and undated events are left out", wk.days.every((d) => !d.events.some((e) => e.id === "next" || e.id === "undated")));
check("Today is marked", wk.days.find((d) => d.ymd === "2026-11-10")!.today && wk.days.filter((d) => d.today).length === 1);
check("Blocks keep the list badge and link", sat.events[0].badge?.tone === "ok" && sat.events[0].href === "/team/admin/e/early");
check("A week across two months", cal.calendarGrid("week", "2026-12-01", "2026-11-10", []).label === "Nov 30 to Dec 6, 2026");
check("A week across two years", cal.calendarGrid("week", "2026-12-31", "2026-11-10", []).label === "Dec 28, 2026 to Jan 3, 2027");
const mo = cal.calendarGrid("month", "2026-11-20", "2026-11-10", items as never);
check("A month grid is whole Monday to Sunday weeks", mo.days[0].ymd === "2026-10-26" && mo.days.at(-1)!.ymd === "2026-12-06" && mo.days.length % 7 === 0, `${mo.days[0].ymd} ${mo.days.at(-1)!.ymd}`);
check("Month label and days outside the month", mo.label === "November 2026" && !mo.days[0].inMonth && mo.days.find((d) => d.ymd === "2026-11-01")!.inMonth);
check("Previous and next move a month", mo.prev === "2026-10-01" && mo.next === "2026-12-01");
check("The month holds the events of every week", mo.days.find((d) => d.ymd === "2026-11-16")!.events.length === 1);
check("February 2027 grid", cal.calendarGrid("month", "2027-02-10", "2026-11-10", []).days[0].ymd === "2027-02-01" && cal.calendarGrid("month", "2027-02-10", "2026-11-10", []).days.length === 28);
check("Week is the default; month on request", cal.calMode(undefined) === "week" && cal.calMode("month") === "month" && cal.calMode("year") === "week");
check("Only real dates are accepted from the address bar", cal.isYmd("2026-11-10") && !cal.isYmd("2026-02-30") && !cal.isYmd("tomorrow") && !cal.isYmd(["2026-11-10"]));
check("Arrival times order by the clock", cal.arrivalMinutes("9:00 AM") < cal.arrivalMinutes("12:00 PM") && cal.arrivalMinutes("12:00 PM") < cal.arrivalMinutes("4:00 PM") && cal.arrivalMinutes("12:30 AM") === 30);
const calSrc = src("app/team/calendar-view.tsx");
const listSrc = src("app/team/events/event-list.tsx");
check("Calendar chips use the list's green and red for staffed and nobody assigned", ["bg-[#E4EBDF]", "bg-[#F6E3DC]"].every((c) => calSrc.includes(c) && listSrc.includes(c)));
check("On a phone the week stacks days; on a laptop it is seven columns", calSrc.includes("grid grid-cols-1 lg:grid-cols-7"));
check("Calendar blocks open the event's link (the admin event page on staffing)", calSrc.includes("href={e.href ?? `/team/e/${e.id}`}"));
const staffingSrc = src("app/team/admin/events/page.tsx");
check("Staffing has the List and Calendar toggle, and the calendar gets every market for its own filter", staffingSrc.includes("<ListCalendarToggle") && staffingSrc.includes("const sessions = calendar ? visible :") && staffingSrc.includes("markets={MARKETS.map((m) => ({ key: m, label: MARKET_INFO[m].label }))}"));
check("Staffing badges say when an event has no market", staffingSrc.includes('sessionMarket(s) ? "" : "no market"'));
const eventsSrc = src("app/team/events/page.tsx");
check("Bartenders get the calendar toggle on their own events", eventsSrc.includes("<ListCalendarToggle") && eventsSrc.includes("<CalendarView"));
check("Bartenders' calendar uses only their own events, their open shifts and their unavailable days", eventsSrc.includes("admin ? events : [...events, ...shiftItems(shifts)]") && eventsSrc.includes("myUnavailableDays(staff.id, today)"));

// ----- 2. Bartender view and Preview as -----
const adminRow = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const asBart = viewMode.applyViewMode(adminRow, "bartender");
check("Bartender view: an admin is treated as a bartender", asBart.role === "bartender" && asBart.bartenderView === true && asBart.id === "a1");
check("Without the switch an admin stays an admin", viewMode.applyViewMode(adminRow, undefined).role === "admin" && !viewMode.applyViewMode(adminRow, "admin").bartenderView);
check("The switch never raises a bartender", viewMode.applyViewMode({ ...adminRow, role: "bartender" }, "bartender").bartenderView === undefined);
const authSrc = src("lib/team/auth.ts");
check("Every page and route sees the viewed role", authSrc.includes("return applyViewMode(staff, (await cookies()).get(VIEW_COOKIE)?.value);"));
const viewRoute = src("app/api/team/view/route.ts");
check("Only a real admin can turn Bartender view on", viewRoute.includes('form?.get("mode") === "bartender" && staff.role === "admin"') && viewRoute.includes("getSignedInStaff()"));
const header = src("app/team/team-header.tsx");
check("The header has the switch, the banner, and the way back", header.includes("Bartender view") && header.includes("Switch back") && header.includes('value="bartender"') && header.includes('value="admin"'));
check("In Bartender view the admin links are gone", header.includes("const showAdmin = admin && !bartenderView && viewed?.role === \"admin\";") && header.includes("{showAdmin && ("));
check("Signing out ends Bartender view too", src("app/api/team/logout/route.ts").includes("res.cookies.delete(VIEW_COOKIE)"));
for (const p of ["app/api/team/admin/shifts/route.ts", "app/api/team/admin/assign/route.ts", "app/api/team/admin/timesheets/route.ts", "app/api/team/admin/announcements/route.ts"]) {
  check(`Admin route refuses Bartender view: ${p}`, src(p).includes("getCurrentStaff()") && src(p).includes('role !== "admin"'));
}
const preview = src("app/team/admin/preview/[id]/page.tsx");
check("Preview as is admin only", preview.includes("await requireAdmin("));
check("Preview never acts as the person: no links, buttons, forms, or requests", !/<Link|<a |<button|<form|fetch\(|href=\{`/.test(preview) && !/onClick|RequestButton|ClockCard|Respond/.test(preview));
check("Preview shows their events and their open shifts", preview.includes("assignedEventItems(person.id)") && preview.includes('openShiftsFor({ ...person, role: "bartender" })'));
check("Each staff row has Preview as", src("app/team/admin/staff/staff-manager.tsx").includes("href={`/team/admin/preview/${s.id}`}") && src("app/team/admin/staff/staff-manager.tsx").includes("Preview as"));

// Through the database: what a bartender sees.
const today = time.todayIn("America/Chicago");
const addDays = (ymd: string, n: number) => cal.addDays(ymd, n);
const CLIENT = { client_name: "Justin Reyes", client_email: "justin@example.com", client_phone: "+1 (972) 555-0199", event_type: "Birthday" };
const ev = (id: string, day: string, market: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "submitted",
  version: 1,
  event_date: day,
  team_market: market,
  team_market_source: "admin",
  booked_price: { total: 1800 },
  event_data: { ...CLIENT, event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: "1 Main St, Austin, TX", bartenders: 2, ...extra },
});
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true, markets: ["dallas"] };
const admin2 = { id: "a2", name: "Pat Jones", phone: "+12145550102", role: "admin" as const, active: true, alerts: false, markets: ["dallas"] };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true, markets: ["austin"] };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true, markets: ["dallas", "austin"] };
const b3 = { id: "b3", name: "Riley Park", phone: "+12145550113", role: "bartender" as const, active: true, markets: ["dallas"] };
const b4 = { id: "b4", name: "Gone Person", phone: "+12145550114", role: "bartender" as const, active: false, markets: ["austin"] };
const b6 = { id: "b6", name: "Avery Kim", phone: "+13105550116", role: "bartender" as const, active: true, markets: ["los_angeles"] };
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [ev("s1", addDays(today, 5), "austin", { event_name: "Justin's 30th" }), ev("s2", addDays(today, 6), "austin"), ev("s3", addDays(today, 7), "dallas")];
  db.staff = [admin, admin2, b1, b2, b3, b4, b6].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "as1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "s1", staff_id: "b2", status: "offered" },
    { id: "as3", session_id: "s2", staff_id: "b1", status: "declined" },
  ];
  for (const t of ["shift_posts", "shift_requests", "shift_handoffs", "shift_notices", "team_notices", "team_hidden_events", "time_punches", "announcements", "announcement_recipients", "event_messages", "event_message_reads", "event_chat_notices"]) db[t] = [];
  texts.length = 0;
  smsDown = false;
}
const textsTo = (s: { phone: string }) => texts.filter((t) => t.phone === s.phone);
const noClient = (s: string) => !/Reyes|justin@example|972\D*555\D*0199|1800/.test(s);

reset();
const mine = await myEvents.assignedEventItems("b1");
check("A bartender's events are only the ones they are on, not declined", mine.map((e) => e.id).join() === "s1");
db.team_hidden_events.push({ session_id: "s1" });
check("Hidden events are left out", (await myEvents.assignedEventItems("b1")).length === 0);
reset();
check("An admin with no assignments has no events of their own (what Bartender view shows)", (await myEvents.assignedEventItems("a1")).length === 0);
await shiftsDb.postShift(db.sessions[2] as never, admin, time.zonedInstant(today, 12 * 60, "America/Chicago"));
check("Preview: open shifts follow the person's markets", (await shiftsDb.openShiftsFor({ ...b3, role: "bartender" })).length === 1 && (await shiftsDb.openShiftsFor({ ...b1, role: "bartender" })).length === 0);
check("Preview: an admin seen as a bartender gets only their markets' shifts", (await shiftsDb.openShiftsFor({ ...admin, role: "bartender" })).length === 1);

// ----- 3. Announcements -----
const v1 = ann.validateAnnouncement({ title: "  Holiday   schedule ", body: "Office closed Thursday.", markets: ["houston", "austin"], bartendersOnly: true, sendNow: true });
check("A valid announcement", v1.ok && v1.value.title === "Holiday schedule" && v1.value.markets.join() === "austin,houston" && v1.value.bartendersOnly && v1.value.sendNow);
check("Title and message are required", !ann.validateAnnouncement({ title: "", body: "x" }).ok && !ann.validateAnnouncement({ title: "x", body: " " }).ok);
check("Unknown markets are refused", !ann.validateAnnouncement({ title: "x", body: "y", markets: ["miami"] }).ok);
check("Send now is off unless ticked", ann.validateAnnouncement({ title: "x", body: "y", sendNow: "yes" }).ok && !(ann.validateAnnouncement({ title: "x", body: "y", sendNow: "yes" }) as { value: { sendNow: boolean } }).value.sendNow);
const everyone = [admin, admin2, b1, b2, b3, b4, b6];
check("Everyone: every active staff member except the sender", ann.audienceOf(everyone, { markets: [], bartendersOnly: false }, "a1").map((s) => s.id).join() === "a2,b1,b2,b3,b6");
check("Markets: anyone working one of them", ann.audienceOf(everyone, { markets: ["austin"], bartendersOnly: false }, "a1").map((s) => s.id).join() === "b1,b2");
check("Bartenders only", ann.audienceOf(everyone, { markets: [], bartendersOnly: true }, "a1").map((s) => s.id).join() === "b1,b2,b3,b6");
check("Bartenders in some markets", ann.audienceOf(everyone, { markets: ["dallas", "los_angeles"], bartendersOnly: true }, "a1").map((s) => s.id).join() === "b2,b3,b6");
check("A person's texts follow their market's time zone", ann.recipientTz(b6, []) === "America/Los_Angeles" && ann.recipientTz(b2, ["austin"]) === "America/Chicago");
check("The announcement text has the title and a link", ann.announcementText({ title: "Holiday schedule", link: "https://plan.test/team/announcements/x" }) === "Mix Fix announcement: Holiday schedule. Read it: https://plan.test/team/announcements/x");

const NOON = time.zonedInstant(today, 12 * 60, "America/Chicago");
const TEN_PM = time.zonedInstant(today, 22 * 60, "America/Chicago");
const tomorrow = addDays(today, 1);
reset();
check("Bartenders cannot send announcements", !(await annDb.createAnnouncement(b1, { title: "x", body: "y" }, NOON)).ok);
const a1 = await annDb.createAnnouncement(admin, { title: "Holiday schedule", body: "Office closed Thursday.", markets: ["dallas", "austin"] }, NOON);
const aid = a1.ok ? a1.id : "";
check("At noon the announcement texts everyone in the audience right away", a1.ok && a1.recipients === 4 && a1.texted === 4 && a1.held === 0, JSON.stringify(a1));
check("The text has the title and the announcement link", textsTo(b1)[0]?.message === `Mix Fix announcement: Holiday schedule. Read it: https://plan.test/team/announcements/${aid}`, textsTo(b1)[0]?.message);
check("Someone in two of the markets gets one text, not two", textsTo(b2).length === 1);
check("The sender, inactive staff, and other markets get nothing", textsTo(admin).length === 0 && textsTo(b4).length === 0 && textsTo(b6).length === 0);
check("The cron running after sends nothing twice", (await annDb.deliverAnnouncements(new Date(NOON.getTime() + 60_000))) === 0 && texts.length === 4);
reset();
db.staff.push({ id: "b7", name: "Quinn Ray", phone: "+12145550117", role: "bartender", active: true, markets: ["dallas"] });
await annDb.createAnnouncement(admin, { title: "Overnight", body: "x" }, TEN_PM);
texts.length = 0;
const eight = time.zonedInstant(tomorrow, 8 * 60, "America/Chicago");
const [d1, d2] = await Promise.all([annDb.deliverAnnouncements(eight), annDb.deliverAnnouncements(eight)]);
check("Two deliveries at once text each person once", d1 + d2 === 5 && texts.length === 5 && new Set(texts.map((t) => t.phone)).size === 5, `${d1} ${d2} ${texts.length}`);
reset();
db.announcements.push({ id: "old", title: "Missed", body: "x", markets: [], bartenders_only: false, send_now: false, created_by: "a1", created_at: NOON.toISOString() });
db.announcement_recipients.push({ id: "r-old", announcement_id: "old", staff_id: "b1", time_zone: "America/Chicago", send_after: NOON.toISOString(), status: "pending", sent_at: null, opened_at: null });
await annDb.deliverAnnouncements(TEN_PM);
check("A held text the cron reaches late, in quiet hours again, waits for the morning", texts.length === 0 && db.announcement_recipients[0].status === "pending");

reset();
const late = await annDb.createAnnouncement(admin, { title: "Late note", body: "See you tomorrow." }, TEN_PM);
check("At 10:00 PM Central the Texas staff are held; Los Angeles (8:00 PM) is texted", late.ok && late.texted === 1 && late.held === 4 && textsTo(b6).length === 1 && textsTo(b1).length === 0, JSON.stringify(late));
check("Held texts wait for 8:00 AM their time", db.announcement_recipients.filter((r) => r.status === "pending").every((r) => r.send_after === time.zonedInstant(tomorrow, 8 * 60, "America/Chicago").toISOString()));
await annDb.deliverAnnouncements(time.zonedInstant(tomorrow, 7 * 60 + 59, "America/Chicago"));
check("Nothing goes out before 8:00 AM", texts.length === 1);
db.staff.find((s) => s.id === "b3")!.active = false;
await annDb.deliverAnnouncements(time.zonedInstant(tomorrow, 8 * 60, "America/Chicago"));
check("At 8:00 AM the held texts go out, one each", textsTo(b1).length === 1 && textsTo(b2).length === 1 && textsTo(admin2).length === 1 && texts.length === 4);
check("Someone deactivated overnight is skipped", textsTo(b3).length === 0 && db.announcement_recipients.find((r) => r.staff_id === "b3")?.status === "skipped");
reset();
const urgent = await annDb.createAnnouncement(admin, { title: "Storm tonight", body: "Check your event page.", sendNow: true }, TEN_PM);
check("Send now ignores quiet hours", urgent.ok && urgent.texted === 5 && urgent.held === 0);
reset();
smsDown = true;
const down = await annDb.createAnnouncement(admin, { title: "x", body: "y" }, NOON);
check("A failed text never blocks sending the announcement", down.ok && db.announcements.length === 1 && db.announcement_recipients.every((r) => r.status === "failed"));

reset();
await annDb.createAnnouncement(admin, { title: "Austin only", body: "Hi Austin." , markets: ["austin"] }, NOON);
await annDb.createAnnouncement(admin, { title: "Everyone", body: "Hi all." }, new Date(NOON.getTime() + 60_000));
const b1List = await annDb.announcementsFor(b1);
check("A bartender sees the announcements sent to them, newest first, unread marked", b1List.map((a) => a.title).join() === "Everyone,Austin only" && b1List.every((a) => a.unread));
check("Announcements to other markets are not shown", (await annDb.announcementsFor(b3)).map((a) => a.title).join() === "Everyone");
check("The unread count", (await annDb.unreadAnnouncements("b1")) === 2);
const austinId = db.announcements.find((a) => a.title === "Austin only")!.id as string;
const opened = await annDb.openAnnouncement(austinId, b1, NOON);
check("Opening one marks it read", !!opened && (await annDb.unreadAnnouncements("b1")) === 1 && (await annDb.announcementsFor(b1)).find((a) => a.id === austinId)?.unread === false);
check("A bartender does not see who opened it", opened?.opens === null);
check("Someone it was not sent to cannot open it", (await annDb.openAnnouncement(austinId, b3, NOON)) === null);
const adminView = await annDb.openAnnouncement(austinId, admin, NOON);
check("Admins see who has opened each one", !!adminView?.opens && adminView.opens.length === 2 && adminView.opens[0].name === "Jordan Lee" && !!adminView.opens[0].openedAt && adminView.opens[1].name === "Sam Diaz" && !adminView.opens[1].openedAt, JSON.stringify(adminView?.opens));
const adminList = await annDb.announcementsFor(admin);
check("The admin list shows opened by N of M", adminList.find((a) => a.id === austinId)?.opened === 1 && adminList.find((a) => a.id === austinId)?.recipients === 2);
check("Another admin who got it sees it unread", (await annDb.announcementsFor(admin2)).find((a) => a.title === "Everyone")?.unread === true);
check("Bartender view (an admin as a bartender) shows only their own", (await annDb.announcementsFor({ ...admin2, role: "bartender" })).map((a) => a.title).join() === "Everyone");
check("The header shows the unread count", header.includes("unreadAnnouncements(viewed.id)") && header.includes('href="/team/announcements"'));
check("Only admins see the composer", src("app/team/announcements/page.tsx").includes("{admin && <Compose"));
check("The composer has Send now, markets, and bartenders only", ["Send now", "Some markets", "Bartenders only", "bartendersOnly, sendNow"].every((x) => src("app/team/announcements/compose.tsx").includes(x)));

// ----- 4. Event team chat -----
const msg = "Call Justin Reyes at (972) 555-0199 or 972.555.0199 or +19725550199, email Justin@Example.com. Mix Fix line 469 754 8512.";
const red = chat.redactClient(msg, { email: CLIENT.client_email, phone: CLIENT.client_phone, name: CLIENT.client_name });
check("Client phone, email, and last name are taken out of messages", noClient(red) && red.includes("Justin [last name removed]") && (red.match(/\[client contact removed\]/g) ?? []).length === 4, red);
check("Other numbers stay (the Mix Fix line)", red.includes("469 754 8512"));
check("A last name inside another word stays", chat.redactClient("Reyesville", { name: "Justin Reyes" }) === "Reyesville");
check("Empty and very long messages are refused", !chat.cleanMessage("  ", {}).ok && !chat.cleanMessage("x".repeat(2001), {}).ok);
const long = "a".repeat(150);
check("The chat text: first name, event title, first 100 characters, link", chat.chatText({ from: "Jordan", title: "Justin's 30th", body: long, more: 0, link: "L" }) === `Jordan on Justin's 30th: ${"a".repeat(100)}... L`);
check("A batched chat text says how many more", chat.chatText({ from: "Jordan", title: "T", body: "hi", more: 2, link: "L" }) === "Jordan on T: hi (+2 more) L");
const T = new Date("2026-11-10T18:00:00Z");
const at = (min: number) => new Date(T.getTime() + min * 60_000);
check("First message texts right away", chat.chatNoticePlan(null, T).action === "send");
check("Within 5 minutes of the last text it is held to the 5 minute mark", (() => { const p = chat.chatNoticePlan({ last_sent_at: T.toISOString(), pending_after: null }, at(2)); return p.action === "hold" && p.until.getTime() === at(5).getTime(); })());
check("A held text covers more messages", chat.chatNoticePlan({ last_sent_at: T.toISOString(), pending_after: at(5).toISOString() }, at(3)).action === "none");
check("After 5 minutes it texts right away again", chat.chatNoticePlan({ last_sent_at: T.toISOString(), pending_after: null }, at(6)).action === "send");
check("Who can open the thread", chat.canUseThread(admin, null) && chat.canUseThread(b1, "accepted") && chat.canUseThread(b1, "offered") && !chat.canUseThread(b1, "declined") && !chat.canUseThread(b1, null) && !chat.canUseThread({ ...b1, active: false }, "accepted"));

reset();
const link = "https://plan.test/team/e/s1?tab=chat";
check("Staff on the event and admins can open the thread", (await chatDb.threadAccess("s1", b1)).ok && (await chatDb.threadAccess("s1", b2)).ok && (await chatDb.threadAccess("s1", admin)).ok);
check("Staff not on the event, or who declined, cannot", !(await chatDb.threadAccess("s1", b3)).ok && !(await chatDb.threadAccess("s2", b1)).ok);
check("Not in Bartender view either, for an admin not on the event", !(await chatDb.threadAccess("s1", { ...admin, role: "bartender" })).ok);
check("Posting to a thread you are not in is refused", !(await chatDb.postMessage("s1", b3, "hi", T)).ok && db.event_messages.length === 0);
const m1 = await chatDb.postMessage("s1", b1, "Running 10 minutes late", T);
check("A message is saved", m1.ok && db.event_messages.length === 1);
check("The first message texts the other people on the event right away", textsTo(b2).length === 1 && textsTo(b2)[0].message === `Jordan on Justin's 30th: Running 10 minutes late ${link}`, JSON.stringify(texts));
check("The author is not texted, and admins who have not posted are not texted", textsTo(b1).length === 0 && textsTo(admin).length === 0);
await chatDb.postMessage("s1", admin, "Thanks, we told the host.", at(1));
check("An admin who posts: the bartender who had no text yet is texted now; the one just texted is held", textsTo(b1).length === 1 && textsTo(b1)[0].message.startsWith("Kenneth on Justin's 30th: Thanks") && textsTo(b2).length === 1, JSON.stringify(texts));
await chatDb.postMessage("s1", b1, "Parking is in back", at(2));
await chatDb.postMessage("s1", b1, "Gate code is on the event page", at(3));
check("A fast back and forth does not send a text per message", textsTo(b2).length === 1 && textsTo(admin).length === 1 && textsTo(admin)[0].message.startsWith("Jordan on Justin's 30th: Parking"), JSON.stringify(texts));
check("Nothing held goes out before its 5 minutes", (await chatDb.deliverChatNotices(at(4))) === 0);
await chatDb.deliverChatNotices(at(5));
check("At 5 minutes one text covers everything since, with the latest message", textsTo(b2).length === 2 && textsTo(b2)[1].message === `Jordan on Justin's 30th: Gate code is on the event page (+2 more) ${link}`, JSON.stringify(textsTo(b2)));
check("The admin's held text is not due yet (5 minutes after their last text)", textsTo(admin).length === 1);
await chatDb.markThreadRead("s1", "a1", at(6));
await chatDb.deliverChatNotices(at(7));
check("Someone who read the thread meanwhile is not texted", textsTo(admin).length === 1);
check("The cron running again sends nothing twice", (await chatDb.deliverChatNotices(at(12))) === 0);
check("The client is never texted", !texts.some((t) => t.phone.replace(/\D/g, "").endsWith("9725550199")));

const counts = await chatDb.unreadByEvent("b2", ["s1"]);
check("Unread count: messages from others since they last read", counts.get("s1") === 4);
await chatDb.markThreadRead("s1", "b2", at(8));
check("Reading clears it", !(await chatDb.unreadByEvent("b2", ["s1"])).has("s1"));
await chatDb.postMessage("s1", b1, "One more thing", at(9));
check("And new messages count again", (await chatDb.unreadByEvent("b2", ["s1"])).get("s1") === 1 && (await chatDb.unreadByEvent("b1", ["s1"])).size === 0);
const thread = await chatDb.threadMessages("s1", b2);
check("The thread shows first names, admins marked, oldest first", thread.map((m) => m.from).join() === "Jordan,Kenneth,Jordan,Jordan,Jordan" && thread[1].fromAdmin && !thread[0].mine);

// Removed from the event: loses the thread and its texts.
await chatDb.postMessage("s1", b2, "I can be there at 5", at(9.5)); // b2 has posted, so they were a member
await chatDb.postMessage("s1", admin, "Sam, are you in?", at(10));
check("A text is held for b2 before they are removed", !!db.event_chat_notices.find((n) => n.staff_id === "b2")?.pending_after);
db.event_assignments = db.event_assignments.filter((a) => a.staff_id !== "b2");
texts.length = 0;
check("Someone removed from the event loses the thread", !(await chatDb.threadAccess("s1", b2)).ok);
await chatDb.deliverChatNotices(at(16));
await chatDb.postMessage("s1", b1, "Ok we will find someone", at(17));
await chatDb.deliverChatNotices(at(22)); // clears anything held, so the next message takes the immediate path
await chatDb.postMessage("s1", b1, "Still looking", at(30)); // well past any batch: an immediate text would go
check("And gets no more texts from it, held or immediate", textsTo(b2).length === 0, JSON.stringify(texts));
// Added: sees the full history.
db.event_assignments.push({ id: "as9", session_id: "s1", staff_id: "b3", status: "offered" });
const fresh = await chatDb.threadMessages("s1", b3);
check("Someone added to the event sees the full history", (await chatDb.threadAccess("s1", b3)).ok && fresh.length === db.event_messages.length && fresh[0].body === "Running 10 minutes late");

// Client details never reach the thread or a text.
reset();
await chatDb.postMessage("s1", admin, "Client is Justin Reyes, 972-555-0199, justin@example.com", T);
check("Client contact details are removed before saving", noClient(String(db.event_messages[0].body)) && String(db.event_messages[0].body).includes("[client contact removed]"));
check("And never in the texts", texts.every((t) => noClient(t.message)));
reset();
smsDown = true;
const quiet = await chatDb.postMessage("s1", b1, "Hello", T);
check("A failed text never blocks a message", quiet.ok && db.event_messages.length === 1);

// Wiring.
const tabs = src("app/team/e/[id]/event-tabs.tsx");
check("The event page has a Chat tab with an unread count", tabs.includes('["chat", `Chat${chatUnread ? ` (${chatUnread})` : ""}`]') && tabs.includes("<ChatThread"));
check("Message team links open the chat tab", src("app/team/e/[id]/page.tsx").includes('(["chat", "wrapup", "shopping", "checklist"] as const).find((t) => t === query.tab) ?? "details"') && src("app/team/e/[id]/page.tsx").includes("initialTab={"));
const adminEvent = src("app/team/admin/e/[id]/page.tsx");
const managerChat = src("app/team/admin/e/[id]/manager-chat.tsx");
check(
  "The manager view's Chat tab has Message team with the unread count",
  managerChat.includes("Message team") && managerChat.includes("{props.unread} unread") && managerChat.includes("<ChatThread") && adminEvent.includes("chat: <ManagerChat") && adminEvent.includes("chat: chatUnread")
);
check("Staffing list and calendar link to each event's chat tab with its unread count", staffingSrc.includes("chat: { href: `/team/admin/e/${s.id}?tab=chat`, unread: unread.get(s.id) ?? 0 }") && listSrc.includes("e.chat.href") && calSrc.includes("e.chat?.unread"));
const chatRoute = src("app/api/team/chat/route.ts");
check("The chat route needs a sign in and thread access", chatRoute.includes("getCurrentStaff()") && chatRoute.includes("status: 401") && chatRoute.includes("threadAccess(sessionId, staff)"));

// Texts and the cron.
for (const p of ["lib/team/chat-db.ts", "lib/team/announcements-db.ts"]) check(`Every text goes through sendStaffText: ${p}`, !/fetch\(/.test(src(p)) && src(p).includes("sendStaffText("));
const cron = src("app/api/cron/team/route.ts");
check("The cron sends held announcement and chat texts", cron.includes("deliverAnnouncements(now)") && cron.includes("deliverChatNotices(now)"));
const mig = src("supabase/migrations/20261120_announcements_chat.sql");
check("Migration: one text per person per announcement", mig.includes("unique (announcement_id, staff_id)"));
check("Migration: RLS on every new table", ["announcements", "announcement_recipients", "event_messages", "event_message_reads", "event_chat_notices"].every((t) => mig.includes(`alter table public.${t} enable row level security`)));
check("Migration: chat goes with the event", mig.includes("session_id text not null references public.sessions(id) on delete cascade"));

console.log = out;
if (failed > 0) {
  console.error(`\n${failed} of ${total} portal checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} portal checks pass.`);
