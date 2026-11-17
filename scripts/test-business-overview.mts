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
const payout = { people: 1, estMinutes: 420, estPayCents: 21000, actualMinutes: 0, actualPayCents: 0, mileageMiles: 0, mileageCents: 0, tipsCents: 10000, totalCents: 31000, flagged: 0, open: 0 };
const fin = (o: Record<string, unknown> = {}) => ({ session_id: "x", deposit_paid_cents: 15000, deposit_paid_on: "2026-11-01", balance_paid_cents: null, balance_paid_on: null, supplies_cents: 10000, ...o });
const mk = (id: string, day: string, o: Partial<Parameters<typeof biz.eventBusiness>[0]> = {}, pkg = "Full Bar", market = "Dallas"): import("../lib/team/business-overview.ts").OverviewEvent => ({
  sessionId: id,
  title: `Event ${id}`,
  day,
  package: pkg,
  market,
  leadSource: null,
  payrollCents: 31000,
  business: biz.eventBusiness({ eventDay: day, done: false, totalCents: 100000, gratuityCents: 10000, bookedDepositCents: 15000, pricePending: false, finance: fin(), payout, crewExpected: 1, suppliesEstimateCents: null, suppliesUnmatched: 0, other: [], settings: S, ...o }),
});
const a = mk("a", "2026-11-20");
const b = mk("b", "2026-11-22", {}, "Dive Bar", "Austin");
const noTotal = mk("c", "2026-11-25", { totalCents: null });
const noSupplies = mk("d", "2026-11-26", { finance: fin({ supplies_cents: null }) });
const noPay = mk("e", "2026-11-27", { finance: fin({ deposit_paid_cents: null, deposit_paid_on: null }) }, "Dive Bar");
const all = [a, b, noTotal, noSupplies, noPay];
const t = ov.totalsOf(all);
check("Totals count complete events only", t.events === 2 && t.revenueCents === 200000);
check("Each cost type is added up", t.costs.labor === 42000 && t.costs.tips === 20000 && t.costs.supplies === 20000 && t.costs.card === 2 * biz.cardFee(100000, S) && t.costs.burden === 6300);
check("Profit, margin, profit per event, average ticket", t.profitCents === a.business.profitCents! + b.business.profitCents! && t.marginPct === Math.round((t.profitCents / 200000) * 1000) / 10 && t.profitPerEventCents === t.profitCents / 2 && t.averageTicketCents === 100000);
const c = ov.completeness(all);
check("X of Y events have a total on file", c.withTotal === 4 && c.events === 5 && c.complete === 2 && c.incomplete === 3);
check("Incomplete totals on file are counted separately", c.incompleteRevenueCents === 200000);
check("The list names events missing a total, payment status, or supplies", c.gaps.length === 3 && c.gaps.find((g) => g.sessionId === "c")!.missing[0] === "Total not on file" && c.gaps.find((g) => g.sessionId === "d")!.missing.includes("Supplies not on file") && c.gaps.find((g) => g.sessionId === "e")!.missing.includes("Payment status not on file"));
const pk = ov.breakdown(all, (e) => e.package);
check("By package, with incomplete counted aside", pk.find((r) => r.key === "Dive Bar")!.totals.events === 1 && pk.find((r) => r.key === "Dive Bar")!.incomplete === 1 && pk.find((r) => r.key === "Full Bar")!.incomplete === 2);
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
  mk("paidLate", "2026-11-26", { finance: fin({ balance_paid_cents: 85000, balance_paid_on: "2026-11-10" }) }), // paid
  mk("unknown", "2026-12-10", { totalCents: null }), // due Nov 26, no total
];
const cv = ov.cashView(cashList, today);
check("Weeks start Monday and run 60 days", cv.weeks[0].week === "2026-11-16" && cv.weeks.at(-1)!.week <= "2027-01-15" && cv.weeks.length === 9, cv.weeks.map((w) => w.week).join());
check("Balances due by week", cv.weeks.find((w) => w.week === "2026-11-16")!.balancesDueCents === 85000 && cv.weeks.find((w) => w.week === "2026-11-30")!.balancesDueCents === 85000);
check("Next 30 and 60 days", cv.next30.balancesDueCents === 170000 && cv.next60.balancesDueCents === 255000, JSON.stringify([cv.next30, cv.next60]));
check("No total: counted as unknown, not as $0", cv.next30.unknownBalances === 1 && cv.weeks.find((w) => w.week === "2026-11-23")!.unknownBalances === 1);
check("Estimated payroll for the same weeks", cv.weeks.find((w) => w.week === "2026-11-23")!.payrollCents === 62000 && cv.next30.payrollCents === 31000 * 4);
check("Unpaid balances already inside 14 days", cv.overdue.length === 1 && cv.overdue[0].sessionId === "late" && cv.overdue[0].balanceCents === 85000);

// ----- CSV -----
const csv = ov.eventsCsv([a, noTotal]).trim().split("\r\n");
check("The event table CSV has every column", csv[0] === "Event date,Event,Package,Market,Profit status,Missing,Total,Gratuity,Deposit paid,Balance paid,Balance,Balance due,Paid status,Labor,Payroll burden,Mileage pay,Tips paid out,Supplies,Card processing,Other costs,Costs,Profit,Margin %", csv[0]);
check("Complete rows carry profit; incomplete rows say so with no profit", csv[1].includes(",Estimated,") && csv[1].split(",").at(-2) !== "" && csv[2].includes(",Incomplete,Total not on file,") && csv[2].endsWith(",,"));

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
for (const k of ["event_assignments", "staff_pay_rates", "staff_profiles", "assignment_mileage", "time_punches", "time_approvals", "time_edits", "time_reopens", "team_settings", "event_finance", "event_other_costs"]) db[k] = [];
check("A manager gets no overview events", (await ovDb.overviewEvents(mgr as never, addDays(d, -1), addDays(d, 30))).length === 0 && (await ovDb.cashEvents(mgr as never, d)).length === 0);
const evs = await ovDb.overviewEvents(admin as never, addDays(d, -1), addDays(d, 30));
check("Admins get events in range, without hidden or calendar only ones", evs.map((e) => e.sessionId).sort().join() === "s1,s2", evs.map((e) => e.sessionId).join());
check("Every event is Incomplete until its inputs are on file", evs.every((e) => !e.business.complete));

// ----- The header, the page, the routes -----
check("Admins get a Business link after Time", nav.headerLinks(true, { unreadNews: 0 }, true).map((l) => l.label).join() === "Staffing,Staff,Clients,Time,Business,News,Training,Me");
check("Managers do not", !nav.headerLinks(true, { unreadNews: 0 }, false).some((l) => l.label === "Business"));
check("The header shows Business only to role admin", src("app/team/team-header.tsx").includes("const showBusiness = showAdmin && isFullAdmin(viewed?.role);"));
check("The page sends anyone but an admin away before loading", /export default async function BusinessPage[\s\S]*?const me = await requireFullAdmin\(/.test(src("app/team/admin/business/page.tsx")) && src("lib/team/auth.ts").includes('if (!isFullAdmin(staff.role)) redirect("/team/admin/events");'));
check("The CSV export answers 403 to anyone but an admin", src("app/api/team/admin/business/export/route.ts").includes('if (!staff || !isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });'));
check("Every overview database function checks for an admin first", ["overviewEvents", "cashEvents"].every((fn) => new RegExp(`export async function ${fn}[^{]*\\{\\s*if \\(!isFullAdmin\\(`).test(src("lib/team/business-overview-db.ts"))));

done("business overview");
