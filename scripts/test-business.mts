// Business, per event: revenue, costs, profit, Incomplete, and admins only.
// Run: node --no-warnings scripts/test-business.mts

import { readdirSync, statSync } from "node:fs";
import { addDays, check, done, event, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const biz = await import("../lib/team/business.ts");
const bizDb = await import("../lib/team/business-db.ts");
const bset = await import("../lib/team/business-settings.ts");
const tabs = await import("../lib/team/manager-tabs.ts");

const today = time.todayIn("America/Chicago");
const S = bset.COST_DEFAULTS;
const payoutTotals = (o: Record<string, number> = {}) => ({ people: 2, estMinutes: 840, estPayCents: 42000, actualMinutes: 900, actualPayCents: 45000, mileageMiles: 80, mileageCents: 2400, tipsCents: 20000, totalCents: 0, flagged: 0, open: 0, ...o });
const base = {
  eventDay: "2026-12-12",
  done: false,
  totalCents: 200000,
  gratuityCents: 20000,
  bookedDepositCents: 15000,
  pricePending: false,
  finance: { session_id: "e1", deposit_paid_cents: 15000, deposit_paid_on: "2026-11-01", balance_paid_cents: null, balance_paid_on: null, supplies_cents: 15000 },
  payout: payoutTotals(),
  crewExpected: 2,
  suppliesEstimateCents: null,
  suppliesUnmatched: 0,
  other: [{ id: "o1", label: "Glass rental", cents: 5000 }],
  settings: S,
};

// ----- The math -----
const est = biz.eventBusiness(base);
const cost = (k: string) => est.costs.find((c) => c.key === k)!.cents;
check("Labor before the event is the estimate", est.mode === "Estimated" && cost("labor") === 42000);
check("Payroll burden is 15% of labor", cost("burden") === 6300);
check("Mileage and tips paid out", cost("mileage") === 2400 && cost("tips") === 20000);
check("Supplies, manual amount", cost("supplies") === 15000);
check("Card processing 2.9% + $0.30 a charge, deposit and balance", cost("card") === 5800 + 60 && biz.cardFee(200000, S) === 5860);
check("Card processing says confirm your rate", est.costs.find((c) => c.key === "card")!.note.includes("confirm your rate"));
check("Other costs", cost("other") === 5000);
check("Profit = total minus every cost", est.complete && est.costCents === 96560 && est.profitCents === 103440, JSON.stringify(est.costs));
check("Margin", est.marginPct === 51.7);
const act = biz.eventBusiness({ ...base, done: true });
check("After the event: Actual, with actual clocked pay", act.mode === "Actual" && act.costs[0].cents === 45000 && act.costs[1].cents === 6750);
check("Balance and due date 14 days before", est.revenue.balanceCents === 185000 && est.revenue.balanceDue === "2026-11-28");
check("Deposit paid status", est.revenue.paid === "deposit_paid" && biz.PAID_LABEL[est.revenue.paid] === "Deposit paid, balance open");
const paid = biz.eventBusiness({ ...base, finance: { ...base.finance, balance_paid_cents: 185000, balance_paid_on: "2026-11-27" } });
check("Paid in full", paid.revenue.paid === "paid_in_full" && paid.revenue.balanceCents === 0);
check("Burden follows the setting", biz.eventBusiness({ ...base, settings: { ...S, burdenPct: 10 } }).costs[1].cents === 4200);

// ----- Incomplete -----
const noTotal = biz.eventBusiness({ ...base, totalCents: null });
check("No total: Incomplete, named, no profit number", !noTotal.complete && noTotal.profitCents === null && noTotal.missing.includes("Total not on file") && noTotal.marginPct === null);
check("Price pending says so", biz.eventBusiness({ ...base, totalCents: null, pricePending: true }).missing.includes("Total not on file (price pending)"));
const noSupplies = biz.eventBusiness({ ...base, finance: { ...base.finance, supplies_cents: null } });
check("Supplies not on file", !noSupplies.complete && noSupplies.missing.includes("Supplies not on file") && noSupplies.costs.find((c) => c.key === "supplies")!.cents === null);
check("The catalog estimate counts as on file", biz.eventBusiness({ ...base, finance: { ...base.finance, supplies_cents: null }, suppliesEstimateCents: 9000 }).complete);
check("Payment status not on file", biz.eventBusiness({ ...base, finance: { ...base.finance, deposit_paid_cents: null, deposit_paid_on: null } }).missing.includes("Payment status not on file"));
check("Gratuity not on file", biz.eventBusiness({ ...base, gratuityCents: null }).missing.includes("Gratuity not on file"));
const open = biz.eventBusiness({ ...base, done: true, payout: payoutTotals({ open: 1 }) });
check("After the event, someone not clocked out: Incomplete", !open.complete && open.missing.includes("Hours not clocked out for 1 of 2") && open.costs[0].cents === null);
check("Nobody accepted: Incomplete", biz.eventBusiness({ ...base, payout: null }).missing.includes("No staff accepted yet"));

// ----- Tabs: Business is admins only -----
check("Admins get a Business tab after Chat", tabs.managerTabsFor("admin").map(([, l]) => l).slice(-2).join(",") === "Chat,Business");
check("Managers do not", !tabs.managerTabsFor("manager").some(([k]) => k === "business"));
check("A manager asking for Business gets Details", tabs.allowedTab("manager", "business") === "details" && tabs.allowedTab("admin", "business") === "business");

// ----- From the database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const mgr = { id: "m1", name: "Pat Manager", phone: "+12145550101", role: "manager" as const, active: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    event("f1", addDays(today, 20), "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: { total: 1800, gratuity: 180, bartenders: 1, deposit_paid: 150 } }),
    event("nt", addDays(today, 20), "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: null }),
  ];
  db.staff = [admin, mgr, b1].map((s) => ({ ...s, markets: ["dallas"] }));
  db.event_assignments = [{ id: "x1", session_id: "f1", staff_id: "b1", status: "accepted" }];
  for (const t of ["staff_pay_rates", "staff_profiles", "assignment_mileage", "time_punches", "time_approvals", "time_edits", "time_reopens", "team_hidden_events", "team_settings", "event_finance", "event_other_costs", "event_updates"]) db[t] = [];
}
reset();
const s = (id: string) => db.sessions.find((x) => x.id === id) as never;

check("A manager gets no Business data", (await bizDb.eventBusinessFor(mgr as never, s("f1"))) === null);
check("A bartender gets no Business data", (await bizDb.eventBusinessFor(b1 as never, s("f1"))) === null);
for (const body of [{ action: "deposit", amount: "150" }, { action: "supplies", amount: "90" }, { action: "add_cost", label: "Ice", amount: "20" }, { action: "total", total: "1500" }]) {
  const r = await bizDb.saveEventBusiness(mgr as never, "f1", body);
  check(`A manager gets 403 on ${body.action}`, !r.ok && r.status === 403);
}
check("Nothing was written by the manager", db.event_finance.length === 0 && db.event_other_costs.length === 0);

check("An admin records the deposit", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "deposit", amount: "150", date: "2026-11-02" })).ok);
check("An admin records the balance", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "balance", amount: "1,650.00", date: "2026-11-20" })).ok);
check("Bad amounts and dates are refused", !(await bizDb.saveEventBusiness(admin as never, "f1", { action: "deposit", amount: "abc" })).ok && !(await bizDb.saveEventBusiness(admin as never, "f1", { action: "deposit", amount: "5", date: "2026-02-30" })).ok);
check("Supplies for this event", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "supplies", amount: "210.50" })).ok);
check("Add another cost", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "add_cost", label: "Glass rental", amount: "75" })).ok && db.event_other_costs.length === 1);
check("A cost needs a label", !(await bizDb.saveEventBusiness(admin as never, "f1", { action: "add_cost", label: "", amount: "5" })).ok);
const v = (await bizDb.eventBusinessFor(admin as never, s("f1")))!;
check("The admin view reads it all back", v.business.revenue.paid === "paid_in_full" && v.business.revenue.depositPaidOn === "2026-11-02" && v.business.costs.find((c) => c.key === "supplies")!.cents === 21050 && v.business.costs.find((c) => c.key === "other")!.cents === 7500);
check("Labor from the payout sheet ($30 default, 7 hours)", v.business.costs[0].cents === 21000 && v.business.mode === "Estimated");
check("Complete: an Estimated profit", v.business.complete && v.business.profitCents === 180000 - v.business.costCents, JSON.stringify(v.business.missing));
const costId = String(db.event_other_costs[0].id);
check("Remove a cost", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "remove_cost", id: costId })).ok && db.event_other_costs.length === 0);
check("Clear the balance", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "balance", amount: "" })).ok && db.event_finance[0].balance_paid_cents === null);

// A missing total.
check("A total already on file is not replaced here", !(await bizDb.saveEventBusiness(admin as never, "f1", { action: "total", total: "99" })).ok);
const nt = (await bizDb.eventBusinessFor(admin as never, s("nt")))!;
check("No total: Incomplete", !nt.business.complete && nt.business.missing.includes("Total not on file"));
check("The gratuity cannot be more than the total", !(await bizDb.saveEventBusiness(admin as never, "nt", { action: "total", total: "100", gratuity: "200" })).ok);
check("An admin enters the missing total and gratuity", (await bizDb.saveEventBusiness(admin as never, "nt", { action: "total", total: "1,250", gratuity: "125" })).ok);
const ntRow = db.sessions.find((x) => x.id === "nt") as { booked_price: { total: number; gratuity: number; deposit_paid: number }; price_set_by_name: string };
check("Saved on the booking the usual way", ntRow.booked_price.total === 1250 && ntRow.booked_price.gratuity === 125 && ntRow.booked_price.deposit_paid === 150 && ntRow.price_set_by_name === "Kenneth Smith");
// Price pending: entering the total clears it the normal way.
db.sessions.push(event("pp", addDays(today, 30), "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: { total: null, gratuity: null, deposit_paid: 150 }, price_pending: true, price_pending_info: { items: [{ changes: [] }], old_total: null } }));
check("Price pending: entering the total clears it", (await bizDb.saveEventBusiness(admin as never, "pp", { action: "total", total: "2000", gratuity: "180" })).ok);
const pp = db.sessions.find((x) => x.id === "pp") as { price_pending: boolean; booked_price: { total: number; gratuity: number } };
check("Through setPendingPrice, with the change order row", pp.price_pending === false && pp.booked_price.total === 2000 && pp.booked_price.gratuity === 180 && db.event_updates.some((u) => u.session_id === "pp"));

// ----- No Business route or page reaches a manager (source checks) -----
function files(dir: string): string[] {
  return readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(new URL(`../${p}`, import.meta.url)).isDirectory() ? files(p) : [p];
  });
}
const bizRoutes = files("app/api/team/admin/business").filter((f) => f.endsWith("route.ts"));
check("Every Business route answers 403 to anyone but an admin", bizRoutes.length >= 2 && bizRoutes.every((f) => /if \(!staff \|\| !isFullAdmin\(staff\.role\)\)|if \(!isFullAdmin\(staff\.role\)\) return NextResponse\.json\(\{ error: "Admins only\." \}, \{ status: 403 \}\)/.test(src(f))), bizRoutes.join());
check("No Business route uses the admin-or-manager check", bizRoutes.every((f) => !src(f).includes("isAdminRole(")));
check("Every Business database function checks for an admin first", ["eventBusinessFor", "saveEventBusiness"].every((fn) => new RegExp(`export async function ${fn}[^{]*\\{\\s*if \\(!isFullAdmin\\(`).test(src("lib/team/business-db.ts"))));
check("The manager page builds Business only for admins", src("app/team/admin/e/[id]/page.tsx").includes("allowedTab(me.role, asked)") && src("app/team/admin/e/[id]/page.tsx").includes('on("business") ? eventBusinessFor(me, session) : null'));
check("Costs settings are admins only", src("lib/team/business-settings-db.ts").includes("if (!isFullAdmin(admin.role)) return null;"));
const bizTables = ["event_finance", "event_other_costs"];
check("Business tables are read only in the Business module", files("lib").concat(files("app")).filter((f) => /\.(ts|tsx)$/.test(f) && bizTables.some((t) => src(f).includes(`"${t}"`))).every((f) => f.startsWith("lib/team/business")));
check("Staff pages never import Business", files("app/team").filter((f) => !f.startsWith("app/team/admin/") && /\.(ts|tsx)$/.test(f)).every((f) => !/business/i.test(src(f))));

done("business");
