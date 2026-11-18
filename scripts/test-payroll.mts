// Payroll: pay periods, lines from the payout sheet, totals that match the
// Payout card, marking paid (one line, all for a person), undo, the changed
// after paid warning, the 40 hour flag, admins only (managers refused on the
// server), the page loading before the migration, the CSVs, and staff seeing
// only their own paid status.
// Run: node --no-warnings scripts/test-payroll.mts

import { registerHooks } from "node:module";
import { addDays, check, done, event, src } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db, supabase } = await import("./fake-supabase.mts");
const stub = await import("./stub-next.mts");
const codes = await import("../lib/team/codes.ts");
const auth = await import("../lib/team/auth.ts");
const time = await import("../lib/team/time.ts");
const payroll = await import("../lib/team/payroll.ts");
const payrollDb = await import("../lib/team/payroll-db.ts");
const payoutDb = await import("../lib/team/payout-db.ts");
const payDb = await import("../lib/team/pay-db.ts");
const bizDb = await import("../lib/team/business-db.ts");
const reimb = await import("../lib/team/reimbursements.ts");
const reimbDb = await import("../lib/team/reimbursements-db.ts");
const nav = await import("../lib/team/header-nav.ts");
const route = await import("../app/api/team/admin/payroll/route.ts");
const exportRoute = await import("../app/api/team/admin/payroll/export/route.ts");

const CT = "America/Chicago";
const today = time.chicagoToday();

// ----- Pay weeks: Monday to Sunday, paid the following Monday -----
const wed = "2026-11-18"; // a Wednesday
const thisW = payroll.weekPeriod(wed);
const lastW = payroll.lastWeek(wed);
check("A pay week is Monday to Sunday", thisW.key === "week" && thisW.from === "2026-11-16" && thisW.to === "2026-11-22", JSON.stringify(thisW));
check("The pay date is the Monday after", thisW.payDate === "2026-11-23" && lastW.payDate === "2026-11-16");
check("The page opens on last week", lastW.from === "2026-11-09" && lastW.to === "2026-11-15" && JSON.stringify(payroll.choosePeriod({}, wed)) === JSON.stringify(lastW));
check("A Sunday is the last day of its week, the Monday after starts the next", payroll.weekPeriod("2026-11-15").from === "2026-11-09" && payroll.weekPeriod("2026-11-16").from === "2026-11-16");
check("On a Monday, last week is the week that just ended and today is its pay date", payroll.lastWeek("2026-11-16").from === "2026-11-09" && payroll.lastWeek("2026-11-16").payDate === "2026-11-16");
check("On a Sunday, last week is the week before this one", payroll.lastWeek("2026-11-22").from === "2026-11-09");
check("Previous and next week arrows", payroll.shiftWeek(lastW, -1).from === "2026-11-02" && payroll.shiftWeek(lastW, 1).from === "2026-11-16" && payroll.shiftWeek(lastW, 1).payDate === "2026-11-23");
check("A week across the new year", JSON.stringify(payroll.weekPeriod("2027-01-01")) === JSON.stringify({ key: "week", from: "2026-12-28", to: "2027-01-03", payDate: "2027-01-04" }));
check("Any day in the address opens its week", payroll.choosePeriod({ week: "2026-11-04" }, wed).from === "2026-11-02");
check("A custom range is kept, with no pay date", JSON.stringify(payroll.choosePeriod({ from: "2026-11-01", to: "2026-11-20" }, wed)) === JSON.stringify({ key: "custom", from: "2026-11-01", to: "2026-11-20", payDate: null }));
check("A Monday to Sunday range is a pay week", payroll.rangePeriod("2026-11-09", "2026-11-15")?.key === "week" && payroll.rangePeriod("2026-11-09", "2026-11-15")?.payDate === "2026-11-16");
check("A backwards or too long range falls back to last week", payroll.choosePeriod({ from: "2026-11-20", to: "2026-11-01" }, wed).from === lastW.from && payroll.choosePeriod({ from: "2026-01-01", to: "2026-11-01" }, wed).from === lastW.from && payroll.rangePeriod("x", "y") === null);
check("The page has previous and next week arrows and shows the pay date", ["Previous week", "Next week", "Pay date {dayLabel(period.payDate)}", "Custom range"].every((t) => src("app/team/admin/payroll/page.tsx").includes(t)));

// ----- The rate rule (pure) -----
const pay = await import("../lib/team/pay.ts");
const rr = (own: number | null, pkg: string) => pay.lineRate(own, pkg);
check("$25 on Beer and Wine, Bartender Only and Tailored", ["Beer and Wine", "Bartender Only", "Bartender Only Package", "Tailored Bar", "Tailored"].every((p) => rr(null, p).cents === 2500 && rr(null, p).source === "package"));
check("$30 on Dive Bar, Essentials, Full Bar, Premium Bar and The Big Day Bar", ["Dive Bar", "Essentials Bar", "Essentials", "Full Bar", "Full Bar Package", "Premium Bar", "The Big Day Bar"].every((p) => rr(null, p).cents === 3000 && rr(null, p).source === "package"));
check("Any package not listed pays $30", rr(null, "Build a Bar").cents === 3000 && rr(null, "Build a Bar").source === "default" && rr(null, "").cents === 3000);
check("A person's own rate wins over the package rate", rr(3500, "Tailored Bar").cents === 3500 && rr(3500, "Tailored Bar").source === "own" && rr(2200, "Full Bar").cents === 2200);
check("Which rule applied, in words", pay.rateSourceText(rr(null, "Tailored Bar")) === "Tailored rate" && pay.rateSourceText(rr(3500, "Full Bar")) === "own rate" && pay.rateSourceText(rr(null, "Build a Bar")) === "standard rate");
check("The defaults are the pay rule", JSON.stringify(pay.PACKAGE_RATE_DEFAULTS) === JSON.stringify({ beerwine: 2500, bartender_only: 2500, tailored: 2500, dive: 3000, essentials: 3000, full: 3000, premium: 3000, wedding: 3000 }));
const bs = await import("../lib/team/business-settings.ts");
const savedRates = bs.validatePackageRates({ beerwine: "25", bartender_only: "25", tailored: "26.50", dive: "30", essentials: "30", full: "30", premium: "30", wedding: "30" });
check("Admins can edit the package rates", savedRates.ok && savedRates.value.tailored === 2650 && !bs.validatePackageRates({ beerwine: "" }).ok);
check("Saved rates are read over the defaults, broken ones fall back", bs.readPackageRates({ tailored: 2650, dive: -1 }).tailored === 2650 && bs.readPackageRates({ dive: -1 }).dive === 3000 && bs.readPackageRates(null).bartender_only === 2500);
check("One helper: nothing else figures a rate", !/effectiveRate|DEFAULT_RATE_CENTS/.test(["lib/team/pay-db.ts", "lib/team/payout.ts", "lib/team/payout-db.ts", "lib/team/business-db.ts", "lib/team/payroll.ts", "lib/team/payroll-db.ts", "app/team/admin/staff/page.tsx"].map(src).join("\n")) && (src("lib/team/pay.ts").match(/export function lineRate\(/g) ?? []).length === 1);

// ----- Gratuity: always split evenly among the bartenders -----
check("Gratuity splits evenly, whatever the hours or rate", JSON.stringify(pay.tipsShare(300, 3, true)) === JSON.stringify({ state: "on_file", cents: 10000, bartenders: 3 }) && pay.tipsShare(200, 2, true).state === "on_file");
check("No per person gratuity override anywhere", !/tips?_?override|gratuity_?override|tipOverride/i.test(["lib/team/pay.ts", "lib/team/pay-db.ts", "lib/team/payout.ts", "lib/team/payroll.ts", "lib/team/payroll-db.ts", "lib/team/reimbursements.ts", "lib/team/reimbursements-db.ts", "supabase/migrations/20261219_payroll_reimbursements.sql"].map(src).join("\n")));

// ----- The database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const mgr = { id: "m1", name: "Pat Manager", phone: "+12145550101", role: "manager" as const, active: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Avery Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const EVENT = { lat: 32.7767, lng: -96.797 };
const period = payroll.lastWeek(today);
const day1 = period.from;
const day2 = addDays(period.from, 1);
const day3 = addDays(period.from, 2);
const at = (day: string, min: number) => time.zonedInstant(day, min, CT).toISOString();
const punch = (id: string, a: string, staff: string, s: string, type: string, iso: string) => ({ id, assignment_id: a, staff_id: staff, session_id: s, type, punched_at: iso, flags: [], source: "phone" });

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  const top = { team_market: "dallas", geo_address: "1 Elm St, Dallas, TX", geo_lat: EVENT.lat, geo_lng: EVENT.lng, booked_price: { total: 1800, gratuity: 200, bartenders: 2 } };
  db.sessions = [
    event("p1", day1, "1 Elm St, Dallas, TX", {}, top),
    event("p2", day2, "1 Elm St, Dallas, TX", { client_name: "Maria Chen", event_type: "Wedding" }, top),
    event("p3", day3, "1 Elm St, Dallas, TX", { package: "Tailored Bar" }, { ...top, package_type: "Tailored Bar" }),
  ];
  db.staff = [admin, mgr, b1, b2].map((s) => ({ ...s, markets: ["dallas"] }));
  db.staff_pay_rates = [{ staff_id: "b2", hourly_rate_cents: 2500 }];
  db.staff_profiles = [];
  db.event_assignments = [
    { id: "x1", session_id: "p1", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "p1", staff_id: "b2", status: "accepted" },
    { id: "y1", session_id: "p2", staff_id: "b1", status: "accepted" },
    { id: "z1", session_id: "p3", staff_id: "b1", status: "accepted" },
  ];
  db.assignment_mileage = [{ assignment_id: "x1", session_id: "p1", staff_id: "b1", one_way_miles: 50, miles_source: "driving", locked_at: new Date().toISOString() }];
  db.time_punches = [
    punch("i1", "x1", "b1", "p1", "in", at(day1, 16 * 60)),
    punch("o1", "x1", "b1", "p1", "out", at(day1, 23 * 60 + 40)), // 460 min
    punch("i2", "x2", "b2", "p1", "in", at(day1, 16 * 60)), // never clocked out
    punch("i3", "y1", "b1", "p2", "in", at(day2, 8 * 60)),
    punch("o3", "y1", "b1", "p2", "out", at(day2, 24 * 60)), // 960 min
    punch("i4", "z1", "b1", "p3", "in", at(day3, 7 * 60)),
    punch("o4", "z1", "b1", "p3", "out", at(day3, 24 * 60)), // 1020 min: 2440 for the week
  ];
  db.time_approvals = [];
  db.time_edits = [];
  db.time_reopens = [];
  db.team_hidden_events = [];
  db.team_settings = [];
  db.payroll_paid = [];
  db.payroll_reimbursements = [];
  db.event_ice_pickup_people = [];
  db.event_menu_pickups = [];
  db.event_finance = [];
  db.event_other_costs = [];
  db.event_payments = [];
  db.supply_catalog = [];
  db.staff_sessions = [];
}
reset();

let view = (await payrollDb.payrollView(admin as never, period))!;
check("The page loads for an admin", view !== null && view.ready && view.period.from === period.from);
check("One card per person who worked, sorted by name", view.people.map((p) => p.name).join() === "Avery Diaz,Jordan Lee", view.people.map((p) => p.name).join());
const jordan = () => view.people.find((p) => p.staffId === "b1")!;
const j1Line = () => jordan().lines.find((l) => l.sessionId === "p1")!;
const avery = () => view.people.find((p) => p.staffId === "b2")!;
check("Name, role and rate on the line", jordan().role === "Bartender" && j1Line().rateCents === 3000 && j1Line().rateSource === "package" && avery().lines[0].rateCents === 2500 && avery().lines[0].rateSource === "own");
check("One line per event, by date", jordan().lines.map((l) => l.sessionId).join() === "p1,p2,p3");
const j1 = () => jordan().lines.find((l) => l.sessionId === "p1")!;
check("The event title is the admin format", j1().eventTitle === "Justin Reyes · Birthday" && jordan().lines[1].eventTitle === "Maria Chen · Wedding", j1().eventTitle);
check("Clock in, clock out and hours on the line", j1().clockIn === at(day1, 960) && j1().clockOut === at(day1, 23 * 60 + 40) && j1().minutes === 460);

// Totals match the Payout card for the same event.
const card = (await payoutDb.payoutSheet(admin as never, db.sessions[0] as never))!;
const cardRow = card.rows.find((r) => r.staffId === "b1")!;
check(
  "A line matches the Payout card row for the same event",
  j1().totalCents === cardRow.totalCents && j1().wagesCents === cardRow.actualPayCents && j1().mileageCents === cardRow.mileageCents && j1().mileageMiles === cardRow.mileageMiles && j1().tipsCents === cardRow.tipsCents,
  JSON.stringify({ line: j1().totalCents, card: cardRow.totalCents })
);
check("Wages, mileage and tips are separate numbers", j1().wagesCents === 23000 && j1().mileageCents === 2400 && j1().tipsCents === 10000 && j1().totalCents === 35400, JSON.stringify(j1()));
const p1Lines = view.people.flatMap((p) => p.lines).filter((l) => l.sessionId === "p1");
check("The event's lines add up to the Payout card total", p1Lines.reduce((s, l) => s + l.totalCents, 0) === card.totals.totalCents);
const jt = jordan().totals;
check("Person totals: hours, wages, mileage, tips, total", jt.minutes === 2440 && jt.mileageCents === 2400 && jt.tipsCents === 50000 && jt.wagesCents === jt.totalCents - 2400 - 50000 && jt.unpaidCents === jt.totalCents && jt.paidCents === 0, JSON.stringify(jt));
check("Summary: owed, paid, unpaid, people", view.summary.owedCents === jt.totalCents + avery().totals.totalCents && view.summary.paidCents === 0 && view.summary.unpaidCents === view.summary.owedCents && view.summary.people === 2);

// The sheet: one row per event in date order, everyone on it.
check("One row per event, in date order", view.events.map((e) => e.sessionId).join() === "p1,p2,p3");
const e1 = () => view.events.find((e) => e.sessionId === "p1")!;
check("The event row has the date, the client in the admin format, the package and the venue", e1().day === day1 && e1().title === "Justin Reyes · Birthday" && e1().packageName === "Full Bar" && e1().venue === "1 Elm St, Dallas, TX");
check("Each person on the event, bartenders first then by name", e1().lines.map((l) => l.name).join() === "Avery Diaz,Jordan Lee");
check("Event total to bartenders, revenue, pay percent and profit before supplies", e1().toStaffCents === card.totals.totalCents && e1().revenueCents === 180000 && e1().payPct === Math.round((card.totals.totalCents / 180000) * 1000) / 10 && e1().profitBeforeSuppliesCents === 180000 - card.totals.totalCents, JSON.stringify({ to: e1().toStaffCents, pct: e1().payPct }));
check("Gratuity on the event is what went to the bartenders", e1().gratuityCents === 20000);
check("Up to four people per event lay out side by side; the phone gets stacked cards", payroll.SHEET_PEOPLE === 4 && src("app/team/admin/payroll/payroll-board.tsx").includes("md:hidden") && src("app/team/admin/payroll/payroll-board.tsx").includes("function EventCard"));
check("The week footer: total to bartenders, one Pay Out row per person", view.summary.owedCents === view.events.reduce((n, e) => n + e.toStaffCents, 0) && src("app/team/admin/payroll/payroll-board.tsx").includes("Total to bartenders {money(view.summary.owedCents)}"));
check("Pay Out row: events, hours, wages, gas, reimbursements, gratuity, total, paid, unpaid", jt.events === 3 && jt.reimbursementsCents === 0 && avery().totals.events === 1);
check("Gratuity splits evenly on the event, whatever the hours or rate", j1Line().tipsCents === 10000 && avery().lines[0].tipsCents === 10000 && j1Line().minutes !== avery().lines[0].minutes && j1Line().rateCents !== avery().lines[0].rateCents);

// The rate rule, in all four places, on a Tailored event (p3).
const tailored = db.sessions.find((x) => x.id === "p3")!;
const j3 = jordan().lines.find((l) => l.sessionId === "p3")!;
check("Payroll: Tailored pays $25 with no own rate, and says so", j3.rateCents === 2500 && j3.rateSource === "package" && payroll.lineRateText(j3) === "Tailored rate" && j3.wagesCents === 42500, JSON.stringify({ r: j3.rateCents, w: j3.wagesCents }));
const card3 = (await payoutDb.payoutSheet(admin as never, tailored as never))!;
check("Payout card: the same $25 Tailored rate", card3.rows[0].rateCents === 2500 && card3.rows[0].rateSource === "package" && card3.rows[0].actualPayCents === 42500);
const myEst = await payDb.myPayEstimate("b1", tailored as never);
check("Staff pay estimate: $25 on Tailored", myEst.rateCents === 2500 && myEst.rateSource === "package" && myEst.hourlyCents === 17500 && (await payDb.myEstimate("b1", tailored as never)) === "$175.00", JSON.stringify(myEst));
const biz3 = (await bizDb.eventBusinessFor(admin as never, tailored as never))!;
check("Business labor: the crew at $25 on Tailored", biz3.business.costs.find((c) => c.key === "labor")!.cents === 42500, JSON.stringify(biz3.business.costs.find((c) => c.key === "labor")));
db.sessions.push(event("t0", addDays(today, 20), "1 Elm St, Dallas, TX", { package: "Tailored Bar" }, { team_market: "dallas", package_type: "Tailored Bar", booked_price: { total: 900, gratuity: 0, bartenders: 1 } }));
const biz0 = (await bizDb.eventBusinessFor(admin as never, db.sessions.at(-1) as never))!;
const labor0 = biz0.business.costs.find((c) => c.key === "labor")!;
check("Business labor before anyone accepts: the package rate", labor0.cents === 17500 && labor0.note.includes("$25.00/hr package rate"), JSON.stringify(labor0));
db.sessions.pop();
db.staff_pay_rates.push({ staff_id: "b1", hourly_rate_cents: 3500 });
check("An own rate overrides the package rule everywhere", (await payDb.myPayEstimate("b1", tailored as never)).rateCents === 3500 && (await payoutDb.payoutSheet(admin as never, tailored as never))!.rows[0].rateSource === "own" && (await bizDb.eventBusinessFor(admin as never, tailored as never))!.business.costs.find((c) => c.key === "labor")!.cents === 59500);
db.staff_pay_rates = db.staff_pay_rates.filter((r) => r.staff_id !== "b1");
db.team_settings.push({ key: "business_pay_rates", value: { ...pay.PACKAGE_RATE_DEFAULTS, tailored: 2650 } });
check("A changed package rate in settings flows through", (await payDb.myPayEstimate("b1", tailored as never)).rateCents === 2650 && (await payoutDb.payoutSheet(admin as never, tailored as never))!.rows[0].rateCents === 2650);
db.team_settings = [];
const rates = await payDb.rowRates(admin as never, [{ assignmentId: "z1", staffId: "b1", sessionId: "p3" }, { assignmentId: "x1", staffId: "b1", sessionId: "p1" }]);
check("The Time page uses the same rule, per event", rates.get("z1") === 2500 && rates.get("x1") === 3000);

// 40 hours.
check("40 hour flag: 40.67 hours in the week shows 0.67 over", jordan().over40.length === 1 && jordan().over40[0].minutes === 2440 && jordan().over40[0].overMinutes === 40 && jordan().over40[0].week === period.from);
check("Under 40 is not flagged", avery().over40.length === 0);
check("The flag text gives the hours over 40", payroll.overText(jordan().over40[0]).includes("0.67 h over 40"));
check("No overtime pay is figured", !/1\.5|overtime ?pay ?=|\* ?1\.5/i.test(src("lib/team/payroll.ts")));

// A line with no clock out cannot be marked paid.
const a1 = avery().lines[0];
check("No clock out: not payable, needs attention", !a1.payable && a1.problem === "no_clock_out" && a1.fromEstimate && a1.attention);
check("The summary counts lines that need attention", view.summary.attention === 1);
const refused = await payrollDb.markPaid(admin as never, { assignmentId: "x2" });
check("A line with no clock out cannot be marked paid", !refused.ok && refused.status === 400 && refused.error.startsWith("Fix hours first"), JSON.stringify(refused));
check("Nothing was recorded for it", db.payroll_paid.length === 0);
check("The board links Fix hours first to that event's Time page", src("app/team/admin/payroll/payroll-board.tsx").includes("/team/admin/timesheets?week=${weekStart(") && src("app/team/admin/payroll/payroll-board.tsx").includes("&event=${encodeURIComponent(l.sessionId)}"));

// Mark one line.
const now = new Date();
const marked = await payrollDb.markPaid(admin as never, { assignmentId: "x1", note: "  Gusto run   Nov 20 " }, now);
check("Mark one line paid", marked.ok && db.payroll_paid.length === 1, JSON.stringify(marked));
const rec = db.payroll_paid[0];
check("Records who, when, the pay date (today by default) and the note", rec.marked_by === "a1" && rec.marked_by_name === "Kenneth Smith" && rec.marked_at === now.toISOString() && rec.paid_on === today && rec.note === "Gusto run Nov 20");
check("Saves a snapshot of hours, wages, mileage, tips and total", rec.minutes === 460 && rec.wages_cents === 23000 && rec.mileage_miles === 80 && rec.mileage_cents === 2400 && rec.tips_cents === 10000 && rec.total_cents === 35400, JSON.stringify(rec));
check("Marking the same line twice is refused", ((await payrollDb.markPaid(admin as never, { assignmentId: "x1" })) as { status?: number }).status === 409 && db.payroll_paid.length === 1);
check("A bad pay date is refused", ((await payrollDb.markPaid(admin as never, { assignmentId: "y1", paidOn: "2026-02-30" })) as { ok: boolean }).ok === false);
view = (await payrollDb.payrollView(admin as never, period))!;
check("The line shows paid, with no warning", !!j1().paid && j1().paid!.paidOn === today && j1().changed === null && !j1().attention);
check("Paid and unpaid totals move", jordan().totals.paidCents === 35400 && jordan().totals.unpaidCents === jordan().totals.totalCents - 35400 && view.summary.paidCents === 35400);

// Mark all for a person.
const all = await payrollDb.markAllPaid(admin as never, { staffId: "b1", period, paidOn: "2026-11-20", note: "Gusto run Nov 20" }, now);
check("Mark all paid marks every payable line left for the person", all.ok && (all as { marked: number }).marked === 2 && db.payroll_paid.length === 3, JSON.stringify(all));
check("Mark all uses the pay date and note given", db.payroll_paid.filter((r) => r.assignment_id !== "x1").every((r) => r.paid_on === "2026-11-20" && r.note === "Gusto run Nov 20"));
const none = await payrollDb.markAllPaid(admin as never, { staffId: "b2", period }, now);
check("Mark all with only lines to fix marks nothing", !none.ok && db.payroll_paid.length === 3);
view = (await payrollDb.payrollView(admin as never, period))!;
check("Every Jordan line is paid; unpaid is zero", jordan().lines.every((l) => l.paid) && jordan().totals.unpaidCents === 0 && jordan().payableUnpaid === 0);
check("Filters: unpaid only, paid only, needs attention", payroll.filterPeople(view.people, "unpaid").map((p) => p.staffId).join() === "b2" && payroll.filterPeople(view.people, "paid").map((p) => p.staffId).join() === "b1" && payroll.filterPeople(view.people, "attention").flatMap((p) => p.lines).length === 1);

// Undo.
const undone = await payrollDb.undoPaid(admin as never, { assignmentId: "x1" }, now);
const old = db.payroll_paid.find((r) => r.assignment_id === "x1")!;
check("Undo paid records who and when, and keeps the row", undone.ok && old.undone_by === "a1" && old.undone_by_name === "Kenneth Smith" && old.undone_at === now.toISOString() && db.payroll_paid.length === 3);
view = (await payrollDb.payrollView(admin as never, period))!;
check("After undo the line is unpaid again", j1().paid === null && jordan().payableUnpaid === 1);
check("Undo twice says it is not marked paid", ((await payrollDb.undoPaid(admin as never, { assignmentId: "x1" })) as { status?: number }).status === 404);
check("The board asks before undoing", src("app/team/admin/payroll/payroll-board.tsx").includes("window.confirm(`Undo paid for"));
check("It can be marked paid again after undo", (await payrollDb.markPaid(admin as never, { assignmentId: "x1" }, now)).ok && db.payroll_paid.filter((r) => r.assignment_id === "x1").length === 2);

// Changed after it was marked paid.
db.staff_pay_rates.push({ staff_id: "b1", hourly_rate_cents: 3500 });
view = (await payrollDb.payrollView(admin as never, period))!;
const ch = j1().changed;
check("A rate change after paid shows the warning", ch !== null && ch.paidCents === 35400 && ch.currentCents === j1().totalCents && ch.diffCents === j1().totalCents - 35400 && j1().attention, JSON.stringify(ch));
check("The warning text gives paid, now and the difference", payroll.changedText(ch!) === `Paid $354.00, now $392.33, $38.33 more.`, payroll.changedText(ch!));
check("A drop says less, never a minus sign", payroll.changedText({ paidCents: 1000, currentCents: 400, diffCents: -600 }) === "Paid $10.00, now $4.00, $6.00 less.");
db.staff_pay_rates = db.staff_pay_rates.filter((r) => r.staff_id !== "b1");
db.time_punches = db.time_punches.filter((p) => p.id !== "o3"); // a paid line loses its clock out
view = (await payrollDb.payrollView(admin as never, period))!;
const j2 = jordan().lines.find((l) => l.sessionId === "p2")!;
check("A timesheet change after paid shows the warning too", j2.changed !== null && !j2.payable && j1().changed === null);
check("The board says Changed after it was marked paid", src("app/team/admin/payroll/payroll-board.tsx").includes("Changed after it was marked paid."));
reset();

// ----- Admins only -----
check("A manager gets no payroll view", (await payrollDb.payrollView(mgr as never, period)) === null);
const mm = await payrollDb.markPaid(mgr as never, { assignmentId: "x1" });
const ma = await payrollDb.markAllPaid(mgr as never, { staffId: "b1", period });
const mu = await payrollDb.undoPaid(mgr as never, { assignmentId: "x1" });
check("Managers refused on every action (403)", [mm, ma, mu].every((r) => !r.ok && r.status === 403) && db.payroll_paid.length === 0);
check("A bartender is refused too", ((await payrollDb.markPaid(b1 as never, { assignmentId: "x1" })) as { status?: number }).status === 403);

const signIn = (staffId: string, token: string) => {
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
};
const postReq = (body: unknown) => new Request("https://plan.test/api/team/admin/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const getReq = (kind: string) => new Request(`https://plan.test/api/team/admin/payroll/export?kind=${kind}&from=${period.from}&to=${period.to}`);
signIn("m1", "mgr-token");
const mPost = await Promise.all(
  [
    { action: "mark", assignmentId: "x1" },
    { action: "mark_all", staffId: "b1", from: period.from, to: period.to },
    { action: "mark_week", from: period.from, to: period.to },
    { action: "undo", assignmentId: "x1" },
    { action: "add_reimbursement", assignmentId: "x1", kind: "ice", amount: "20" },
  ].map((b) => route.POST(postReq(b)))
);
check("A manager gets 403 from the actions route", mPost.every((r) => r.status === 403) && db.payroll_paid.length === 0 && db.payroll_reimbursements.length === 0);
const mGet = await Promise.all(["lines", "people", "sheet"].map((k) => exportRoute.GET(getReq(k))));
check("A manager gets 403 from every export", mGet.every((r) => r.status === 403));
let to = "";
try {
  await auth.requireFullAdmin(payroll.PAYROLL_PATH);
} catch (e) {
  to = e instanceof stub.RedirectError ? e.to : String(e);
}
check("The page sends a manager away before anything loads", to === "/team/admin/events" && src("app/team/admin/payroll/page.tsx").includes("await requireFullAdmin(PAYROLL_PATH)"));
stub.stubCookies.clear();
check("Signed out: 401", (await route.POST(postReq({ action: "mark", assignmentId: "x1" }))).status === 401 && (await exportRoute.GET(getReq("lines"))).status === 401);

signIn("a1", "admin-token");
const aPost = await route.POST(postReq({ action: "mark", assignmentId: "x1", paidOn: today }));
check("An admin can mark paid through the route", aPost.status === 200 && db.payroll_paid.length === 1);
const aAll = await route.POST(postReq({ action: "mark_all", staffId: "b1", from: period.from, to: period.to }));
check("An admin can mark all through the route", aAll.status === 200 && db.payroll_paid.length === 3);
const linesRes = await exportRoute.GET(getReq("lines"));
const linesCsv = (await linesRes.text()).trim().split("\r\n");
check("Lines CSV: the columns asked for", linesRes.status === 200 && linesCsv[0] === "Person,Role,Rate,Rate from,Event date,Event,Clock in,Clock out,Hours,Wages,Mileage miles,Mileage pay,Tips,Reimbursements,Line total,Paid,Pay date,Marked by,Note", linesCsv[0]);
check("Lines CSV: one row per line", linesCsv.length === 1 + 4);
const jRow = linesCsv.find((l) => l.startsWith("Jordan Lee") && l.includes(day1))!;
check("Lines CSV row: rate from, hours, wages, mileage, tips, reimbursements, total, paid, pay date, marked by", jRow.includes(",30.00,Full Bar rate,") && jRow.includes(",7.67,230.00,80,24.00,100.00,0.00,354.00,Yes,") && jRow.includes("Kenneth Smith"), jRow);
const aRow = linesCsv.find((l) => l.startsWith("Avery Diaz"))!;
check("Lines CSV: a line with no clock out says fix hours first", aRow.includes(",No, fix hours first,") || aRow.includes(',"No, fix hours first",'), aRow);
const peopleRes = await exportRoute.GET(getReq("people"));
const peopleCsv = (await peopleRes.text()).trim().split("\r\n");
check("People CSV: the Pay Out table, one row per person with paid and unpaid", peopleRes.status === 200 && peopleCsv[0] === "Person,Role,Events,Hours,Wages,Mileage pay,Reimbursements,Tips,Total,Paid,Unpaid" && peopleCsv.length === 3, peopleCsv.join(" | "));
const jPeople = peopleCsv.find((l) => l.startsWith("Jordan Lee"))!.split(",");
check("People CSV: Jordan fully paid", jPeople[2] === "3" && jPeople[3] === "40.67" && jPeople[10] === "0.00" && jPeople[9] === jPeople[8], jPeople.join());
// The payout sheet CSV, in the Google Sheet's column order.
const sheetRes = await exportRoute.GET(getReq("sheet"));
const sheetCsv = (await sheetRes.text()).trim().split("\r\n");
check(
  "Payout sheet CSV: the sheet's columns, in its order",
  sheetRes.status === 200 &&
    sheetCsv[0] ===
      "Event Date,Event Name,Revenue Per Deal,Venue / Location,Package,Gas,Gas (2nd Bart),Gas (3rd Bart),Reimbursements,Reimbursements (2nd Bart),Reimbursements (3rd Bart),Hours,Hours 2nd Bar,Hours 3rd Bar,Hourly,Hourly 2 Bartndr,Hourly 3 Bartndr,Total Hrly $,Total Hrly $ 2nd Bart.,Total Hrly $ 3rd Bart.,CC Grat.,Bartender 1 Amount,Bartender,Bartender 2 Amount,2nd Bartender,Bartender 3 Amount,3rd Bartender,Total to Bartenders,Bartender Pay % of Revenue,Profit before supplies,Estimated Supplies Cost,Estimated Gross Profit,Notes",
  sheetCsv[0]
);
check("Payout sheet CSV: one row per event, by date", sheetCsv.length === 1 + 3 && sheetCsv[1].startsWith(`${day1},Justin Reyes · Birthday,1800.00,"1 Elm St, Dallas, TX",Full Bar,`) && sheetCsv[3].includes(",Tailored Bar,"), sheetCsv.slice(1).join(" | "));
const s1 = sheetCsv[1].replace('"1 Elm St, Dallas, TX"', "VENUE").split(",");
const col = (name: string) => s1[payroll.SHEET_CSV_COLUMNS.indexOf(name as never)];
check(
  "Payout sheet CSV: each person's gas, hours, hourly, total hourly and amount in their columns",
  col("Gas") === "0.00" && col("Gas (2nd Bart)") === "24.00" && col("Gas (3rd Bart)") === "" && col("Hours") === "7.00" && col("Hours 2nd Bar") === "7.67" && col("Hourly") === "25.00" && col("Hourly 2 Bartndr") === "30.00" && col("Total Hrly $ 2nd Bart.") === "230.00" && col("Bartender") === "Avery Diaz" && col("2nd Bartender") === "Jordan Lee" && col("Bartender 2 Amount") === "354.00" && col("CC Grat.") === "200.00",
  s1.join("|")
);
const sheetTotal = 17500 + 10000 + 35400;
check("Payout sheet CSV: total to bartenders, pay percent, profit before supplies", col("Total to Bartenders") === (sheetTotal / 100).toFixed(2) && col("Bartender Pay % of Revenue") === `${(Math.round((sheetTotal / 180000) * 1000) / 10).toFixed(1)}%` && col("Profit before supplies") === ((180000 - sheetTotal) / 100).toFixed(2), s1.join("|"));
check("Payout sheet CSV notes say whose hours are estimates and who has an own rate", sheetCsv[1].endsWith(`"Avery Diaz: estimated hours, no clock out; Avery Diaz: own rate $25.00/hr"`), sheetCsv[1]);
check("A bad export kind or range is refused", (await exportRoute.GET(new Request(`https://plan.test/api/team/admin/payroll/export?kind=x&from=${period.from}&to=${period.to}`))).status === 400 && (await exportRoute.GET(new Request("https://plan.test/api/team/admin/payroll/export?kind=lines&from=2026-12-01&to=2026-11-01"))).status === 400);

// ----- Staff see only their own paid status -----
db.payroll_paid.push({ id: "other", assignment_id: "x2", session_id: "p1", staff_id: "b2", paid_on: "2026-11-21", note: "secret", minutes: 1, wages_cents: 1, mileage_miles: 0, mileage_cents: 0, tips_cents: null, total_cents: 1, marked_at: now.toISOString() });
const mine = await payrollDb.myPaidDates("b1", ["p1", "p2", "p3"]);
check("A staff member sees their own pay dates", mine.get("p1") === today && mine.get("p2") === today && mine.size === 3);
const theirs = await payrollDb.myPaidDates("b2", ["p1", "p2", "p3"]);
check("Another person on the same event sees only theirs", theirs.size === 1 && theirs.get("p1") === "2026-11-21");
await payrollDb.undoPaid(admin as never, { assignmentId: "z1" });
check("An undone mark reads as not paid yet", !(await payrollDb.myPaidDates("b1", ["p3"])).has("p3"));
const payPage = src("app/team/pay/page.tsx");
check("The staff pay page asks only for the signed in person's dates", payPage.includes("myPaidDates(staff.id, rows.map((r) => r.sessionId))"));
check("The staff pay page says Paid with the date, or Not paid yet", payPage.includes("`Paid ${shortDate(paidDates.get(r.sessionId)!)}`") && payPage.includes('"Not paid yet"'));
check("Staff get the pay date only: no amounts, notes or snapshots", src("lib/team/payroll-db.ts").includes('.select("session_id, paid_on").eq("staff_id", staffId)') && (payPage.match(/payroll/g) ?? []).length === 1 && !/changed|snapshot|markedBy|paid\.note/i.test(payPage));

// ----- Before the migration runs -----
const realFrom = supabase.from;
const missing = { data: null, error: { message: 'relation "public.payroll_paid" does not exist' } };
const broken: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(missing).then(ok) : () => broken) });
(supabase as { from: unknown }).from = (t: string) => (t === "payroll_paid" ? broken : realFrom(t));
const before = (await payrollDb.payrollView(admin as never, period))!;
check("Before the migration the page still loads, everything unpaid", before !== null && !before.ready && before.people.length === 2 && before.people.every((p) => p.lines.every((l) => !l.paid)) && before.summary.paidCents === 0);
const nr = await payrollDb.markPaid(admin as never, { assignmentId: "x1" });
check("Before the migration marking paid says to run it", !nr.ok && nr.status === 503 && nr.error === payroll.NOT_READY_MESSAGE);
check("Before the migration staff see Not paid yet", (await payrollDb.myPaidDates("b1", ["p1"])).size === 0);
(supabase as { from: unknown }).from = realFrom;
check("The reimbursements migration is there: the table, and the snapshot column", src("supabase/migrations/20261219_payroll_reimbursements.sql").includes("create table if not exists public.payroll_reimbursements") && src("supabase/migrations/20261219_payroll_reimbursements.sql").includes("add column if not exists reimbursements_cents"));
check("The migration file is there and makes payroll_paid", src("supabase/migrations/20261218_payroll_paid.sql").includes("create table if not exists public.payroll_paid") && src("supabase/migrations/20261218_payroll_paid.sql").includes("where undone_at is null"));

// ----- Reimbursements -----
reset();
db.team_settings.push({ key: "business_supplies_per_guest", value: { full: 300, legacy: 300 } }); // so profit is worked out
const costOf = (v: { business: { costs: { key: string; cents: number | null }[]; costCents: number } }, k: string) => v.business.costs.find((c) => c.key === k)!.cents;
const p1s = () => db.sessions.find((x) => x.id === "p1")! as never;
const bizBefore = (await bizDb.eventBusinessFor(admin as never, p1s()))!;
check("Business shows Reimbursed to staff as its own line, none yet", costOf(bizBefore, "reimbursed") === 0 && bizBefore.business.costs.find((c) => c.key === "reimbursed")!.label === "Reimbursed to staff");
check("Only Ice, Menu printing or Other", !(await reimbDb.addReimbursement(admin as never, { assignmentId: "x1", kind: "gas", amount: "20" })).ok && !(await reimbDb.addReimbursement(admin as never, { assignmentId: "x1", kind: "ice", amount: "abc" })).ok && !(await reimbDb.addReimbursement(admin as never, { assignmentId: "x1", kind: "ice", amount: "0" })).ok);
check("Managers and bartenders cannot add one", (await reimbDb.addReimbursement(mgr as never, { assignmentId: "x1", kind: "ice", amount: "24" })).ok === false && (await reimbDb.addReimbursement(b1 as never, { assignmentId: "x1", kind: "ice", amount: "24" })).ok === false && db.payroll_reimbursements.length === 0);

// The pickup prompt.
db.event_ice_pickup_people.push({ id: "ip1", session_id: "p1", staff_id: "b1", picked_up_at: new Date().toISOString(), covered_by: null });
db.event_menu_pickups.push({ session_id: "p1", assignee_id: "b1", picked_up_at: new Date().toISOString(), not_needed: false });
view = (await payrollDb.payrollView(admin as never, period))!;
check("Picked up the ice and the menus, nothing entered: both prompts on that line", j1Line().prompts.join() === "ice,menu_printing" && avery().lines[0].prompts.length === 0, JSON.stringify(j1Line().prompts));
check("The prompt reads as asked", reimb.PICKUP_PROMPT.ice === "Picked up the ice. Add a reimbursement?");
db.event_ice_pickup_people[0].covered_by = "b2";
view = (await payrollDb.payrollView(admin as never, period))!;
check("Ice covered by someone else: the prompt moves to them", avery().lines[0].prompts.join() === "ice" && j1Line().prompts.join() === "menu_printing");
db.event_ice_pickup_people[0].covered_by = null;

const added = await reimbDb.addReimbursement(admin as never, { assignmentId: "x1", kind: "ice", amount: "24", note: " Kroger  receipt " });
check("An admin adds a reimbursement with a type, amount and note", added.ok && db.payroll_reimbursements.length === 1 && db.payroll_reimbursements[0].amount_cents === 2400 && db.payroll_reimbursements[0].note === "Kroger receipt" && db.payroll_reimbursements[0].staff_id === "b1" && db.payroll_reimbursements[0].session_id === "p1");
check("More than one line for a person", (await reimbDb.addReimbursement(admin as never, { assignmentId: "x1", kind: "other", amount: "6.50" })).ok && db.payroll_reimbursements.length === 2);
view = (await payrollDb.payrollView(admin as never, period))!;
check("Reimbursements add to the amount, in their own column, not wages", j1Line().reimbursementsCents === 3050 && j1Line().wagesCents === 23000 && j1Line().totalCents === 35400 + 3050, JSON.stringify({ r: j1Line().reimbursementsCents, w: j1Line().wagesCents, t: j1Line().totalCents }));
check("Entering the ice reimbursement clears the ice prompt only", j1Line().prompts.join() === "menu_printing");
check("Reimbursements in the Pay Out row and the week total", jordan().totals.reimbursementsCents === 3050 && view.summary.owedCents === view.people.reduce((n, p) => n + p.totals.totalCents, 0) && e1().toStaffCents === 17500 + 10000 + 35400 + 3050);
const cardR = (await payoutDb.payoutSheet(admin as never, p1s()))!;
check("The Payout card adds them too", cardR.rows.find((r) => r.staffId === "b1")!.totalCents === 38450 && cardR.totals.reimbursementsCents === 3050);
const bizAfter = (await bizDb.eventBusinessFor(admin as never, p1s()))!;
check("Business: Reimbursed to staff, counted once in costs and profit", costOf(bizAfter, "reimbursed") === 3050 && bizAfter.business.costCents === bizBefore.business.costCents + 3050 && bizAfter.business.profitCents === bizBefore.business.profitCents! - 3050, JSON.stringify({ before: bizBefore.business.costCents, after: bizAfter.business.costCents }));
check("Reimbursements are not labor, so no payroll burden on them", costOf(bizAfter, "labor") === costOf(bizBefore, "labor") && costOf(bizAfter, "burden") === costOf(bizBefore, "burden"));
db.event_other_costs.push({ id: "oc1", session_id: "p1", label: "Ice", cents: 2400, created_at: "2026-01-01" }, { id: "oc2", session_id: "p1", label: "Glass rental", cents: 650, created_at: "2026-01-02" });
const bizOther = (await bizDb.eventBusinessFor(admin as never, p1s()))!;
check("An other cost for the same ice is not counted twice", costOf(bizOther, "other") === 650 && costOf(bizOther, "reimbursed") === 3050 && bizOther.business.costCents === bizAfter.business.costCents + 650 && bizOther.business.costs.find((c) => c.key === "other")!.note.includes("not counted twice"), JSON.stringify(bizOther.business.costs.find((c) => c.key === "other")));
db.event_other_costs = [];
check("The pure rule: matched by what it is and the amount", reimb.otherCostsCovered([{ id: "a", label: "Menu printing", cents: 1200 }, { id: "b", label: "Ice", cents: 999 }], [{ kind: "menu_printing", cents: 1200 }, { kind: "ice", cents: 1000 }]).size === 1);

const r1 = String(db.payroll_reimbursements[1].id);
check("Editable before paid", (await reimbDb.editReimbursement(admin as never, { id: r1, kind: "other", amount: "7", note: "Parking" })).ok && db.payroll_reimbursements[1].amount_cents === 700 && db.payroll_reimbursements[1].note === "Parking");
check("Removable before paid", (await reimbDb.removeReimbursement(admin as never, { id: r1 })).ok && db.payroll_reimbursements.length === 1);
check("A manager cannot edit or remove", !(await reimbDb.editReimbursement(mgr as never, { id: String(db.payroll_reimbursements[0].id), kind: "ice", amount: "1" })).ok && !(await reimbDb.removeReimbursement(mgr as never, { id: String(db.payroll_reimbursements[0].id) })).ok);

// Marked paid: the snapshot carries them, and they lock.
check("Marking paid still needs clocked hours", !(await payrollDb.markPaid(admin as never, { assignmentId: "x2" })).ok);
check("Mark paid", (await payrollDb.markPaid(admin as never, { assignmentId: "x1", paidOn: period.payDate }, now)).ok);
const snap = db.payroll_paid[0];
check("The snapshot carries the reimbursements and the total with them", snap.reimbursements_cents === 2400 && snap.total_cents === 35400 + 2400 && snap.wages_cents === 23000, JSON.stringify(snap));
const rid = String(db.payroll_reimbursements[0].id);
const locked = [await reimbDb.editReimbursement(admin as never, { id: rid, kind: "ice", amount: "30" }), await reimbDb.removeReimbursement(admin as never, { id: rid }), await reimbDb.addReimbursement(admin as never, { assignmentId: "x1", kind: "other", amount: "5" })];
check("Once paid, its reimbursements cannot be added, changed or removed", locked.every((r) => !r.ok && (r as { status: number }).status === 409) && db.payroll_reimbursements.length === 1 && db.payroll_reimbursements[0].amount_cents === 2400);
view = (await payrollDb.payrollView(admin as never, period))!;
check("Paid with reimbursements: no changed warning", j1Line().changed === null && !!j1Line().paid);
db.payroll_reimbursements[0].amount_cents = 3000; // changed underneath, say by hand in the database
view = (await payrollDb.payrollView(admin as never, period))!;
check("A reimbursement change after paid shows the warning", j1Line().changed !== null && j1Line().changed!.diffCents === 600);
db.payroll_reimbursements[0].amount_cents = 2400;
check("Undo paid unlocks them again", (await payrollDb.undoPaid(admin as never, { assignmentId: "x1" }, now)).ok && (await reimbDb.editReimbursement(admin as never, { id: rid, kind: "ice", amount: "25" })).ok);

// Exports carry them.
view = (await payrollDb.payrollView(admin as never, period))!;
check("Lines, Pay Out and payout sheet CSVs carry reimbursements", payroll.linesCsv(view).includes(",25.00,379.00,") && payroll.peopleCsv(view).split("\r\n").find((l) => l.startsWith("Jordan Lee"))!.includes(",25.00,") && payroll.payoutSheetCsv(view).split("\r\n")[1].replace('"1 Elm St, Dallas, TX"', "V").split(",")[payroll.SHEET_CSV_COLUMNS.indexOf("Reimbursements (2nd Bart)")] === "25.00", payroll.payoutSheetCsv(view).split("\r\n")[1]);
check("The sheet shows the supplies estimate and gross profit once one is set", view.events[0].suppliesCents === 300 * 80 && view.events[0].grossProfitCents === view.events[0].profitBeforeSuppliesCents! - 24000);

// Staff see only their own reimbursements and gratuity.
const minePay = await payDb.myPayRows("b1", period.from, period.to);
const mp1 = minePay.rows.find((r) => r.sessionId === "p1")!;
check("Staff see their own reimbursements and gratuity", mp1.reimbursements.length === 1 && mp1.reimbursements[0].label === "Ice" && mp1.reimbursements[0].cents === 2500 && mp1.tipsCents === 10000, JSON.stringify(mp1));
check("Staff see their own rate on each event: Tailored at $25", minePay.rows.find((r) => r.sessionId === "p3")!.rateCents === 2500 && minePay.rows.find((r) => r.sessionId === "p1")!.rateCents === 3000);
const theirPay = await payDb.myPayRows("b2", period.from, period.to);
check("Nothing about anyone else", theirPay.rows.length === 1 && theirPay.rows[0].reimbursements.length === 0 && theirPay.rows[0].tipsCents === 10000);
check("Staff reimbursements are read by their own id only", src("lib/team/reimbursements-db.ts").includes('.eq("staff_id", staffId).in("session_id"') && src("lib/team/pay-db.ts").includes("myReimbursements(staffId, ids)"));
check("The staff pay page shows them", src("app/team/pay/page.tsx").includes("Your gratuity") && src("app/team/pay/page.tsx").includes("Reimbursed"));

// ----- Mark the week paid -----
reset();
db.sessions.push(event("nextMon", period.payDate!, "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: { total: 500, gratuity: 0 } }));
db.event_assignments.push({ id: "nm1", session_id: "nextMon", staff_id: "b1", status: "accepted" });
db.time_punches.push(punch("i9", "nm1", "b1", "nextMon", "in", at(period.payDate!, 16 * 60)), punch("o9", "nm1", "b1", "nextMon", "out", at(period.payDate!, 22 * 60)));
db.sessions.push(event("sun", period.to, "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: { total: 500, gratuity: 0 } }));
db.event_assignments.push({ id: "su1", session_id: "sun", staff_id: "b2", status: "accepted" });
db.time_punches.push(punch("i8", "su1", "b2", "sun", "in", at(period.to, 16 * 60)), punch("o8", "su1", "b2", "sun", "out", at(period.to, 22 * 60)));
view = (await payrollDb.payrollView(admin as never, period))!;
check("The Sunday event is in the week, the next Monday's is not", view.events.some((e) => e.sessionId === "sun") && !view.events.some((e) => e.sessionId === "nextMon") && view.events.at(-1)!.sessionId === "sun");
check("Mark the week paid counts what it would mark", view.summary.payableUnpaid === 4);
check("Mark the week paid needs a pay week", !(await payrollDb.markWeekPaid(admin as never, { period: payroll.rangePeriod(period.from, addDays(period.to, -1))! })).ok && db.payroll_paid.length === 0);
check("A manager cannot mark the week paid", (await payrollDb.markWeekPaid(mgr as never, { period })).ok === false && db.payroll_paid.length === 0);
const wk = await payrollDb.markWeekPaid(admin as never, { period, note: "Gusto" }, now);
check("Mark the week paid marks every payable line, leaves the rest", wk.ok && (wk as { marked: number }).marked === 4 && (wk as { skipped: number }).skipped === 1 && db.payroll_paid.length === 4, JSON.stringify(wk));
check("Every line gets the Monday pay date", db.payroll_paid.every((r) => r.paid_on === period.payDate && r.note === "Gusto"));
check("Nothing outside the week was marked", !db.payroll_paid.some((r) => r.assignment_id === "nm1"));
check("The line without a clock out was not marked", !db.payroll_paid.some((r) => r.assignment_id === "x2"));
check("Each has its snapshot", db.payroll_paid.every((r) => typeof r.total_cents === "number" && r.minutes > 0));
check("Mark the week paid again finds nothing to do", !(await payrollDb.markWeekPaid(admin as never, { period }, now)).ok && db.payroll_paid.length === 4);
view = (await payrollDb.payrollView(admin as never, period))!;
check("Undo still works on one line from the week", (await payrollDb.undoPaid(admin as never, { assignmentId: "z1" }, now)).ok && db.payroll_paid.filter((r) => !r.undone_at).length === 3);
check("The board asks before marking the week", src("app/team/admin/payroll/payroll-board.tsx").includes("paid for the week, pay date") && src("app/team/admin/payroll/payroll-board.tsx").includes('"Mark the week paid"'));

// ----- Four people on one event -----
reset();
const b3 = { id: "b3", name: "Casey Moore", phone: "+12145550113", role: "bartender" as const, active: true };
const b4 = { id: "b4", name: "Drew Park", phone: "+12145550114", role: "bartender" as const, active: true };
db.staff.push({ ...b3, markets: ["dallas"] }, { ...b4, markets: ["dallas"] });
db.event_assignments.push({ id: "y3", session_id: "p2", staff_id: "b3", status: "accepted" }, { id: "y4", session_id: "p2", staff_id: "b4", status: "accepted" }, { id: "y2", session_id: "p2", staff_id: "b2", status: "accepted" });
for (const [a, st] of [["y2", "b2"], ["y3", "b3"], ["y4", "b4"]]) db.time_punches.push(punch(`i${a}`, a, st, "p2", "in", at(day2, 8 * 60)), punch(`o${a}`, a, st, "p2", "out", at(day2, 16 * 60)));
view = (await payrollDb.payrollView(admin as never, period))!;
const e2 = view.events.find((e) => e.sessionId === "p2")!;
check("Four people on one event: all on the row, gratuity split four ways", e2.lines.length === 4 && e2.lines.every((l) => l.tipsCents === 5000) && e2.toStaffCents === e2.lines.reduce((n, l) => n + l.totalCents, 0));
const row2 = payroll.payoutSheetCsv(view).split("\r\n")[2];
check("The payout sheet CSV puts the fourth person in the notes and in the total", row2.includes("4th Jordan Lee") && row2.includes(`,${(e2.toStaffCents / 100).toFixed(2)},`), row2);

// ----- Before the reimbursements migration runs -----
reset();
const realFrom2 = supabase.from;
const gone = { data: null, error: { message: 'relation "public.payroll_reimbursements" does not exist' } };
const broken2: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(gone).then(ok) : () => broken2) });
(supabase as { from: unknown }).from = (t: string) => (t === "payroll_reimbursements" ? broken2 : realFrom2(t));
const pre = (await payrollDb.payrollView(admin as never, period))!;
check("Before the reimbursements migration the page loads, no reimbursements", pre !== null && pre.ready && !pre.reimbursementsReady && pre.events.length === 3 && pre.people.every((p) => p.totals.reimbursementsCents === 0));
const preAdd = await reimbDb.addReimbursement(admin as never, { assignmentId: "x1", kind: "ice", amount: "20" });
check("Adding one says to run the migration", !preAdd.ok && (preAdd as { status: number }).status === 503 && (preAdd as { error: string }).error === reimb.REIMBURSEMENTS_NOT_READY);
check("Marking paid still works before it, without the new column", (await payrollDb.markPaid(admin as never, { assignmentId: "x1" })).ok && !("reimbursements_cents" in db.payroll_paid[0]));
check("Business and My pay still load before it", (await bizDb.eventBusinessFor(admin as never, p1s())) !== null && (await payDb.myPayRows("b1", period.from, period.to)).rows.length === 3);
(supabase as { from: unknown }).from = realFrom2;

// ----- Header, reuse, wording -----
const links = nav.headerLinks(true, { unreadNews: 0 }, true).map((l) => l.label);
check("Admins get Payroll next to Business", links.indexOf("Payroll") === links.indexOf("Business") + 1);
check("Managers get no Payroll link", !nav.headerLinks(true, { unreadNews: 0 }, false).some((l) => l.label === "Payroll"));
check("Payroll reuses the payout sheet, timesheet rows and the Business tab", src("lib/team/payroll-db.ts").includes("eventBusinessFor(admin, session, new Date(), shared, payout)") && src("lib/team/payroll-db.ts").includes("payoutFrom(admin, session, sheet)") && src("lib/team/payroll-db.ts").includes("timesheetRows(") && src("lib/team/payroll.ts").includes("payoutTotals(") && src("lib/team/payroll.ts").includes("overWeekLimit(totals)"));
check("No new pay math in payroll", !/rateCents \*|\* ?minutes|\/ ?60\)/.test(src("lib/team/payroll.ts") + src("lib/team/payroll-db.ts")));
const shown = [
  ...Object.values(payroll.FILTER_LABEL),
  ...Object.values(reimb.KIND_LABEL),
  ...Object.values(reimb.PICKUP_PROMPT),
  reimb.REIMBURSED_LABEL,
  reimb.REIMBURSEMENTS_NOT_READY,
  reimb.LOCKED_MESSAGE,
  ...Object.values(pay.PAY_PACKAGE_LABEL),
  pay.rateSourceText(pay.lineRate(null, "Tailored")),
  pay.rateSourceText(pay.lineRate(2000, "Tailored")),
  pay.rateSourceText(pay.lineRate(null, "Build a Bar")),
  payroll.dayLabel("2026-11-16"),
  ...payroll.SHEET_CSV_COLUMNS,
  ...Object.values(payroll.PROBLEM_TEXT),
  payroll.NOT_READY_MESSAGE,
  payroll.FIX_HOURS,
  payroll.overText({ week: "2026-11-09", minutes: 2500, overMinutes: 100 }),
  ...[src("app/team/admin/payroll/payroll-board.tsx"), src("app/team/admin/payroll/page.tsx"), src("app/team/admin/business/settings-form.tsx"), src("app/team/pay/page.tsx"), src("app/team/admin/payout-card.tsx")].flatMap((f) => [...f.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1])),
];
const hy = shown.filter((t) => /[-‐‑–—]/.test(t));
check("No hyphens in any wording on screen", hy.length === 0, hy.join(" | "));

done("payroll");
