// The bigger calendar: each role sees the same events as before (admins every
// event, bartenders only their own events plus open shifts in their markets
// and their own unavailable days), Month, Week and List views, the market
// filter, and remembered choices. Real code against the in-memory database.
// Run: node --no-warnings scripts/test-calendar.mts

import { addDays, check, done, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const cal = await import("../lib/team/calendar.ts");
const myEvents = await import("../lib/team/my-events.ts");
const shiftsDb = await import("../lib/team/shifts-db.ts");
const prefsDb = await import("../lib/team/prefs-db.ts");
const asg = await import("../lib/team/assignments.ts");

const today = time.todayIn("America/Chicago");
const CLIENT = { client_name: "Justin Reyes", client_email: "justin@example.com", client_phone: "+1 (972) 555-0199", event_type: "Birthday" };
const ev = (id: string, day: string, market: string, extra: Record<string, unknown> = {}, status = "submitted") => ({
  id,
  status,
  version: 1,
  event_date: day,
  team_market: market,
  team_market_source: "admin",
  event_data: { ...CLIENT, event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: "1 Main St, Austin, TX", bartenders: 2, ...extra },
});
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true, markets: ["dallas"] };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true, markets: ["austin"] };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true, markets: ["dallas"] };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    ev("s1", addDays(today, 2), "austin", { event_name: "Justin's 30th" }),
    ev("s2", addDays(today, 3), "austin"),
    ev("s3", addDays(today, 4), "austin"),
    ev("s4", addDays(today, 5), "dallas"),
    ev("s5", addDays(today, 6), "austin"),
    ev("s6", addDays(today, 7), "austin", {}, "draft"),
  ];
  db.staff = [admin, b1, b2].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "as1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "as1b", session_id: "s1", staff_id: "b2", status: "accepted" },
    { id: "as2", session_id: "s2", staff_id: "b1", status: "offered" },
    { id: "as3", session_id: "s3", staff_id: "b1", status: "declined" },
    { id: "as5", session_id: "s5", staff_id: "b1", status: "accepted" },
    { id: "as6", session_id: "s6", staff_id: "b1", status: "accepted" },
  ];
  db.team_hidden_events = [{ session_id: "s5" }];
  for (const t of ["shift_posts", "shift_requests", "shift_handoffs", "shift_notices", "team_notices", "staff_unavailability", "event_messages", "event_message_reads", "event_menu_pickups", "staff_prefs"]) db[t] = [];
}

// ----- 1. The same events per role as before -----
reset();
const before = (await myEvents.assignedEventItems("b1")).map((e) => e.id).sort().join();
const bart = await myEvents.eventsForViewer({ ...b1 });
check("A bartender sees the same events as before: only their own, not declined, not hidden, not drafts", bart.map((e) => e.id).sort().join() === before && before === "s1,s2", bart.map((e) => e.id).join());
check("A bartender's items carry no staffing color or menu status (no new information)", bart.every((e) => e.staffing === undefined && e.menu === undefined));
check("A bartender's items keep their own status and open their own event page", bart.find((e) => e.id === "s1")!.status === "accepted" && bart.every((e) => !e.href || e.href.startsWith("/team/e/")));
check("A bartender's items carry their own chat link", bart.every((e) => e.chat?.href === `/team/e/${e.id}?tab=chat`));
const adm = await myEvents.eventsForViewer({ ...admin });
check("An admin sees every submitted event that is not hidden", adm.map((e) => e.id).sort().join() === "s1,s2,s3,s4", adm.map((e) => e.id).join());
check("Admin chips open the manager view", adm.every((e) => e.href === `/team/admin/e/${e.id}`));
const tone = (id: string) => adm.find((e) => e.id === id)!.staffing;
check("Admin chip colors: fully staffed, spots open, nobody assigned", tone("s1") === "full" && tone("s2") === "open" && tone("s4") === "none", `${tone("s1")} ${tone("s2")} ${tone("s4")}`);
check("Admin items show the menu pickup status", adm.find((e) => e.id === "s4")!.menu?.text === "Menu: no one assigned");
const asBartender = await myEvents.eventsForViewer({ ...admin, role: "bartender" });
check("An admin in Bartender view sees only their own events (none)", asBartender.length === 0);
const page = src("app/team/events/page.tsx");
check("The events page and its calendar use the same per role events", page.includes("const visible = await eventsForViewer(staff);") && page.includes("admin ? events : [...events, ...shiftItems(shifts)]"));

// Open shifts: only the bartender's markets, and never a client name.
await shiftsDb.postShift(db.sessions[3] as never, admin, time.zonedInstant(today, 12 * 60, "America/Chicago"));
const b2Shifts = myEvents.shiftItems(await shiftsDb.openShiftsFor({ ...b2 }));
const b1Shifts = myEvents.shiftItems(await shiftsDb.openShiftsFor({ ...b1 }));
check("Open shifts on the calendar follow the person's markets", b2Shifts.length === 1 && b1Shifts.length === 0);
check("Open shift chips open the shift and show no client name", b2Shifts[0].kind === "shift" && b2Shifts[0].href!.startsWith("/team/shifts/") && !/Justin|Reyes/.test(JSON.stringify(b2Shifts[0])) && b2Shifts[0].market === "dallas");

// Unavailable days: only their own.
db.staff_unavailability.push({ id: "u1", staff_id: "b1", start_day: addDays(today, 3), end_day: addDays(today, 5), note: "Trip" });
db.staff_unavailability.push({ id: "u2", staff_id: "b2", start_day: addDays(today, 9), end_day: addDays(today, 9), note: null });
const away = await myEvents.myUnavailableDays("b1", today);
check("A bartender's calendar shows only their own unavailable days", away.join() === [3, 4, 5].map((n) => addDays(today, n)).join(), away.join());

// ----- 2. Views, filter, and remembered choices -----
const item = (id: string, day: string, arrival: string, market: string | null = "austin", extra: Record<string, unknown> = {}) => ({ id, day, arrival, title: id, detail: "", search: "", market, ...extra });
const items = [item("a", "2026-11-12", "4:00 PM"), item("b", "2026-11-12", "10:00 AM", "dallas"), item("c", "2026-11-20", "6:00 PM"), item("d", "2026-12-15", "6:00 PM"), item("e", null as unknown as string, "6:00 PM")];
const lr = cal.listRange("2026-11-12", "2026-11-12", items as never);
check("List view: 4 weeks from the start day, only days with events", lr.days.map((d) => d.ymd).join() === "2026-11-12,2026-11-20" && lr.to === "2026-12-09", lr.days.map((d) => d.ymd).join());
check("List view: events in arrival order and today marked", lr.days[0].events.map((e) => e.id).join() === "b,a" && lr.days[0].today && lr.days[0].label === "Thursday, November 12");
check("List view: back and forward move 4 weeks", lr.prev === "2026-10-15" && lr.next === "2026-12-10");
check("List view: unavailable days show even with no events", cal.listRange("2026-11-12", "2026-11-12", [], new Set(["2026-11-14"])).days.map((d) => d.ymd).join() === "2026-11-14");
check("Market filter keeps one market; All keeps everything", cal.filterMarket(items as never, "dallas").map((e) => e.id).join() === "b" && cal.filterMarket(items as never, "all").length === items.length);
check("Month view holds three or more events on a day", cal.calendarGrid("month", "2026-11-12", "2026-11-12", [item("x1", "2026-11-14", "1:00 PM"), item("x2", "2026-11-14", "2:00 PM"), item("x3", "2026-11-14", "3:00 PM"), item("x4", "2026-11-14", "4:00 PM")] as never).days.find((d) => d.ymd === "2026-11-14")!.events.length === 4);
check("A phone opens on List, a laptop on Month, unless they chose otherwise", cal.startView(cal.DEFAULT_PREFS, true) === "list" && cal.startView(cal.DEFAULT_PREFS, false) === "month" && cal.startView({ wideView: "week", phoneView: "month" }, true) === "month" && cal.startView({ wideView: "week", phoneView: null }, false) === "week");
check("Layout: the address bar first, then the remembered one, else the list", cal.pickLayout("calendar", "list") === "calendar" && cal.pickLayout(undefined, "calendar") === "calendar" && cal.pickLayout("bogus", null) === "list");
check("Saved choices drop anything unknown", JSON.stringify(cal.cleanPrefs({ wideView: "year", phoneView: "week", market: "miami", eventsLayout: "calendar", x: 1 }, ["austin"])) === JSON.stringify({ wideView: null, phoneView: "week", market: "all", eventsLayout: "calendar", staffingLayout: null }));
check("Chip colors", cal.chipTone({ ...items[0], staffing: "none" } as never) === "none" && cal.chipTone({ ...items[0], status: "accepted" } as never) === "mine" && cal.chipTone({ ...items[0], status: "offered" } as never) === "offered" && cal.chipTone({ ...items[0], kind: "shift" } as never) === "shift");
check("Staffing tone from counts", asg.staffingTone({ assigned: 0, stillNeeded: 2 }) === "none" && asg.staffingTone({ assigned: 1, stillNeeded: 1 }) === "open" && asg.staffingTone({ assigned: 2, stillNeeded: 0 }) === "full");
check("Unavailable ranges become days inside the window", cal.unavailableDays([{ start_day: "2026-11-01", end_day: "2026-11-03" }], "2026-11-02", "2026-11-30").join() === "2026-11-02,2026-11-03");

reset();
check("No saved choices: the defaults", JSON.stringify(await prefsDb.getPrefs("b1")) === JSON.stringify(cal.DEFAULT_PREFS));
await prefsDb.savePrefs("b1", { phoneView: "month", market: "austin" });
await prefsDb.savePrefs("b1", { eventsLayout: "calendar" });
const saved = await prefsDb.getPrefs("b1");
check("Each person's last view and filter are remembered", saved.phoneView === "month" && saved.market === "austin" && saved.eventsLayout === "calendar" && saved.wideView === null);
check("One person's choices never touch another's", JSON.stringify(await prefsDb.getPrefs("b2")) === JSON.stringify(cal.DEFAULT_PREFS));
const prefsRoute = src("app/api/team/prefs/route.ts");
check("Saving choices needs a sign in and only saves for the signed in person", prefsRoute.includes("getCurrentStaff()") && prefsRoute.includes("savePrefs(staff.id, patch)"));

// The view itself.
const view = src("app/team/calendar-view.tsx");
check("Month, Week and List toggle, with Today, back and forward", view.includes('v === "month" ? "Month" : v === "week" ? "Week" : "List"') && view.includes(">\n            Today\n") && view.includes('aria-label="Back"') && view.includes('aria-label="Forward"'));
check("Up to three chips a day with +N more", view.includes("const PER_CELL = 3;") && view.includes("+{extra} more"));
check("Today is highlighted and past days dimmed", view.includes("d.today ?") && view.includes("past(d) ||"));
check("Phone month: a compact grid of dots that opens the day", view.includes("grid sm:hidden grid-cols-7") && view.includes("onClick={() => setOpen(d.ymd)}"));
check("Calendar pages use the full width on a laptop", page.includes('calendar ? "max-w-[96rem] sm:px-6" : "max-w-2xl"') && src("app/team/admin/events/page.tsx").includes('calendar ? "max-w-[96rem] sm:px-6" : "max-w-2xl"'));

done("calendar");
