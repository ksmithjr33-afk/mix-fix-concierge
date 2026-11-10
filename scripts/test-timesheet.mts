// Timesheets: the pure rules, then edits, approvals and reopens run through the real
// code against the in-memory database, with guards standing in for the
// database constraints and the approved-row lock.
// Run: node --no-warnings scripts/test-timesheet.mts

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase") return nextResolve(new URL("./fake-supabase.mts", import.meta.url).href, context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

const out = console.log;
console.log = () => {};
console.warn = () => {};

const { db, guards, rpcs, supabase } = await import("./fake-supabase.mts");
const ts = await import("../lib/team/timesheet.ts");
const tsDb = await import("../lib/team/timesheet-db.ts");
const time = await import("../lib/team/time.ts");

let failed = 0;
let total = 0;
function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  out(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}

// ----- Weeks -----
check("A week starts on Monday", ts.weekStart("2026-11-12") === "2026-11-09" && ts.weekStart("2026-11-09") === "2026-11-09");
check("Sunday belongs to the week before", ts.weekStart("2026-11-15") === "2026-11-09");
const wk = ts.weekRange("2026-12-31");
check("Week range crosses the year", wk.from === "2026-12-28" && wk.to === "2027-01-03" && wk.prev === "2026-12-21" && wk.next === "2027-01-04", JSON.stringify(wk));
check("Week label", ts.weekLabel("2026-11-09", "2026-11-15") === "Nov 9 to Nov 15, 2026", ts.weekLabel("2026-11-09", "2026-11-15"));
check("Bad dates are refused", !ts.isYmd("2026-02-30") && !ts.isYmd("2026-1-5") && !ts.isYmd(null) && ts.isYmd("2028-02-29"));

// ----- Chicago input times -----
const late = ts.parseChicagoLocal("2026-12-12T23:30");
check("A datetime-local value is Chicago time", late?.toISOString() === "2026-12-13T05:30:00.000Z", late?.toISOString());
check("Summer time too", ts.parseChicagoLocal("2026-07-04T18:00")?.toISOString() === "2026-07-04T23:00:00.000Z");
check("Bad input times are refused", ts.parseChicagoLocal("2026-12-12T25:00") === null && ts.parseChicagoLocal("noon") === null && ts.parseChicagoLocal(undefined) === null);
check("Round trip to the input", ts.toChicagoLocal("2026-12-13T05:30:00.000Z") === "2026-12-12T23:30");

// ----- Hours -----
const p = (at: string, flags: string[] = []) => ({ id: at, at, flags: flags as never, source: "phone" as const });
check("Hours to the minute", ts.rowMinutes(p("2026-12-12T22:00:00Z"), p("2026-12-13T03:07:40Z")) === 308);
check("Hours across midnight", ts.rowMinutes(p(ts.parseChicagoLocal("2026-12-12T21:00")!.toISOString()), p(ts.parseChicagoLocal("2026-12-13T01:30")!.toISOString())) === 270);
check("No hours until both punches", ts.rowMinutes(p("2026-12-12T22:00:00Z"), null) === null);

// ----- Edit and approve rules -----
const now = new Date("2026-12-14T12:00:00Z");
const base = { staffId: "b1", approved: null, clockIn: p("2026-12-13T00:00:00Z"), clockOut: p("2026-12-13T05:00:00Z") };
const fine = { type: "out" as const, at: new Date("2026-12-13T05:30:00Z"), reason: "Left at 11:30" };
const msg = (c: { ok: boolean; error?: string }) => (c.ok ? "ok" : (c as { error: string }).error);
check("An admin can correct someone else's time", ts.checkEdit("a1", base, fine, now).ok);
check("Nobody edits their own time, with a clear message", msg(ts.checkEdit("b1", base, fine, now)) === ts.OWN_EDIT_MESSAGE);
check("The own time message says what to do", ts.OWN_EDIT_MESSAGE === "You cannot edit your own time. Ask another admin to make this change.");
check("An edit needs a reason", msg(ts.checkEdit("a1", base, { ...fine, reason: "  " }, now)) === "Give a reason for the change.");
check("A two letter reason is not enough", !ts.checkEdit("a1", base, { ...fine, reason: "ok" }, now).ok);
check("An approved row is locked", msg(ts.checkEdit("a1", { ...base, approved: { byName: "C", at: "x" } }, fine, now)) === ts.LOCKED_MESSAGE);
check("Own time is refused before locked", msg(ts.checkEdit("b1", { ...base, approved: { byName: "C", at: "x" } }, fine, now)) === ts.OWN_EDIT_MESSAGE);
check("A future time is refused", !ts.checkEdit("a1", base, { ...fine, at: new Date("2026-12-14T13:00:00Z") }, now).ok);
check("A bad time is refused", !ts.checkEdit("a1", base, { ...fine, at: null }, now).ok);
check("Clock out before clock in is refused", !ts.checkEdit("a1", base, { ...fine, at: new Date("2026-12-12T23:00:00Z") }, now).ok);
check("Clock in after clock out is refused", !ts.checkEdit("a1", base, { type: "in", at: new Date("2026-12-13T06:00:00Z"), reason: "Arrived late" }, now).ok);
check("A clock out past midnight is fine", ts.checkEdit("a1", base, { ...fine, at: ts.parseChicagoLocal("2026-12-13T01:15") }, now).ok);

check("An admin can approve someone else's row", ts.checkApprove("a1", base).ok);
check("Nobody approves their own time, with a clear message", msg(ts.checkApprove("b1", base)) === ts.OWN_APPROVE_MESSAGE);
check("A row needs both punches to approve", !ts.checkApprove("a1", { ...base, clockOut: null }).ok);
check("A row is approved once", !ts.checkApprove("a1", { ...base, approved: { byName: "C", at: "x" } }).ok);

const row = (o: Partial<import("../lib/team/timesheet.ts").TimesheetRow>): import("../lib/team/timesheet.ts").TimesheetRow => ({
  assignmentId: "x",
  staffId: "b1",
  staffName: "Jordan Lee",
  staffPhone: "+12145550101",
  sessionId: "s1",
  eventTitle: "Justin · Birthday",
  eventDay: "2026-12-12",
  scheduledStart: "6:00 PM",
  scheduledEnd: "10:00 PM",
  clockIn: p("2026-12-13T00:00:00Z"),
  clockOut: p("2026-12-13T05:30:00Z"),
  minutes: 330,
  flags: [],
  edits: [],
  editedByAdmin: false,
  reopens: [],
  approved: null,
  ...o,
});
check("An admin can reopen someone else's approved row", ts.checkReopen("a1", { staffId: "b1", approved: { byName: "C", at: "x" } }, "Clock out was wrong").ok);
check("Nobody reopens their own time, with a clear message", msg(ts.checkReopen("b1", { staffId: "b1", approved: { byName: "C", at: "x" } }, "Clock out was wrong")) === ts.OWN_REOPEN_MESSAGE);
check("The own reopen message says what to do", ts.OWN_REOPEN_MESSAGE === "You cannot reopen your own time. Ask another admin to reopen it.");
check("A reopen needs a reason", msg(ts.checkReopen("a1", { staffId: "b1", approved: { byName: "C", at: "x" } }, " ok ")) === "Give a reason for reopening.");
check("Only an approved row can be reopened", msg(ts.checkReopen("a1", { staffId: "b1", approved: null }, "Clock out was wrong")) === "This row is not approved.");
check("Own time is refused before anything else on reopen", msg(ts.checkReopen("b1", { staffId: "b1", approved: null }, "")) === ts.OWN_REOPEN_MESSAGE);
check("The locked message points to reopen", ts.LOCKED_MESSAGE === "This row is approved and locked. Reopen it to make changes.");
check("The database own reopen error maps to the message", ts.ownTimeConstraint('violates check constraint "time_reopens_not_own"') === "reopen");
const hist = ts.rowHistory({
  edits: [{ type: "out", action: "add", oldAt: null, newAt: "x", reason: "a", byName: "K", at: "2026-12-13T10:00:00Z" }, { type: "in", action: "correct", oldAt: "x", newAt: "y", reason: "c", byName: "K", at: "2026-12-14T10:00:00Z" }],
  reopens: [{ reason: "b", byName: "P", at: "2026-12-13T12:00:00Z", approvedByName: "K", approvedAt: "2026-12-13T11:00:00Z" }],
});
check("Edits and reopens show in one history, oldest first", hist.map((h) => h.kind).join() === "edit,reopen,edit", JSON.stringify(hist));

const plan = ts.weekApproval("a1", [
  row({ assignmentId: "r1" }),
  row({ assignmentId: "r2", staffId: "a1" }),
  row({ assignmentId: "r3", clockOut: null, minutes: null }),
  row({ assignmentId: "r4", approved: { byName: "C", at: "x" } }),
]);
check("Approve week takes only the rows that pass", plan.approve.join() === "r1", JSON.stringify(plan));
check("Approve week skips your own rows with the message", plan.skipped.some((s) => s.assignmentId === "r2" && s.reason === ts.OWN_APPROVE_MESSAGE));
check("Approve week skips incomplete rows", plan.skipped.some((s) => s.assignmentId === "r3") && !plan.skipped.some((s) => s.assignmentId === "r4"));
check("Database own-time errors map to the message", ts.ownTimeConstraint('violates check constraint "time_edits_not_own"') === "edit" && ts.ownTimeConstraint('violates check constraint "time_approvals_not_own"') === "approve" && ts.ownTimeConstraint("other") === null);

const totals = ts.staffTotals([row({ assignmentId: "1" }), row({ assignmentId: "2", minutes: 90 }), row({ assignmentId: "3", minutes: null, clockOut: null }), row({ assignmentId: "4", staffId: "b2", staffName: "Sam", minutes: 60 })]);
check("Per staff totals", totals[0].staffId === "b1" && totals[0].minutes === 420 && totals[0].open === 1 && totals[1].minutes === 60, JSON.stringify(totals));

// ----- CSV -----
const csv = ts.timesheetCsv([
  row({ flags: ["far", "edited"] as never, editedByAdmin: true, approved: { byName: "Pat Jones", at: "x" } }),
  row({ assignmentId: "y", staffName: '=HYPERLINK("x")', eventTitle: "Smith, Wedding", clockOut: null, minutes: null }),
]);
const lines = csv.split("\r\n");
check(
  "CSV header has every column",
  lines[0] === "Staff name,Staff phone,Event date,Event name,Scheduled start,Scheduled end,Clock in,Clock out,Hours,Flags,Edited by admin,Approved by",
  lines[0],
);
check(
  "CSV row: phone, schedule, Chicago times, decimal hours, flags, edited yes",
  lines[1] === "Jordan Lee,(214) 555-0101,2026-12-12,Justin · Birthday,6:00 PM,10:00 PM,2026-12-12 6:00 PM,2026-12-12 11:30 PM,5.50,away from event; corrected by admin,Yes,Pat Jones",
  lines[1],
);
check("CSV edited is No when nothing was edited, hours blank until clock out", lines[2].endsWith(",,No,") && lines[2].includes(",2026-12-12 6:00 PM,,,"), lines[2]);
check("CSV stops spreadsheet formulas", lines[2].startsWith(`"'=HYPERLINK(""x"")"`), lines[2]);
check("CSV quotes commas", lines[2].includes('"Smith, Wedding"'));
check("CSV phone is readable and stays text", ts.csvPhone("+12145550101") === "(214) 555-0101" && ts.csvPhone("+447700900123") === "+447700900123");
check("CSV across midnight", ts.csvTime(ts.parseChicagoLocal("2026-12-13T01:30")!.toISOString()) === "2026-12-13 1:30 AM" && ts.csvHours(270) === "4.50");
check("CSV ends with a line break", csv.endsWith("\r\n") && lines.length === 4);

// ----- Edits and approvals through the database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const admin2 = { id: "a2", name: "Pat Jones", phone: "+12145550102", role: "admin" as const, active: true, alerts: true };
const bart = { id: "b1", name: "Jordan Lee", phone: "+12145550101", role: "bartender" as const, active: true };
const day = time.chicagoToday(new Date(Date.now() - 3 * 86_400_000));
const local = (hm: string, next = false) => {
  const [y, m, d] = day.split("-").map(Number);
  const dd = next ? new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10) : day;
  return ts.parseChicagoLocal(`${dd}T${hm}`)!;
};

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    {
      id: "s1",
      status: "submitted",
      event_date: day,
      event_data: { client_name: "Justin Reyes", client_email: "justin@example.com", client_phone: "+19725550199", event_type: "Birthday", event_date: day, bar_service_start: "6:00pm", bar_service_end: "11:00pm", booked_price: 1800 },
    },
    { id: "s2", status: "submitted", event_date: "2020-01-04", event_data: { client_name: "Old Event", event_date: "2020-01-04" } },
  ];
  db.staff = [admin, admin2, bart];
  db.event_assignments = [
    { id: "as1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "s1", staff_id: "a1", status: "accepted" },
    { id: "as3", session_id: "s1", staff_id: "a2", status: "declined" },
    { id: "as4", session_id: "s2", staff_id: "b1", status: "accepted" },
  ];
  db.time_punches = [
    { id: "p1", assignment_id: "as1", staff_id: "b1", session_id: "s1", type: "in", punched_at: local("16:00").toISOString(), flags: [], source: "phone" },
    { id: "p2", assignment_id: "as2", staff_id: "a1", session_id: "s1", type: "in", punched_at: local("16:05").toISOString(), flags: ["far"], source: "phone" },
    { id: "p3", assignment_id: "as2", staff_id: "a1", session_id: "s1", type: "out", punched_at: local("00:10", true).toISOString(), flags: [], source: "phone" },
  ];
  db.time_edits = [];
  db.time_approvals = [];
  db.time_reopens = [];
}
// Stand-ins for the database rules, so the app's handling of a refusal is exercised too.
guards.push((table, op, rows) => {
  if (table === "time_edits" && op === "insert" && rows.some((r) => r.edited_by === r.staff_id)) return 'new row violates check constraint "time_edits_not_own"';
  if (table === "time_approvals" && op === "insert" && rows.some((r) => r.approved_by === r.staff_id)) return 'new row violates check constraint "time_approvals_not_own"';
  if ((table === "time_punches" || table === "time_edits") && rows.some((r) => (db.time_approvals ?? []).some((a) => a.assignment_id === r.assignment_id)))
    return `timesheet row ${rows[0].assignment_id} is approved and locked`;
  return null;
});
// Stand-in for reopen_timesheet_row() and the approval trigger: an approval is
// removed only by the reopen function, after it logs the reopen.
let reopening: string | null = null;
guards.push((table, op, rows) => {
  if (table === "time_approvals" && (op === "update" || (op === "delete" && !rows.every((r) => r.assignment_id === reopening)))) return `timesheet row ${rows[0]?.assignment_id} is approved and locked`;
  if (table === "time_reopens" && (op === "update" || op === "delete")) return "reopen history cannot be changed";
  return null;
});
const rpcCalls: Record<string, unknown>[] = [];
rpcs.reopen_timesheet_row = (args) => {
  rpcCalls.push(args);
  const by = db.staff.find((x) => x.id === args.p_reopened_by);
  if (!by || by.role !== "admin" || !by.active) return { data: null, error: { message: "only an admin can reopen a timesheet row" } };
  const ap = db.time_approvals.find((x) => x.assignment_id === args.p_assignment_id);
  if (!ap) return { data: null, error: { message: `timesheet row ${args.p_assignment_id} is not approved` } };
  if (ap.staff_id === args.p_reopened_by) return { data: null, error: { message: 'new row for relation "time_reopens" violates check constraint "time_reopens_not_own"' } };
  const reason = String(args.p_reason ?? "").trim();
  if (reason.length < 3) return { data: null, error: { message: 'violates check constraint "time_reopens_reason_check"' } };
  const r = { id: `r${db.time_reopens.length + 1}`, assignment_id: ap.assignment_id, staff_id: ap.staff_id, reopened_by: args.p_reopened_by, reason, approved_by: ap.approved_by, approved_at: ap.approved_at, created_at: new Date().toISOString() };
  db.time_reopens.push(r);
  reopening = String(ap.assignment_id);
  db.time_approvals = db.time_approvals.filter((x) => x.assignment_id !== ap.assignment_id);
  reopening = null;
  return { data: r, error: null };
};

reset();
const week = ts.weekRange(day);
const rows = await tsDb.timesheetRows(week.from, week.to);
check("One row per staff member per event in the week", rows.length === 2 && rows.every((r) => r.sessionId === "s1"), JSON.stringify(rows.map((r) => r.assignmentId)));
check("Declined staff without punches have no row", !rows.some((r) => r.assignmentId === "as3"));
const mine = rows.find((r) => r.assignmentId === "as2")!;
check("A row past midnight has its hours", mine.minutes === 8 * 60 + 5, String(mine.minutes));
check("A row has the staff phone and the schedule", mine.staffPhone === admin.phone && mine.scheduledStart === "6:00 PM" && mine.scheduledEnd === "11:00 PM");
check("Rows carry the punch flags", mine.flags.join() === "far");
check("Rows never carry client contact or pricing", !/justin@example|9725550199|1800|Reyes/.test(JSON.stringify(rows)), JSON.stringify(rows));

const noReason = await tsDb.editPunch(admin, "as1", "out", local("23:15"), " ");
check("The edit path needs a reason", !noReason.ok && noReason.status === 400 && db.time_punches.length === 3);
const ownEdit = await tsDb.editPunch(admin, "as2", "out", local("23:15"), "Left early");
check("The edit path refuses your own time with the message", !ownEdit.ok && ownEdit.status === 403 && ownEdit.error === ts.OWN_EDIT_MESSAGE && db.time_edits.length === 0);

const added = await tsDb.editPunch(admin, "as1", "out", local("23:40"), "Forgot to clock out");
const addedPunch = db.time_punches.find((x) => x.assignment_id === "as1" && x.type === "out");
check("An admin adds a missing clock out", added.ok && !!addedPunch && addedPunch.source === "admin" && addedPunch.created_by === "a1", JSON.stringify(added));
check("The added punch is flagged and has its reason", (addedPunch?.flags as string[]).join() === "admin_entry" && db.time_edits.length === 1 && db.time_edits[0].reason === "Forgot to clock out" && db.time_edits[0].action === "add");
check("The row now has hours and shows edited", added.ok && added.rows[0].minutes === 7 * 60 + 40 && added.rows[0].editedByAdmin);

const corrected = await tsDb.editPunch(admin, "as1", "in", local("16:30"), "Arrived at 4:30, tapped early");
const pin = db.time_punches.find((x) => x.id === "p1")!;
check("An admin corrects a punch", corrected.ok && pin.punched_at === local("16:30").toISOString() && (pin.flags as string[]).includes("edited"));
check("The correction keeps the original time", db.time_edits[1].old_punched_at === local("16:00").toISOString() && db.time_edits[1].action === "correct");
check("Edit history names the admin", corrected.ok && corrected.rows[0].edits.length === 2 && corrected.rows[0].edits.every((e) => e.byName === "Kenneth Smith"));

const approved1 = await tsDb.approveRows({ ...admin2 }, ["as1"]);
check("Another admin approves a row", approved1.ok && db.time_approvals.length === 1 && db.time_approvals[0].approved_by === "a2");
check("An approved row shows who approved it", approved1.ok && approved1.rows[0].approved?.byName === "Pat Jones");
const lockedEdit = await tsDb.editPunch(admin, "as1", "out", local("23:50"), "One more fix");
check("An approved row cannot be edited", !lockedEdit.ok && lockedEdit.error === ts.LOCKED_MESSAGE && db.time_edits.length === 2);
const again = await tsDb.approveRows(admin, ["as1"]);
check("An approved row is not approved twice", !again.ok && db.time_approvals.length === 1);

const ownApprove = await tsDb.approveRows(admin, ["as2"]);
check("Approving your own row is refused with the message", !ownApprove.ok && ownApprove.status === 403 && ownApprove.error === ts.OWN_APPROVE_MESSAGE && db.time_approvals.length === 1);

reset();
const weekly = await tsDb.approveRows(admin, ["as1", "as2"]);
check("Approve week skips your own and incomplete rows", weekly.ok && db.time_approvals.length === 0, JSON.stringify(weekly));
check(
  "Approve week says why rows were skipped",
  weekly.ok && weekly.message === "Approved 0 rows. 1 row is your own time. Ask another admin to approve it. 1 row needs a clock in or out first.",
  weekly.ok ? weekly.message : "",
);
const weekly2 = await tsDb.approveRows(admin2, ["as1", "as2"]);
check("Another admin approves the week", weekly2.ok && db.time_approvals.length === 1 && weekly2.message?.startsWith("Approved 1 row."), weekly2.ok ? weekly2.message : "");

// The database is the backstop: if its own-time constraint fires, the admin sees the same clear message.
reset();
guards.unshift((table, op) => (table === "time_edits" && op === "insert" ? 'new row violates check constraint "time_edits_not_own"' : null));
const backstop = await tsDb.editPunch(admin, "as1", "in", local("16:20"), "Arrived at 4:20");
guards.shift();
check("A database own-time refusal shows the clear message and changes nothing", !backstop.ok && backstop.error === ts.OWN_EDIT_MESSAGE && db.time_punches.find((x) => x.id === "p1")!.punched_at === local("16:00").toISOString());
guards.unshift((table, op) => (table === "time_edits" && op === "insert" ? 'new row violates check constraint "time_edits_not_own"' : null));
const backstopAdd = await tsDb.editPunch(admin, "as1", "out", local("23:00"), "Forgot to clock out");
guards.shift();
check("A refused edit row removes the added punch", !backstopAdd.ok && !db.time_punches.some((x) => x.assignment_id === "as1" && x.type === "out"));

// ----- Reopen -----
reset();
db.time_punches.push({ id: "p9", assignment_id: "as1", staff_id: "b1", session_id: "s1", type: "out", punched_at: local("23:00").toISOString(), flags: [], source: "phone" });
await tsDb.approveRows(admin2, ["as1", "as2"]);
check("Setup: both rows approved by the other admin", db.time_approvals.length === 2);
const plainDelete = await supabase.from("time_approvals").delete().eq("assignment_id", "as1");
check("A plain delete cannot remove an approval", !!plainDelete.error && db.time_approvals.length === 2);

const ownReopen = await tsDb.reopenRow(admin, "as2", "My clock out was wrong");
check("Reopening your own row is refused with the message", !ownReopen.ok && ownReopen.status === 403 && ownReopen.error === ts.OWN_REOPEN_MESSAGE && db.time_approvals.length === 2 && db.time_reopens.length === 0);
check("The own reopen is refused before the database is asked", rpcCalls.length === 0);
const noWhy = await tsDb.reopenRow(admin, "as1", "  ");
check("Reopening needs a reason", !noWhy.ok && noWhy.status === 400 && db.time_approvals.length === 2 && rpcCalls.length === 0);
const notApproved = await tsDb.reopenRow(admin, "as4", "Wrong hours");
check("A row that is not approved cannot be reopened", !notApproved.ok && rpcCalls.length === 0);

const reopened = await tsDb.reopenRow(admin, "as1", "  Clock out was wrong, left at 11:30  ");
check("Another admin reopens the row", reopened.ok && !db.time_approvals.some((x) => x.assignment_id === "as1") && db.time_approvals.length === 1, JSON.stringify(reopened));
check("The reopen goes through the database function", rpcCalls.length === 1 && rpcCalls[0].p_assignment_id === "as1" && rpcCalls[0].p_reopened_by === "a1");
const log = db.time_reopens[0];
check("The reopen is logged with who and why, and which approval it undid", log?.reopened_by === "a1" && log?.reason === "Clock out was wrong, left at 11:30" && log?.approved_by === "a2" && !!log?.created_at, JSON.stringify(log));
check("The reopened row shows as not approved, with its reopen history", reopened.ok && reopened.rows[0].approved === null && reopened.rows[0].reopens.length === 1 && reopened.rows[0].reopens[0].byName === "Kenneth Smith" && reopened.rows[0].reopens[0].approvedByName === "Pat Jones");
check("The reopen answer tells the admin what next", reopened.ok && reopened.message === "Reopened. Correct the row, then approve it again.");

const fixed = await tsDb.editPunch(admin, "as1", "out", local("23:30"), "Left at 11:30");
check("The reopened row can be corrected", fixed.ok && db.time_punches.find((x) => x.id === "p9")!.punched_at === local("23:30").toISOString());
const reapproved = await tsDb.approveRows(admin2, ["as1"]);
check("And approved again", reapproved.ok && db.time_approvals.some((x) => x.assignment_id === "as1" && x.approved_by === "a2"));
const lockedAgain = await tsDb.editPunch(admin, "as1", "out", local("23:45"), "Another fix");
check("Approved again, it is locked again", !lockedAgain.ok && lockedAgain.error === ts.LOCKED_MESSAGE);
const histRow = (await tsDb.timesheetRows(week.from, week.to)).find((r) => r.assignmentId === "as1")!;
check("History shows the reopen between the approval and the correction", ts.rowHistory(histRow).map((h) => h.kind).join() === "reopen,edit", JSON.stringify(ts.rowHistory(histRow)));
const changeLog = await supabase.from("time_reopens").delete().eq("assignment_id", "as1");
check("Reopen history cannot be removed", !!changeLog.error && db.time_reopens.length === 1);

// A database refusal reaches the admin as a clear message.
const inactive = await tsDb.reopenRow({ ...admin, id: "a9", active: true }, "as2", "Wrong hours");
check("Someone the database does not know as an active admin cannot reopen", !inactive.ok && inactive.error === "Admins only." && db.time_approvals.some((x) => x.assignment_id === "as2"), JSON.stringify(inactive));

// Approved rows load as approved.
reset();
db.time_punches.push({ id: "p9", assignment_id: "as1", staff_id: "b1", session_id: "s1", type: "out", punched_at: local("23:00").toISOString(), flags: [], source: "phone" });
db.time_approvals.push({ assignment_id: "as1", staff_id: "b1", approved_by: "a2" });
const fakeRow = (await tsDb.timesheetRows(week.from, week.to)).find((r) => r.assignmentId === "as1")!;
check("Approved rows load as approved", !!fakeRow.approved);

console.log = out;
if (failed > 0) {
  console.error(`\n${failed} of ${total} timesheet checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} timesheet checks pass.`);
