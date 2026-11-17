// The manager view's Time clock card: every person on the event with their
// role, state, each clock in and out with the date in the event's time zone,
// who edited or approved it, and hours to the minute and as a decimal, built
// from the very rows the Time page and the payroll CSV use. Run against the
// in-memory database. Run: node --no-warnings scripts/test-time-clock.mts

import { check, done, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const ts = await import("../lib/team/timesheet.ts");
const tsDb = await import("../lib/team/timesheet-db.ts");
const card = await import("../lib/team/clock-card.ts");

const admin = { id: "a1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true };
const sam = { id: "b1", name: "Sam Lee", phone: "+12145550101", role: "bartender", active: true };
const jo = { id: "b2", name: "Jo Park", phone: "+12145550102", role: "bar_back", active: true };
const kai = { id: "b3", name: "Kai Ross", phone: "+12145550103", role: "server", active: true };
const dee = { id: "b4", name: "Dee Fox", phone: "+12145550104", role: "bartender", active: true };

function reset(address = "100 Main St, Dallas, TX") {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [admin, sam, jo, kai, dee];
  db.sessions = [
    { id: "s1", status: "submitted", version: 1, event_date: "November 11, 2026", event_data: { client_name: "Justin Reyes", event_type: "Birthday", event_date: "November 11, 2026", bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: address } },
    { id: "s2", status: "submitted", version: 1, event_date: "November 12, 2026", event_data: { client_name: "Ana Diaz", event_type: "Wedding", event_date: "November 12, 2026", event_address: address } },
  ];
  db.event_assignments = [
    { id: "as1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "s1", staff_id: "b2", status: "accepted" },
    { id: "as3", session_id: "s1", staff_id: "b3", status: "accepted" },
    { id: "as4", session_id: "s1", staff_id: "b4", status: "declined" },
    { id: "as9", session_id: "s2", staff_id: "b1", status: "accepted" },
  ];
  db.time_punches = [
    // Sam: 4:32 PM to 10:14 PM Central, 5 h 42 m. The out was corrected by Isabel, then approved.
    { id: "p1", assignment_id: "as1", staff_id: "b1", session_id: "s1", type: "in", punched_at: "2026-11-11T22:32:00Z", flags: [], source: "phone" },
    { id: "p2", assignment_id: "as1", staff_id: "b1", session_id: "s1", type: "out", punched_at: "2026-11-12T04:14:00Z", flags: ["edited"], source: "phone" },
    // Jo: clocked in, not out.
    { id: "p3", assignment_id: "as2", staff_id: "b2", session_id: "s1", type: "in", punched_at: "2026-11-11T23:05:00Z", flags: [], source: "phone" },
    // Another event: never on this card.
    { id: "p9", assignment_id: "as9", staff_id: "b1", session_id: "s2", type: "in", punched_at: "2026-11-12T22:00:00Z", flags: [], source: "phone" },
  ];
  db.time_edits = [
    { assignment_id: "as1", type: "out", action: "correct", old_punched_at: "2026-11-12T03:50:00Z", new_punched_at: "2026-11-12T04:14:00Z", reason: "Stayed for breakdown", edited_by: "a1", created_at: "2026-11-12T15:00:00Z" },
  ];
  db.time_approvals = [{ assignment_id: "as1", staff_id: "b1", approved_by: "a1", approved_at: "2026-11-13T15:00:00Z" }];
  db.time_reopens = [];
}

// ----- Hours, the payroll CSV's numbers -----
check("Hours to the minute and as the CSV's decimal: 342 minutes is 5 h 42 m · 5.70", card.hoursLabel(342) === "5 h 42 m · 5.70" && ts.csvHours(342) === "5.70", card.hoursLabel(342));
check("Under an hour and whole hours", card.hoursLabel(45) === "0 h 45 m · 0.75" && card.hoursLabel(300) === "5 h 0 m · 5.00");
check("Dates show with the time, in the event's time zone", card.dateTimeLabel("2026-11-12T04:14:00Z", "America/Chicago") === "Nov 11, 10:14 PM" && card.dateTimeLabel("2026-11-12T04:14:00Z", "America/Los_Angeles") === "Nov 11, 8:14 PM");

// ----- The card's rows are the Time page's rows -----
reset();
const rows = await tsDb.eventTimesheetRows("s1");
const week = await tsDb.timesheetRows("2026-11-09", "2026-11-15");
const weekForEvent = week.filter((r) => r.sessionId === "s1");
check("The card reads the same rows the Time page builds, this event only", JSON.stringify(rows) === JSON.stringify(weekForEvent) && rows.every((r) => r.sessionId === "s1"), `${rows.length} vs ${weekForEvent.length}`);
const csv = ts.timesheetCsv(rows);
const people = [
  { staffId: "b1", name: "Sam Lee", role: "bartender", status: "accepted" },
  { staffId: "b2", name: "Jo Park", role: "bar_back", status: "accepted" },
  { staffId: "b3", name: "Kai Ross", role: "server", status: "accepted" },
  { staffId: "b4", name: "Dee Fox", role: "bartender", status: "declined" },
];
const list = card.clockPeople(people, rows, "America/Chicago");
const samC = list.find((p) => p.staffId === "b1")!;
const joC = list.find((p) => p.staffId === "b2")!;
const kaiC = list.find((p) => p.staffId === "b3")!;
check("Every person on the event, declined people left off", list.length === 3 && !list.some((p) => p.staffId === "b4"));
check("Each person's role", samC.role === "Bartender" && joC.role === "Bar back" && kaiC.role === "Server");
check("Clocked out: in and out with dates, and hours", samC.state === "out" && samC.stateText === "Clocked out" && samC.pairs[0].inAt === "2026-11-11T22:32:00Z" && samC.pairs[0].outAt === "2026-11-12T04:14:00Z" && samC.totalMinutes === 342);
check("The hours are the CSV's hours for the same row", csv.includes(",5.70,") && card.hoursLabel(samC.totalMinutes!).endsWith(ts.csvHours(rows.find((r) => r.staffId === "b1")!.minutes)));
check("Clocked in since, with the date", joC.state === "in" && joC.stateText === "Clocked in since Nov 11, 5:05 PM" && joC.totalMinutes === null, joC.stateText);
check("Not clocked in", kaiC.state === "not_in" && kaiC.stateText === "Not clocked in" && kaiC.pairs.length === 1 && kaiC.pairs[0].inAt === null);
check("Edited by the admin who corrected the punch, as on the timesheet", samC.pairs[0].outEditedBy === "Isabel Jones" && samC.pairs[0].inEditedBy === null);
check("Approved by", samC.pairs[0].approvedBy === "Isabel Jones");
const samLine = card.pairText(samC.pairs[0], "America/Chicago");
check("A pair as text", samLine === "In Nov 11, 4:32 PM · Out Nov 11, 10:14 PM (edited by Isabel Jones) · 5 h 42 m · 5.70 · approved by Isabel Jones", samLine);
check("Someone still clocked in", card.pairText(joC.pairs[0], "America/Chicago") === "In Nov 11, 5:05 PM · Still clocked in");

// ----- More than one in and out pair -----
const second = { ...rows.find((r) => r.staffId === "b1")!, assignmentId: "as1b", clockIn: { id: "q1", at: "2026-11-12T05:00:00Z", flags: [], source: "admin" as const }, clockOut: { id: "q2", at: "2026-11-12T06:30:00Z", flags: [], source: "admin" as const }, minutes: 90, edits: [], approved: null };
const two = card.clockPeople([people[0]], [...rows, second], "America/Chicago")[0];
check("Each pair is listed, in time order", two.pairs.length === 2 && two.pairs[0].inAt === "2026-11-11T22:32:00Z" && two.pairs[1].inAt === "2026-11-12T05:00:00Z");
check("And the combined total adds the rows' minutes", two.totalMinutes === 432 && card.totalText(two) === "Total 7 h 12 m · 7.20", card.totalText(two));
check("The combined total matches the Time page's staff total", ts.staffTotals([...rows, second]).find((t) => t.staffId === "b1")!.minutes === two.totalMinutes);
const copy = card.clockCopyText("Justin · Birthday, Wednesday, November 11, 2026", [two, joC, kaiC], "America/Chicago");
check(
  "Copy times: plain text lines with the role, state, each pair, and the total",
  copy.startsWith("Justin · Birthday, Wednesday, November 11, 2026 · times in Central time") &&
    copy.includes("Sam Lee (Bartender): Clocked out\n1. In Nov 11, 4:32 PM") &&
    copy.includes("2. In Nov 11, 11:00 PM · Out Nov 12, 12:30 AM · 1 h 30 m · 1.50") &&
    copy.includes("Total 7 h 12 m · 7.20") &&
    copy.includes("Jo Park (Bar back): Clocked in since Nov 11, 5:05 PM") &&
    copy.includes("Kai Ross (Server): Not clocked in\nIn missing · Out missing") &&
    !/<|>/.test(copy),
  copy
);

// ----- Pacific events -----
reset("200 Ocean Ave, Santa Monica, CA");
db.sessions[0].team_market = "los_angeles";
const la = await tsDb.eventTimesheetRows("s1");
const laCard = card.clockPeople(people, la, la[0].timeZone);
check("A Los Angeles event shows Pacific times", la[0].timeZone === "America/Los_Angeles" && laCard[0].pairs.length > 0 && card.dateTimeLabel(laCard[0].pairs[0].inAt, la[0].timeZone) === "Nov 11, 2:32 PM", la[0].timeZone);

// ----- The page -----
const page = src("app/team/admin/e/[id]/page.tsx");
const dayOf = src("app/team/admin/e/[id]/day-of.tsx");
check("The card is titled Time clock, with Copy times and a link to the Time page", dayOf.includes(">Time clock</h2>") && dayOf.includes('label="Copy times"') && dayOf.includes("href={timeHref}"));
check("The page feeds it the event's timesheet rows and the Time page link", page.includes("eventTimesheetRows(id)") && page.includes("rows={clockRows}") && page.includes("timeHref={timePageHref(id, eventSchedule(ed).day)}"));
check("The card never works out hours itself: no workedMinutes or date math in the card", !/workedMinutes\(|rowMinutes\(|60_?000/.test(src("lib/team/clock-card.ts")) && !/workedMinutes/.test(dayOf.slice(dayOf.indexOf("export function ClockStatus"), dayOf.indexOf("export function TimePunches"))));
check("The Time page link opens that event's week, just that event", card.timePageHref("s1", "2026-11-11") === "/team/admin/timesheets?week=2026-11-11&event=s1");
const timePage = src("app/team/admin/timesheets/page.tsx");
check("The Time page filters to the event and offers the whole week", timePage.includes("all.filter((r) => r.sessionId === eventId)") && timePage.includes("Show the whole week"));

done("time clock card");
