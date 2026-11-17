// The payout sheet: estimate against actual, flags, totals, the CSV columns.
// Run: node --no-warnings scripts/test-payout.mts

import { addDays, check, done, event, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const pay = await import("../lib/team/pay.ts");
const payout = await import("../lib/team/payout.ts");
const payoutDb = await import("../lib/team/payout-db.ts");
const ts = await import("../lib/team/timesheet.ts");
const tsDb = await import("../lib/team/timesheet-db.ts");

const CT = "America/Chicago";
const today = time.todayIn(CT);
const d3 = addDays(today, -3);

// ----- Pure -----
const est = (o: Partial<Parameters<typeof pay.staffEstimate>[0]> = {}) =>
  pay.staffEstimate({ rateOnFile: null, minutes: 420, mileage: { state: "no_address" }, tips: pay.tipsShare(null, 1, true), ...o });
const sheet = (minutes: number | null, out = true) =>
  ({ minutes, clockIn: { id: "i", at: "2026-11-10T22:00:00Z", flags: [], source: "phone" }, clockOut: out ? { id: "o", at: "2026-11-11T05:00:00Z", flags: [], source: "phone" } : null, approved: null }) as never;
const person = (s: unknown, e = est()) => ({ staffId: "b1", assignmentId: "x1", name: "Jordan Lee", role: "bartender", estimate: e, sheet: s as never });

const exact = payout.payoutRow(person(sheet(420)));
check("Estimate and actual side by side", exact.estMinutes === 420 && exact.estPayCents === 21000 && exact.actualMinutes === 420 && exact.actualPayCents === 21000 && exact.diffMinutes === 0);
const r29 = payout.payoutRow(person(sheet(449)));
check("29 minutes over is not flagged", r29.diffMinutes === 29 && !r29.flags.includes("over_estimate"));
const r30 = payout.payoutRow(person(sheet(450)));
check("30 minutes over is flagged", r30.flags.includes("over_estimate") && r30.diffCents === 1500 && r30.actualPayCents === 22500);
const open = payout.payoutRow(person(sheet(null, false)));
check("Clocked in but not out is flagged", open.flags.includes("not_clocked_out") && open.actualMinutes === null && open.fromEstimate);
check("Not clocked out: the total uses the estimate", open.totalCents === 21000);
const none = payout.payoutRow(person(null));
check("Never clocked in is flagged", none.flags.includes("not_clocked_in"));
const full = payout.payoutRow(person(sheet(450), est({ mileage: pay.mileageLine({ oneWayMiles: 50, source: "straight_line", locked: true }, pay.MILEAGE_DEFAULTS, false), tips: pay.tipsShare(300, 2, true) })));
check("Total to pay = actual pay + mileage + tips", full.totalCents === 22500 + 2400 + 15000 && full.mileageMiles === 80);
check("Tips not on file are blank, not zero", exact.tipsCents === null);
const totals = payout.payoutTotals([exact, r30, open, full]);
check("Event totals add up", totals.people === 4 && totals.estPayCents === 84000 && totals.actualPayCents === 21000 + 22500 + 22500 && totals.mileageCents === 2400 && totals.tipsCents === 15000 && totals.flagged === 3 && totals.open === 1, JSON.stringify(totals));
const text = payout.payoutText("Justin · Birthday, Nov 14", [exact, open], payout.payoutTotals([exact, open]));
check("Copy payout is a pasteable table with totals", text.split("\n")[1].startsWith("Name\tEst hours\tEst pay\tActual hours\tActual pay\tDifference\tMileage miles\tMileage pay\tTips\tTotal to pay") && text.includes("Not clocked out") && text.split("\n").at(-1)!.startsWith("Total\t"));
check("40 hours in a week is flagged, 39.98 is not", payout.overWeekLimit([{ staffId: "a", minutes: 2400 }, { staffId: "b", minutes: 2399 }]).has("a") && !payout.overWeekLimit([{ staffId: "b", minutes: 2399 }]).has("b"));

// ----- From the database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const mgr = { id: "m1", name: "Pat Manager", phone: "+12145550101", role: "manager" as const, active: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const EVENT = { lat: 32.7767, lng: -96.797 };
for (const k of Object.keys(db)) delete db[k];
db.sessions = [event("p1", d3, "1 Elm St, Dallas, TX", {}, { team_market: "dallas", geo_address: "1 Elm St, Dallas, TX", geo_lat: EVENT.lat, geo_lng: EVENT.lng, booked_price: { total: 1800, gratuity: 200, bartenders: 2 } })];
db.staff = [admin, mgr, b1, b2].map((s) => ({ ...s, markets: ["dallas"] }));
db.staff_pay_rates = [{ staff_id: "b2", hourly_rate_cents: 2500 }];
db.staff_profiles = [{ staff_id: "b1", home_address: "far", home_lat: EVENT.lat + 50 / 69.0933, home_lng: EVENT.lng }];
db.event_assignments = [
  { id: "x1", session_id: "p1", staff_id: "b1", status: "accepted" },
  { id: "x2", session_id: "p1", staff_id: "b2", status: "accepted" },
];
db.assignment_mileage = [{ assignment_id: "x1", session_id: "p1", staff_id: "b1", one_way_miles: 50, miles_source: "straight_line", locked_at: new Date().toISOString() }];
const at = (min: number) => time.zonedInstant(d3, min, CT).toISOString();
db.time_punches = [
  { id: "i1", assignment_id: "x1", staff_id: "b1", session_id: "p1", type: "in", punched_at: at(16 * 60), flags: [], source: "phone" },
  { id: "o1", assignment_id: "x1", staff_id: "b1", session_id: "p1", type: "out", punched_at: at(23 * 60 + 40), flags: [], source: "phone" },
  { id: "i2", assignment_id: "x2", staff_id: "b2", session_id: "p1", type: "in", punched_at: at(16 * 60), flags: [], source: "phone" },
];
db.time_approvals = [];
db.time_edits = [];
db.time_reopens = [];
db.team_hidden_events = [];
db.team_settings = [];
const s = db.sessions[0] as never;

check("A bartender gets no payout sheet", (await payoutDb.payoutSheet(b1 as never, s)) === null);
const mgrSheet = await payoutDb.payoutSheet(mgr as never, s);
check("Managers get the payout sheet", mgrSheet !== null && mgrSheet.rows.length === 2);
const jordan = mgrSheet!.rows.find((r) => r.staffId === "b1")!;
check("Actual clocked hours from the timesheet rows", jordan.actualMinutes === 460 && jordan.actualPayCents === 23000 && jordan.diffMinutes === 40, JSON.stringify(jordan));
check("40 minutes over the estimate is flagged", jordan.flags.includes("over_estimate"));
check("Mileage and tips on the row", jordan.mileageMiles === 80 && jordan.mileageCents === 2400 && jordan.tipsCents === 10000);
const sam = mgrSheet!.rows.find((r) => r.staffId === "b2")!;
check("Still clocked in is flagged and their rate is used", sam.flags.includes("not_clocked_out") && sam.estPayCents === 17500);
check("No home address: no mileage on the row", sam.mileage.state === "no_address" && sam.mileageCents === 0);
check("Totals at the bottom", mgrSheet!.totals.totalCents === jordan.totalCents + sam.totalCents);

// The payroll CSV gains mileage miles, mileage pay, and tips.
const rows = await tsDb.timesheetRows(addDays(today, -30), today);
const extras = await payoutDb.payoutExtras(admin as never, rows);
check("A bartender gets no CSV extras", (await payoutDb.payoutExtras(b1 as never, rows)).size === 0);
const csv = ts.timesheetCsv(rows, new Map([["b1", 3000], ["b2", 2500]]), extras).trim().split("\r\n");
check("CSV header ends with the new columns", csv[0].endsWith(",Mileage miles,Mileage pay,Tips"));
const jLine = csv.find((l) => l.startsWith("Jordan Lee"))!;
check("CSV row carries mileage miles, mileage pay, and tips", jLine.endsWith(",80,24.00,100.00"), jLine);
const sLine = csv.find((l) => l.startsWith("Sam Diaz"))!;
check("No address: 0 miles and $0.00", sLine.endsWith(",0,0.00,100.00"), sLine);

// ----- Where it shows, and who gets it (source checks) -----
check("Payout card on the manager Day of tab", src("app/team/admin/e/[id]/page.tsx").includes('on("dayof")\n      ? payoutSheet(me, session)') && src("app/team/admin/e/[id]/page.tsx").includes("<PayoutCard"));
check("Payout card on the Time page for one event", src("app/team/admin/timesheets/page.tsx").includes("payoutFrom(me, session, rows)") && src("app/team/admin/timesheets/page.tsx").includes("<PayoutCard"));
check("The card has Copy payout and the flags", src("app/team/admin/payout-card.tsx").includes('label="Copy payout"') && src("app/team/admin/payout-card.tsx").includes("PAYOUT_FLAG_LABEL"));
check("The Time page flags 40+ hours for the week", src("app/team/admin/timesheets/page.tsx").includes("overWeekLimit(staffTotals(all))") && src("app/team/admin/timesheets/timesheet-week.tsx").includes("40+ hours this week"));
check("The CSV export adds the payout extras", src("app/api/team/admin/timesheets/export/route.ts").includes("payoutExtras(staff, rows)"));
check("Payout is never computed on a staff page", ["app/team/e/[id]/page.tsx", "app/team/e/[id]/event-tabs.tsx", "app/team/shifts/[id]/page.tsx", "app/team/events/page.tsx"].every((f) => !/payout|crewEstimates/i.test(src(f))));
check("The payout rows reuse payCents for actual pay", src("lib/team/payout.ts").includes("payCents(e.rateCents, actualMinutes)") && !/\* ?minutes\) ?\/ ?60/.test(src("lib/team/payout.ts")));

done("payout");
