// Part 7: hourly rates and estimated pay.
// Run: node --no-warnings scripts/test-pay.mts

import { readdirSync, statSync } from "node:fs";
import { addDays, check, done, event, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const pay = await import("../lib/team/pay.ts");
const payDb = await import("../lib/team/pay-db.ts");
const ts = await import("../lib/team/timesheet.ts");

const CT = "America/Chicago";
const today = time.todayIn(CT);

// ----- The math -----
const party = { event_date: today, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_type: "Birthday" };
const wedding = { ...party, event_type: "Wedding" };
check("Arrival to service end plus an hour of breakdown", pay.scheduledMinutes(party) === 7 * 60, String(pay.scheduledMinutes(party)));
check("Weddings arrive earlier, so more hours", pay.scheduledMinutes(wedding) === 8 * 60);
check("Service past midnight", pay.scheduledMinutes({ ...party, bar_service_end: "1:00am" }) === 10 * 60);
check("No times, no estimate", pay.scheduledMinutes({ event_date: today }) === null);
check("Rate times hours", pay.estimatedPayCents(2500, party) === 17500 && pay.money(17500) === "$175.00");
check("No rate, no pay", pay.estimatedPayCents(null, party) === null && pay.estimatedPayCents(0, party) === null);
check("Cents round", pay.payCents(2750, 25) === 1146);
check("Money reads well", pay.money(123450) === "$1,234.50" && pay.rateText(2500) === "$25.00/hr");
check("The label is exact", pay.PAY_LABEL === "Estimated pay, before taxes and tips");
check("A rate in dollars", (() => { const r = pay.validateRate("27.50"); return r.ok && r.cents === 2750; })() && (() => { const r = pay.validateRate("$25"); return r.ok && r.cents === 2500; })());
check("Blank clears the rate", (() => { const r = pay.validateRate(""); return r.ok && r.cents === null; })());
check("Bad rates are refused", !pay.validateRate("abc").ok && !pay.validateRate("0").ok && !pay.validateRate("250").ok && !pay.validateRate("25.555").ok);
const rows = [
  { sessionId: "a", day: "2026-11-02", title: "A", scheduledMinutes: 420, approvedMinutes: 450, payCents: 18750, fromApproved: true },
  { sessionId: "b", day: "2026-11-07", title: "B", scheduledMinutes: 420, approvedMinutes: null, payCents: 17500, fromApproved: false },
  { sessionId: "c", day: "2026-11-10", title: "C", scheduledMinutes: 420, approvedMinutes: null, payCents: 17500, fromApproved: false },
];
const totals = pay.payTotals(rows);
check("Week totals by Monday", JSON.stringify(totals.weeks.map((w) => [w.week, w.cents])) === JSON.stringify([["2026-11-02", 36250], ["2026-11-09", 17500]]), JSON.stringify(totals.weeks));
check("Month total", totals.months.length === 1 && totals.months[0].cents === 53750);

// ----- From the database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const d3 = addDays(today, -3);
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    event("p1", d3, "1 Elm St, Dallas, TX", { event_name: "Past One" }, { team_market: "dallas" }),
    event("f1", addDays(today, 5), "1 Elm St, Dallas, TX", { event_name: "Future One" }, { team_market: "dallas" }),
  ];
  db.staff = [admin, b1, b2].map((s) => ({ ...s, markets: ["dallas"] }));
  db.staff_pay_rates = [{ staff_id: "b1", hourly_rate_cents: 2500 }, { staff_id: "b2", hourly_rate_cents: 3000 }];
  db.event_assignments = [
    { id: "x1", session_id: "p1", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "p1", staff_id: "b2", status: "accepted" },
    { id: "x3", session_id: "f1", staff_id: "b1", status: "accepted" },
  ];
  const at = (min: number) => time.zonedInstant(d3, min, CT).toISOString();
  db.time_punches = [
    { id: "i1", assignment_id: "x1", staff_id: "b1", session_id: "p1", type: "in", punched_at: at(16 * 60), flags: [], source: "phone" },
    { id: "o1", assignment_id: "x1", staff_id: "b1", session_id: "p1", type: "out", punched_at: at(23 * 60 + 30), flags: [], source: "phone" },
    { id: "i2", assignment_id: "x2", staff_id: "b2", session_id: "p1", type: "in", punched_at: at(16 * 60), flags: [], source: "phone" },
    { id: "o2", assignment_id: "x2", staff_id: "b2", session_id: "p1", type: "out", punched_at: at(23 * 60), flags: [], source: "phone" },
  ];
  db.time_approvals = [{ assignment_id: "x1", approved_by: "a1", approved_at: new Date().toISOString() }];
  db.time_edits = [];
  db.time_reopens = [];
  db.team_hidden_events = [];
}
reset();
check("A person's own rate", (await payDb.rateFor("b1")) === 2500 && (await payDb.rateFor("a1")) === null);
check("Admins can list rates", (await payDb.ratesFor(admin, ["b1", "b2"])).get("b2") === 3000);
check("A bartender gets no one's rates from the admin list", (await payDb.ratesFor(b1, ["b1", "b2"])).size === 0);
check("Only admins set rates", !(await payDb.setRate(b1, "b1", "99")).ok && db.staff_pay_rates.find((r) => r.staff_id === "b1")?.hourly_rate_cents === 2500);
check("An admin sets a rate", (await payDb.setRate(admin, "b1", "27.50")).ok && db.staff_pay_rates.find((r) => r.staff_id === "b1")?.hourly_rate_cents === 2750);
check("An admin clears a rate", (await payDb.setRate(admin, "b2", "")).ok && !db.staff_pay_rates.some((r) => r.staff_id === "b2"));
check("No rate, no estimate", JSON.stringify(await payDb.myEstimates("b2", ["p1", "f1"])) === "{}" && (await payDb.myEstimate("b2", db.sessions[0] as never)) === null);
reset();
const est = await payDb.myEstimates("b1", ["p1", "f1"]);
check("Estimates use only the viewer's own rate", est.f1 === "$175.00" && est.p1 === "$175.00", JSON.stringify(est));
check("Another bartender's estimate uses their own rate", (await payDb.myEstimate("b2", db.sessions[1] as never)) === "$210.00");
db.shift_posts = [{ id: "post1", session_id: "f1", market: "dallas", kind: "open", status: "posted" }];
check("Open shift details show the viewer's estimate", (await payDb.myEstimateForPost("b2", "post1")) === "$210.00" && (await payDb.myEstimateForPost("a1", "post1")) === null);
const mine = await payDb.myPayRows("b1", addDays(today, -30), addDays(today, 30));
check("My pay lists only my events", mine.rows.length === 2 && mine.rows.every((r) => ["p1", "f1"].includes(r.sessionId)));
const p1 = mine.rows.find((r) => r.sessionId === "p1")!;
check("Approved clocked hours drive pay once approved", p1.fromApproved && p1.approvedMinutes === 450 && p1.payCents === 18750, JSON.stringify(p1));
const f1 = mine.rows.find((r) => r.sessionId === "f1")!;
check("Before approval it is the scheduled estimate", !f1.fromApproved && f1.approvedMinutes === null && f1.payCents === 17500);
const theirs = await payDb.myPayRows("b2", addDays(today, -30), addDays(today, 30));
check("Unapproved clocked hours are not shown as approved", theirs.rows.length === 1 && theirs.rows[0].approvedMinutes === null && theirs.rows[0].payCents === 21000);

// CSV
const sheet = (await import("../lib/team/timesheet-db.ts")).timesheetRows;
const all = await sheet(addDays(today, -30), addDays(today, 30));
const csv = ts.timesheetCsv(all, await payDb.ratesFor(admin, all.map((r) => r.staffId)));
const lines = csv.trim().split("\r\n");
check("The CSV has the rate and pay columns", lines[0].endsWith("Hourly rate,Pay (hours x rate)"));
const b1Line = lines.find((l) => l.startsWith("Jordan Lee") && l.includes("Past One")) ?? "";
check("Hours times rate in the CSV", b1Line.endsWith(",25.00,187.50"), b1Line);
const noRates = ts.timesheetCsv(all);
check("Without rates the columns are blank", noRates.split("\r\n")[1].endsWith(",,"));

// ----- Nobody sees another person's pay -----
function files(dir: string): string[] {
  return readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(new URL(`../${p}`, import.meta.url)).isDirectory() ? files(p) : [p];
  });
}
const tsx = [...files("app"), ...files("lib")].filter((f) => /\.(ts|tsx)$/.test(f));
const staffSide = tsx.filter((f) => f.startsWith("app/team/") && !f.startsWith("app/team/admin/"));
const ownOnly = staffSide.every((f) => {
  const s = src(f);
  const calls = [...s.matchAll(/\b(rateFor|myEstimate|myEstimates|myEstimateForPost|myPayRows)\(([^,)]*)/g)];
  return calls.every((c) => c[2].trim() === "staff.id");
});
check("Staff pages only ever ask for the signed in person's own pay", ownOnly);
check("Staff pages never load everyone's rates", staffSide.every((f) => !src(f).includes("ratesFor(")));
check("Rates are read only in the pay module", tsx.filter((f) => src(f).includes("staff_pay_rates")).join() === "lib/team/pay-db.ts");
check("Admin rate tools are admin only", src("app/api/team/admin/pay/route.ts").includes('staff.role !== "admin"') && src("lib/team/pay-db.ts").includes('if (admin.role !== "admin") return { ok: false'));
check("The admin staff page that shows rates is behind requireAdmin", src("app/team/admin/staff/[id]/page.tsx").includes("requireAdmin") && src("app/team/admin/staff/page.tsx").includes("requireAdmin"));
check("The CSV with rates is admin only", src("app/api/team/admin/timesheets/export/route.ts").includes('staff.role !== "admin"'));
check("Shift summaries carry no pay", !/pay|rate/i.test(src("lib/team/shifts.ts").match(/export interface ShiftSummary \{[\s\S]*?\n\}/)?.[0] ?? "x"));
check("Staff lists carry no rate", !/rate/i.test(src("lib/team/assignments-db.ts").match(/STAFF_COLUMNS = [^\n]*/)?.[0] ?? "x"));
check("The event list only adds pay on the viewer's own events", src("app/team/events/page.tsx").includes("myEstimates(staff.id"));
check("Pay shows with the label", src("app/team/shifts/[id]/page.tsx").includes("PAY_LABEL") && src("app/team/e/[id]/event-tabs.tsx").includes("estimated pay, before taxes and tips") && src("app/team/events/event-list.tsx").includes("estimated pay, before taxes and tips"));
check("My pay says payroll is the final record", pay.PAY_NOTE.includes("Payroll is the final record") && src("app/team/pay/page.tsx").includes("PAY_NOTE"));
check("My pay is linked from Me", src("app/team/me/page.tsx").includes('"/team/pay"'));

done("pay");
