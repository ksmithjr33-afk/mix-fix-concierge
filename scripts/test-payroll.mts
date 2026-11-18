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
const nav = await import("../lib/team/header-nav.ts");
const route = await import("../app/api/team/admin/payroll/route.ts");
const exportRoute = await import("../app/api/team/admin/payroll/export/route.ts");

const CT = "America/Chicago";
const today = time.chicagoToday();

// ----- Pay periods: Monday to Sunday, like the Time page -----
const wed = "2026-11-18"; // a Wednesday
const thisW = payroll.periodFor("this_week", wed);
const lastW = payroll.periodFor("last_week", wed);
const two = payroll.periodFor("last_two_weeks", wed);
check("This week is Monday to Sunday", thisW.from === "2026-11-16" && thisW.to === "2026-11-22", JSON.stringify(thisW));
check("Last week is the Monday to Sunday before", lastW.from === "2026-11-09" && lastW.to === "2026-11-15", JSON.stringify(lastW));
check("Last two weeks is the two full weeks before this one", two.from === "2026-11-02" && two.to === "2026-11-15", JSON.stringify(two));
check("A custom range is kept", JSON.stringify(payroll.periodFor("custom", wed, "2026-11-01", "2026-11-20")) === JSON.stringify({ key: "custom", from: "2026-11-01", to: "2026-11-20" }));
check("A backwards or too long custom range falls back to last week", payroll.periodFor("custom", wed, "2026-11-20", "2026-11-01").key === "last_week" && payroll.periodFor("custom", wed, "2026-01-01", "2026-11-01").key === "last_week");
const remembered = payroll.periodFromCookie(payroll.periodCookie(payroll.periodFor("custom", wed, "2026-11-01", "2026-11-20")), wed);
check("The last choice is remembered and read back", remembered.key === "custom" && remembered.from === "2026-11-01" && payroll.choosePeriod({}, "this_week", wed).key === "this_week");
check("The address wins over the remembered choice", payroll.choosePeriod({ period: "last_two_weeks" }, "this_week", wed).key === "last_two_weeks");
check("Nothing remembered: last week", payroll.choosePeriod({}, undefined, wed).key === "last_week");

// ----- The database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const mgr = { id: "m1", name: "Pat Manager", phone: "+12145550101", role: "manager" as const, active: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Avery Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const EVENT = { lat: 32.7767, lng: -96.797 };
const period = payroll.periodFor("last_week", today);
const day1 = period.from;
const day2 = addDays(period.from, 1);
const day3 = addDays(period.from, 2);
const at = (day: string, min: number) => time.zonedInstant(day, min, CT).toISOString();
const punch = (id: string, a: string, staff: string, s: string, type: string, iso: string) => ({ id, assignment_id: a, staff_id: staff, session_id: s, type, punched_at: iso, flags: [], source: "phone" });

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  const top = { team_market: "dallas", geo_address: "1 Elm St, Dallas, TX", geo_lat: EVENT.lat, geo_lng: EVENT.lng, booked_price: { total: 1800, gratuity: 200, bartenders: 2 } };
  db.sessions = [event("p1", day1, "1 Elm St, Dallas, TX", {}, top), event("p2", day2, "1 Elm St, Dallas, TX", { client_name: "Maria Chen", event_type: "Wedding" }, top), event("p3", day3, "1 Elm St, Dallas, TX", {}, top)];
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
  db.staff_sessions = [];
}
reset();

let view = (await payrollDb.payrollView(admin as never, period))!;
check("The page loads for an admin", view !== null && view.ready && view.period.from === period.from);
check("One card per person who worked, sorted by name", view.people.map((p) => p.name).join() === "Avery Diaz,Jordan Lee", view.people.map((p) => p.name).join());
const jordan = () => view.people.find((p) => p.staffId === "b1")!;
const avery = () => view.people.find((p) => p.staffId === "b2")!;
check("Name, role and rate on the card", jordan().role === "Bartender" && jordan().rateCents === 3000 && avery().rateCents === 2500);
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
const mPost = await Promise.all([{ action: "mark", assignmentId: "x1" }, { action: "mark_all", staffId: "b1", from: period.from, to: period.to }, { action: "undo", assignmentId: "x1" }].map((b) => route.POST(postReq(b))));
check("A manager gets 403 from the actions route", mPost.every((r) => r.status === 403) && db.payroll_paid.length === 0);
const mGet = await Promise.all(["lines", "people"].map((k) => exportRoute.GET(getReq(k))));
check("A manager gets 403 from both exports", mGet.every((r) => r.status === 403));
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
check("Lines CSV: the columns asked for", linesRes.status === 200 && linesCsv[0] === "Person,Role,Rate,Event date,Event,Clock in,Clock out,Hours,Wages,Mileage miles,Mileage pay,Tips,Line total,Paid,Pay date,Marked by,Note", linesCsv[0]);
check("Lines CSV: one row per line", linesCsv.length === 1 + 4);
const jRow = linesCsv.find((l) => l.startsWith("Jordan Lee") && l.includes(day1))!;
check("Lines CSV row: hours, wages, mileage, tips, total, paid, pay date, marked by", jRow.includes(",7.67,230.00,80,24.00,100.00,354.00,Yes,") && jRow.includes("Kenneth Smith"), jRow);
const aRow = linesCsv.find((l) => l.startsWith("Avery Diaz"))!;
check("Lines CSV: a line with no clock out says fix hours first", aRow.includes(",No, fix hours first,") || aRow.includes(',"No, fix hours first",'), aRow);
const peopleRes = await exportRoute.GET(getReq("people"));
const peopleCsv = (await peopleRes.text()).trim().split("\r\n");
check("People CSV: one row per person with paid and unpaid", peopleRes.status === 200 && peopleCsv[0] === "Person,Role,Rate,Hours,Wages,Mileage pay,Tips,Total,Paid,Unpaid" && peopleCsv.length === 3, peopleCsv.join(" | "));
const jPeople = peopleCsv.find((l) => l.startsWith("Jordan Lee"))!.split(",");
check("People CSV: Jordan fully paid", jPeople[3] === "40.67" && jPeople[9] === "0.00" && jPeople[8] === jPeople[7], jPeople.join());
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
check("The migration file is there and makes payroll_paid", src("supabase/migrations/20261218_payroll_paid.sql").includes("create table if not exists public.payroll_paid") && src("supabase/migrations/20261218_payroll_paid.sql").includes("where undone_at is null"));

// ----- Header, reuse, wording -----
const links = nav.headerLinks(true, { unreadNews: 0 }, true).map((l) => l.label);
check("Admins get Payroll next to Business", links.indexOf("Payroll") === links.indexOf("Business") + 1);
check("Managers get no Payroll link", !nav.headerLinks(true, { unreadNews: 0 }, false).some((l) => l.label === "Payroll"));
check("Payroll reuses the payout sheet and timesheet rows", src("lib/team/payroll-db.ts").includes("payoutFrom(admin, session, sheet)") && src("lib/team/payroll-db.ts").includes("timesheetRows(") && src("lib/team/payroll.ts").includes("payoutTotals(") && src("lib/team/payroll.ts").includes("overWeekLimit(totals)"));
check("No new pay math in payroll", !/rateCents \*|\* ?minutes|\/ ?60\)/.test(src("lib/team/payroll.ts") + src("lib/team/payroll-db.ts")));
const shown = [
  ...Object.values(payroll.PERIOD_LABEL),
  ...Object.values(payroll.FILTER_LABEL),
  ...Object.values(payroll.PROBLEM_TEXT),
  payroll.NOT_READY_MESSAGE,
  payroll.FIX_HOURS,
  payroll.overText({ week: "2026-11-09", minutes: 2500, overMinutes: 100 }),
  ...[src("app/team/admin/payroll/payroll-board.tsx"), src("app/team/admin/payroll/page.tsx")].flatMap((f) => [...f.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1])),
];
const hy = shown.filter((t) => /[-‐‑–—]/.test(t));
check("No hyphens in any wording on screen", hy.length === 0, hy.join(" | "));

done("payroll");
