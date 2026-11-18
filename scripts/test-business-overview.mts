// Business overview: ranges, totals, completeness, breakdowns, cash view, CSV,
// and admins only. Run: node --no-warnings scripts/test-business-overview.mts

import { addDays, check, done, event, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const biz = await import("../lib/team/business.ts");
const ov = await import("../lib/team/business-overview.ts");
const ovDb = await import("../lib/team/business-overview-db.ts");
const bset = await import("../lib/team/business-settings.ts");
const nav = await import("../lib/team/header-nav.ts");

// ----- Ranges -----
check("This month", JSON.stringify(ov.rangeFor("this_month", "2026-11-17")) === JSON.stringify({ preset: "this_month", from: "2026-11-01", to: "2026-11-30" }));
check("Last month, across a year", JSON.stringify(ov.rangeFor("last_month", "2026-01-10")) === JSON.stringify({ preset: "last_month", from: "2025-12-01", to: "2025-12-31" }));
check("Next 30 days", JSON.stringify(ov.rangeFor("next_30", "2026-11-17")) === JSON.stringify({ preset: "next_30", from: "2026-11-17", to: "2026-12-16" }));
check("Custom", ov.rangeFor("custom", "2026-11-17", "2026-06-01", "2026-08-31").from === "2026-06-01");
check("Bad custom dates fall back to this month", ov.rangeFor("custom", "2026-11-17", "2026-08-31", "2026-06-01").preset === "this_month" && ov.rangeFor("custom", "2026-11-17", "x", "y").preset === "this_month");

// ----- Totals from each event's own figures -----
const S = bset.COST_DEFAULTS;
const { staffingFor } = await import("../lib/pricing.ts");
const crew = [{ rateCents: 3000, estPayCents: 21000, actualPayCents: null, mileageCents: 0 }];
const fin = (o: Record<string, unknown> = {}) => ({ session_id: "x", deposit_paid_cents: null, deposit_paid_on: null, balance_paid_cents: null, balance_paid_on: null, supplies_cents: 10000, ...o });
const payment = (cents: number) => ({ id: `p${cents}`, cents, paidOn: "2026-11-10", note: "", recordedBy: "" });
const mk = (id: string, day: string, o: Partial<Parameters<typeof biz.eventBusiness>[0]> = {}, pkg = "Full Bar", market = "Dallas"): import("../lib/team/business-overview.ts").OverviewEvent => ({
  sessionId: id,
  title: `Event ${id}`,
  day,
  package: pkg,
  market,
  leadSource: null,
  payrollCents: 31000,
  business: biz.eventBusiness({
    today: "2026-11-17",
    eventDay: day,
    done: false,
    totalCents: 100000,
    gratuityCents: 10000,
    pricePending: false,
    defaultDepositCents: 15000,
    finance: fin(),
    payments: [],
    crew,
    bookedBartenders: 1,
    guests: 50,
    scheduledMinutes: 420,
    bookedMinutes: 420,
    defaultRateCents: 3000,
    staffingFor,
    supplyLines: null,
    perGuestCents: 200,
    packageLabel: pkg,
    other: [],
    settings: S,
    ...o,
  }),
});
const a = mk("a", "2026-11-20");
const b = mk("b", "2026-11-22", {}, "Dive Bar", "Austin");
const noTotal = mk("c", "2026-11-25", { totalCents: null });
const noPerGuest = mk("d", "2026-11-26", { finance: fin({ supplies_cents: null }), perGuestCents: null });
const perGuest = mk("e", "2026-11-27", { finance: fin({ supplies_cents: null }) }, "Dive Bar");
const all = [a, b, noTotal, noPerGuest, perGuest];
const t = ov.totalsOf(all);
check("Totals count complete events only", t.events === 3 && t.revenueCents === 300000);
check("Each cost type is added up", t.costs.labor === 63000 && t.costs.tips === 30000 && t.costs.supplies === 30000 && t.costs.card === 3 * biz.cardFee(100000, S) && t.costs.burden === 9450 && t.costs.mileage === 0);
check("Profit, margin, profit per event, average ticket", t.profitCents === a.business.profitCents! + b.business.profitCents! + perGuest.business.profitCents! && t.marginPct === Math.round((t.profitCents / 300000) * 1000) / 10 && t.profitPerEventCents === Math.round(t.profitCents / 3) && t.averageTicketCents === 100000);
const c = ov.completeness(all);
check("X of Y events have a total on file", c.withTotal === 4 && c.events === 5 && c.complete === 3 && c.incomplete === 2);
check("Incomplete totals on file are counted separately", c.incompleteRevenueCents === 100000);
check("The list names only a missing booked total or per guest estimate", c.gaps.length === 2 && c.gaps.find((g) => g.sessionId === "c")!.missing[0].text === "No booked total" && c.gaps.find((g) => g.sessionId === "d")!.missing[0].key === "per_guest");
const pk = ov.breakdown(all, (e) => e.package);
check("By package, with incomplete counted aside", pk.find((r) => r.key === "Dive Bar")!.totals.events === 2 && pk.find((r) => r.key === "Dive Bar")!.incomplete === 0 && pk.find((r) => r.key === "Full Bar")!.incomplete === 2);
check("By market", ov.breakdown(all, (e) => e.market).find((r) => r.key === "Austin")!.totals.revenueCents === 100000);
check("No lead source breakdown: it is not stored", all.every((e) => e.leadSource === null) && src("app/team/admin/business/page.tsx").includes("lead source is not stored yet"));

// ----- Cash view -----
const today = "2026-11-17";
const cashList = [
  mk("w1", "2026-12-05"), // due Nov 21, balance $850
  mk("w2", "2026-12-20"), // due Dec 6
  mk("far", "2027-01-20"), // due Jan 6: inside 60 days (end Jan 15)
  mk("out", "2027-02-10"), // due Jan 27: outside 60 days
  mk("late", "2026-11-25"), // due Nov 11: already inside 14 days, unpaid
  mk("paidLate", "2026-11-26", { payments: [payment(85000)] }), // paid
  mk("unknown", "2026-12-10", { totalCents: null }), // due Nov 26, no total
];
const cv = ov.cashView(cashList, today);
check("Weeks start Monday and run 60 days", cv.weeks[0].week === "2026-11-16" && cv.weeks.at(-1)!.week <= "2027-01-15" && cv.weeks.length === 9, cv.weeks.map((w) => w.week).join());
check("Balances due by week", cv.weeks.find((w) => w.week === "2026-11-16")!.balancesDueCents === 85000 && cv.weeks.find((w) => w.week === "2026-11-30")!.balancesDueCents === 85000);
check("Next 30 and 60 days", cv.next30.balancesDueCents === 170000 && cv.next60.balancesDueCents === 255000, JSON.stringify([cv.next30, cv.next60]));
check("No total: counted as unknown, not as $0", cv.next30.unknownBalances === 1 && cv.weeks.find((w) => w.week === "2026-11-23")!.unknownBalances === 1);
check("Estimated payroll for the same weeks", cv.weeks.find((w) => w.week === "2026-11-23")!.payrollCents === 62000 && cv.next30.payrollCents === 31000 * 4);
check("Unpaid balances already inside 14 days, with the readable status", cv.overdue.length === 1 && cv.overdue[0].sessionId === "late" && cv.overdue[0].balanceCents === 85000 && cv.overdue[0].status === "Balance overdue");

// ----- 20. CSV -----
const partly = mk("p", "2026-12-30", { payments: [payment(50000)] });
const csv = ov.eventsCsv([a, noTotal, partly]).trim().split("\r\n");
check("20. The CSV carries collected, remaining balance, status, labor basis and supplies method", csv[0] === "Event date,Event,Package,Market,Profit status,Missing,Total,Gratuity,Deposit paid,Payments,Collected,Remaining balance,Overpaid,Balance due date,Payment status,Labor basis,Supplies method,Labor,Payroll burden,Mileage pay,Tips paid out,Supplies,Card processing,Reimbursed to staff,Other costs,Costs,Profit,Margin %", csv[0]);
const cells = (line: string) => (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
const row = (line: string) => Object.fromEntries(csv[0].split(",").map((h, i) => [h, cells(line)[i]]));
const pr = row(csv[3]);
check("20. ...with the same numbers the tab shows", pr["Collected"] === "650.00" && pr["Remaining balance"] === "350.00" && pr["Payment status"] === "Partly paid, $350.00 remaining" && pr["Profit"] === (partly.business.profitCents! / 100).toFixed(2) && pr["Margin %"] === String(partly.business.marginPct) && pr["Supplies method"] === "entered by hand" && pr["Labor basis"] === "estimate from crew", JSON.stringify(pr));
check("Complete rows carry profit; incomplete rows say so with no profit", csv[1].includes(",Estimated,") && csv[1].split(",").at(-2) !== "" && csv[2].includes(",Incomplete,No booked total,") && csv[2].endsWith(",,"));
check("20. The overview lists estimated profit, margin, collected, and remaining for each event", ["profitTitle(e.business)", "e.business.marginPct", "Collected {money(e.business.revenue.collectedCents)}", "remaining`"].every((x) => src("app/team/admin/business/page.tsx").includes(x)));

// ----- From the database: admins only -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const mgr = { id: "m1", name: "Pat Manager", phone: "+12145550101", role: "manager" as const, active: true };
const d = time.todayIn("America/Chicago");
for (const k of Object.keys(db)) delete db[k];
db.sessions = [
  event("s1", addDays(d, 3), "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: { total: 1500, gratuity: 150, deposit_paid: 150 } }),
  event("s2", addDays(d, 4), "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: null }),
  event("hid", addDays(d, 4), "1 Elm St, Dallas, TX", {}, { team_market: "dallas" }),
  event("cal", addDays(d, 4), "1 Elm St, Dallas, TX", {}, { team_market: "dallas", calendar_only: true }),
  event("old", addDays(d, -90), "1 Elm St, Dallas, TX", {}, { team_market: "dallas" }),
];
db.team_hidden_events = [{ session_id: "hid" }];
db.staff = [admin, mgr];
for (const k of ["event_assignments", "staff_pay_rates", "staff_profiles", "assignment_mileage", "time_punches", "time_approvals", "time_edits", "time_reopens", "team_settings", "event_finance", "event_other_costs", "event_payments", "supply_catalog"]) db[k] = [];
check("A manager gets no overview events", (await ovDb.overviewEvents(mgr as never, addDays(d, -1), addDays(d, 30))).length === 0 && (await ovDb.cashEvents(mgr as never, d)).length === 0);
const evs = await ovDb.overviewEvents(admin as never, addDays(d, -1), addDays(d, 30));
check("Admins get events in range, without hidden or calendar only ones", evs.map((e) => e.sessionId).sort().join() === "s1,s2", evs.map((e) => e.sessionId).join());
check("With no per guest estimate set, an event with a total waits only on that; one with no total says so", evs.find((e) => e.sessionId === "s1")!.business.missing.map((m) => m.key).join() === "per_guest" && evs.find((e) => e.sessionId === "s2")!.business.missing.map((m) => m.key).join() === "total,per_guest");
db.team_settings = [{ key: bset.SUPPLIES_KEY, value: { full: 250 } }];
const evs2 = await ovDb.overviewEvents(admin as never, addDays(d, -1), addDays(d, 30));
check("Once it is set, every event with a total shows an estimated profit", evs2.find((e) => e.sessionId === "s1")!.business.complete && evs2.find((e) => e.sessionId === "s1")!.business.profitCents !== null && !evs2.find((e) => e.sessionId === "s2")!.business.complete);

// ----- The header, the page, the routes -----
check("Admins get a Business link after Time", nav.headerLinks(true, { unreadNews: 0 }, true).map((l) => l.label).join() === "Staffing,Staff,Clients,Time,Business,Payroll,News,Training,Me");
check("Managers do not", !nav.headerLinks(true, { unreadNews: 0 }, false).some((l) => l.label === "Business"));
check("The header shows Business only to role admin", src("app/team/team-header.tsx").includes("const showBusiness = showAdmin && isFullAdmin(viewed?.role);"));
check("The page sends anyone but an admin away before loading", /export default async function BusinessPage[\s\S]*?const me = await requireFullAdmin\(/.test(src("app/team/admin/business/page.tsx")) && src("lib/team/auth.ts").includes('if (!isFullAdmin(staff.role)) redirect("/team/admin/events");'));
check("The CSV export answers 403 to anyone but an admin", src("app/api/team/admin/business/export/route.ts").includes('if (!staff || !isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });'));
check("Every overview database function checks for an admin first", ["overviewEvents", "cashEvents"].every((fn) => new RegExp(`export async function ${fn}[^{]*\\{\\s*if \\(!isFullAdmin\\(`).test(src("lib/team/business-overview-db.ts"))));

done("business overview");
