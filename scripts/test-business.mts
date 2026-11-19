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
const staffingFor = (await import("../lib/pricing.ts")).staffingFor;
const fin = (o: Record<string, unknown> = {}) => ({ session_id: "e1", deposit_paid_cents: null, deposit_paid_on: null, balance_paid_cents: null, balance_paid_on: null, supplies_cents: null, ...o });
// Test case 21: Full Bar, 1 bartender, 4 hours (7 with setup and breakdown), 18 guests, $820 with $164 gratuity, nobody assigned, nothing costed, $3.00 a guest.
const base = {
  today: "2026-11-17",
  eventDay: "2026-12-30",
  done: false,
  totalCents: 82000,
  gratuityCents: 16400,
  pricePending: false,
  defaultDepositCents: 15000,
  finance: null,
  payments: [] as { id: string; cents: number; paidOn: string | null; note: string; recordedBy: string }[],
  crew: [] as { rateCents: number; estPayCents: number | null; actualPayCents: number | null; mileageCents: number }[],
  bookedBartenders: 1,
  guests: 18,
  scheduledMinutes: 420,
  bookedMinutes: 420,
  defaultRateCents: 3000,
  staffingFor,
  supplyLines: { catalogCents: 0, costed: 0, lines: 14 },
  perGuestCents: 300,
  packageLabel: "Full Bar",
  other: [] as { id: string; label: string; cents: number }[],
  settings: S,
};
const cost = (b: ReturnType<typeof biz.eventBusiness>, k: string) => b.costs.find((c) => c.key === k)!;

// ----- 21. A filled in estimate the moment it arrives -----
const t21 = biz.eventBusiness(base);
check("21. Deposit $150, shown as paid with nothing recorded", t21.revenue.depositPaidCents === 15000 && !t21.revenue.depositEdited);
check("21. Remaining balance $670", t21.revenue.balanceCents === 67000 && t21.revenue.status === "Deposit paid, balance due");
check("21. Labor $210.00, estimate from booking", cost(t21, "labor").cents === 21000 && t21.labor === "booking" && cost(t21, "labor").note.startsWith("estimate from booking"));
check("21. Burden $31.50", cost(t21, "burden").cents === 3150);
check("21. Tips $164.00", cost(t21, "tips").cents === 16400);
check("21. Supplies $54.00, estimate per guest", cost(t21, "supplies").cents === 5400 && t21.supplies === "per_guest" && cost(t21, "supplies").note.startsWith("estimate per guest"));
check("21. Card processing $24.38", cost(t21, "card").cents === 2438);
check("21. Mileage shows after the event and is left out", cost(t21, "mileage").cents === null && cost(t21, "mileage").note === "after the event");
check("21. Estimated costs $483.88", t21.costCents === 48388, String(t21.costCents));
check("21. Estimated profit $336.12, complete", t21.complete && t21.profitCents === 33612 && t21.mode === "Estimated" && biz.profitTitle(t21) === "Estimated profit" && biz.costsTitle(t21) === "Estimated costs");
check("21. Margin", t21.marginPct === 41);

// ----- 22. Payments -----
const pay = (cents: number, id = String(cents)) => ({ id, cents, paidOn: "2026-11-10", note: "", recordedBy: "Kenneth Smith" });
const p22 = (payments: ReturnType<typeof pay>[]) => biz.eventBusiness({ ...base, totalCents: 154000, payments }).revenue;
check("22. $1,540 total, $150 deposit, $500 payment: $890 remaining, Partly paid", p22([pay(50000)]).balanceCents === 89000 && p22([pay(50000)]).status === "Partly paid, $890.00 remaining" && p22([pay(50000)]).paid === "partly_paid");
check("22. Then $890: $0 remaining, Paid in full", p22([pay(50000), pay(89000)]).balanceCents === 0 && p22([pay(50000), pay(89000)]).status === "Paid in full");
check("22. Delete the $500: $500 remaining", p22([pay(89000)]).balanceCents === 50000);
const over = p22([pay(89000), pay(200000)]);
check("22. Then $2,000: never below zero, overpaid", over.balanceCents === 0 && over.overpaidCents === 200000 + 89000 + 15000 - 154000 && over.status === "Paid in full");
check("Collected is the deposit plus payments", p22([pay(50000)]).collectedCents === 65000);
check("Balance overdue once today is past the balance due date", biz.eventBusiness({ ...base, eventDay: "2026-11-25" }).revenue.status === "Balance overdue" && biz.eventBusiness({ ...base, eventDay: "2026-11-25" }).revenue.balanceDue === "2026-11-11");
check("An edited deposit counts instead of the default", biz.eventBusiness({ ...base, finance: fin({ deposit_paid_cents: 30000 }) }).revenue.balanceCents === 52000);
const legacy = biz.eventBusiness({ ...base, finance: fin({ balance_paid_cents: 20000, balance_paid_on: "2026-11-01" }), payments: [pay(10000)] }).revenue;
check("7. A balance recorded before the payments list is one payment", legacy.payments.length === 2 && legacy.payments[0].id === "legacy" && legacy.paymentsCents === 30000 && legacy.balanceCents === 82000 - 15000 - 30000);
check("8. Payments never change profit: it is the booked total less costs", biz.eventBusiness({ ...base, payments: [pay(67000)] }).profitCents === t21.profitCents);

// ----- 9. Labor -----
const fromGuests = biz.eventBusiness({ ...base, bookedBartenders: null, guests: 100 });
check("9. No bartender count: the staffing the guest count needs", cost(fromGuests, "labor").cents === 2 * 21000 && cost(fromGuests, "labor").note.includes("2 for 100 guests"));
check("9. No service times: setup, booked hours, breakdown", cost(biz.eventBusiness({ ...base, scheduledMinutes: null, bookedMinutes: 480 }), "labor").cents === 24000);
check("9. No times and no hours: still an estimate, and says what it assumed", cost(biz.eventBusiness({ ...base, scheduledMinutes: null, bookedMinutes: null }), "labor").cents === 12000 && cost(biz.eventBusiness({ ...base, scheduledMinutes: null, bookedMinutes: null }), "labor").note.includes("assumed"));
const crew = [{ rateCents: 3500, estPayCents: 24500, actualPayCents: null, mileageCents: 1800 }, { rateCents: 3000, estPayCents: 21000, actualPayCents: null, mileageCents: 0 }];
const withCrew = biz.eventBusiness({ ...base, crew });
check("9. Once people accept: the accepted crew at each rate, estimate from crew", cost(withCrew, "labor").cents === 45500 && withCrew.labor === "crew" && cost(withCrew, "labor").note.startsWith("estimate from crew"));
check("10. Burden follows labor", cost(withCrew, "burden").cents === Math.round(45500 * 0.15));
const after = biz.eventBusiness({ ...base, done: true, crew: [{ ...crew[0], actualPayCents: 26250 }, { ...crew[1], actualPayCents: 22500 }] });
check("9. After the event: actual clocked hours, called Costs and Profit", cost(after, "labor").cents === 48750 && after.labor === "actual" && after.mode === "Actual" && biz.profitTitle(after) === "Profit" && biz.costsTitle(after) === "Costs");
check("11. After the event: the stored mileage pay, counted in profit", cost(after, "mileage").cents === 1800 && after.costCents === after.costs.reduce((n, c) => n + (c.cents ?? 0), 0) && after.profitCents === 82000 - after.costCents);
const openRow = biz.eventBusiness({ ...base, done: true, crew: [{ ...crew[0], actualPayCents: 26250 }, crew[1]] });
check("Someone not clocked out: still a number, their estimate filling in, never blocked", openRow.complete && cost(openRow, "labor").cents === 26250 + 21000 && cost(openRow, "labor").note.includes("1 of 2 not clocked out"));
const doneNoCrew = biz.eventBusiness({ ...base, done: true });
check("After the event with nobody accepted: the booking estimate, still Estimated", doneNoCrew.labor === "booking" && doneNoCrew.mode === "Estimated" && cost(doneNoCrew, "mileage").cents === 0);

// ----- 12. Supplies -----
check("12a. Entered by hand wins", cost(biz.eventBusiness({ ...base, finance: fin({ supplies_cents: 9900 }) }), "supplies").cents === 9900 && biz.eventBusiness({ ...base, finance: fin({ supplies_cents: 9900 }) }).supplies === "manual" && cost(biz.eventBusiness({ ...base, finance: fin({ supplies_cents: 9900 }) }), "supplies").note === "entered by hand");
const all = biz.eventBusiness({ ...base, supplyLines: { catalogCents: 7300, costed: 14, lines: 14 } });
check("12b. Every line costed: from the shopping list", cost(all, "supplies").cents === 7300 && all.supplies === "catalog" && cost(all, "supplies").note === "from the shopping list");
const part = biz.eventBusiness({ ...base, supplyLines: { catalogCents: 6000, costed: 9, lines: 14 } });
check("12c. Partly costed: catalog plus the per guest share of the rest", cost(part, "supplies").cents === 6000 + Math.round((5400 * 5) / 14) && part.supplies === "partial" && cost(part, "supplies").note === "9 of 14 items costed, rest estimated");
check("12d. No Shopping list: estimate per guest", cost(biz.eventBusiness({ ...base, supplyLines: null }), "supplies").cents === 5400);
const blank = biz.eventBusiness({ ...base, perGuestCents: null });
check("13. Blank per guest estimate when needed: incomplete, says so, links to settings", !blank.complete && blank.profitCents === null && blank.missing.length === 1 && blank.missing[0].text === "Set a per guest estimate for Full Bar in Business settings" && blank.missing[0].href === "/team/admin/business#settings" && cost(blank, "supplies").href === "/team/admin/business#settings" && cost(blank, "supplies").note.includes("set a per guest estimate in Business settings"));
check("13. ...partly costed needs it too", !biz.eventBusiness({ ...base, perGuestCents: null, supplyLines: { catalogCents: 6000, costed: 9, lines: 14 } }).complete);
check("13. ...but not when every line is costed or entered by hand", biz.eventBusiness({ ...base, perGuestCents: null, supplyLines: { catalogCents: 7300, costed: 14, lines: 14 } }).complete && biz.eventBusiness({ ...base, perGuestCents: null, finance: fin({ supplies_cents: 100 }) }).complete);

// ----- 14 to 18. The rest, and what can hold profit back -----
check("14. Card processing, other costs as before", cost(t21, "card").note.includes("confirm your rate") && cost(biz.eventBusiness({ ...base, other: [{ id: "o", label: "Ice", cents: 2000 }] }), "other").cents === 2000);
const noTotal = biz.eventBusiness({ ...base, totalCents: null });
check("17. No booked total: the only other reason, linked to the total form", !noTotal.complete && noTotal.profitCents === null && noTotal.missing.map((m) => m.text).join() === "No booked total" && noTotal.missing[0].href === "#total");
check("17. Price pending says so", biz.eventBusiness({ ...base, totalCents: null, pricePending: true }).missing[0].text === "No booked total (price pending)");
const noGrat = biz.eventBusiness({ ...base, gratuityCents: 0 });
check("18. $0 gratuity: a note, tips $0, profit still shows", noGrat.revenue.noGratuity && cost(noGrat, "tips").cents === 0 && noGrat.complete && !t21.revenue.noGratuity);
check("18. No gratuity on file is the same", biz.eventBusiness({ ...base, gratuityCents: null }).complete && biz.eventBusiness({ ...base, gratuityCents: null }).revenue.noGratuity);
check("17. Nobody on the event never blocks profit", t21.complete && t21.labor === "booking");
check("Burden follows the setting", cost(biz.eventBusiness({ ...base, settings: { ...S, burdenPct: 10 } }), "burden").cents === 2100);

// ----- Settings: per guest supplies, blank by default -----
const blankSet = bset.readSupplies(null);
check("13. Per guest estimates are blank by default, one per package and one for legacy", bset.SUPPLY_PACKAGES.join() === "beerwine,dive,wedding,full,premium,legacy" && Object.values(blankSet).every((v) => v === null));
const vs = bset.validateSupplies({ full: "3.00", dive: "$2.5", premium: "" });
check("13. The form saves dollars as cents and keeps blanks blank", vs.ok && vs.value.full === 300 && vs.value.dive === 250 && vs.value.premium === null);
check("13. A bad amount is refused", !bset.validateSupplies({ full: "abc" }).ok);

// ----- 6. No "not on file" wording -----
const words = ["lib/team/business.ts", "lib/team/business-overview.ts", "app/team/admin/e/[id]/business-tab.tsx", "app/team/admin/business/page.tsx"].map((f) => src(f)).join("\n");
check("6. No Payment status not on file, Supplies not on file, or No staff on the event yet anywhere", !/Payment status not on file|Supplies not on file|No staff on the event yet|Costs on file/.test(words));
check("6. Nothing implies card details are stored", !/card number|card on file|last 4|cvv/i.test(words) && !/card_number|last4|payment_method/.test(src("supabase/migrations/20261217_event_payments.sql").replace(/--.*$/gm, "")));
check("1. The Record deposit paid link is gone, Edit deposit is there", !src("app/team/admin/e/[id]/business-tab.tsx").includes("Record {label") && src("app/team/admin/e/[id]/business-tab.tsx").includes("Edit deposit") && src("app/team/admin/e/[id]/business-tab.tsx").includes("Record a payment") && src("app/team/admin/e/[id]/business-tab.tsx").includes("Mark paid in full"));
check("4, 5. Renamed: Remaining balance, Balance due date", src("app/team/admin/e/[id]/business-tab.tsx").includes(">Remaining balance<") && src("app/team/admin/e/[id]/business-tab.tsx").includes(">Balance due date<"));

// ----- Tabs: Business is admins only -----
check("Admins get a Business tab last, right after Agreement", tabs.managerTabsFor("admin").map(([, l]) => l).slice(-2).join(",") === "Agreement,Business");
check("Managers do not", !tabs.managerTabsFor("manager").some(([k]) => k === "business"));
check("A manager asking for Business gets Details", tabs.allowedTab("manager", "business") === "details" && tabs.allowedTab("admin", "business") === "business");

// ----- From the database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const mgr = { id: "m1", name: "Pat Manager", phone: "+12145550101", role: "manager" as const, active: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const far = addDays(today, 60);
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    // Test case 21 as it arrives: nobody assigned, 18 guests, 1 bartender booked.
    event("t21", far, "1 Elm St, Dallas, TX", { guest_count: 18, bartenders: 1 }, { team_market: "dallas", guest_count: "18", booked_price: { total: 820, gratuity: 164, bartenders: 1, deposit_paid: 150 } }),
    event("p22", far, "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: { total: 1540, gratuity: 140, bartenders: 2, deposit_paid: 150 } }),
    event("f1", addDays(today, 20), "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: { total: 1800, gratuity: 180, bartenders: 1, deposit_paid: 150 } }),
    event("nt", addDays(today, 20), "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: null }),
  ];
  db.staff = [admin, mgr, b1].map((s) => ({ ...s, markets: ["dallas"] }));
  db.event_assignments = [{ id: "x1", session_id: "f1", staff_id: "b1", status: "accepted" }];
  for (const t of ["staff_pay_rates", "staff_profiles", "assignment_mileage", "time_punches", "time_approvals", "time_edits", "time_reopens", "team_hidden_events", "event_finance", "event_other_costs", "event_payments", "event_updates", "supply_catalog"]) db[t] = [];
  db.team_settings = [{ key: bset.SUPPLIES_KEY, value: { full: 300 } }]; // $3.00 a guest, Full Bar, for the test only
}
reset();
const s = (id: string) => db.sessions.find((x) => x.id === id) as never;
const view = async (id: string) => (await bizDb.eventBusinessFor(admin as never, s(id)))!;

const v21 = await view("t21");
check("21. From the database: the same filled in estimate", v21.business.complete && v21.business.costCents === 48388 && v21.business.profitCents === 33612 && v21.business.revenue.balanceCents === 67000, JSON.stringify(v21.business.costs.map((c) => [c.key, c.cents])));
db.team_settings = [];
const blank21 = await view("t21");
check("13. With the Full Bar estimate blank: incomplete and linked to settings", !blank21.business.complete && blank21.business.missing[0].key === "per_guest");
db.team_settings = [{ key: bset.SUPPLIES_KEY, value: { full: 300 } }];
db.supply_catalog = [{ id: "c1", product: "Limes", brand: "", size: "", cost_cents: 50, store: "", aliases: [] }];
const withCat = await view("t21");
check("12. The Shopping list is costed live against the catalog", withCat.supplies!.lines > 0 && withCat.supplies!.catalogEmpty === false, JSON.stringify(withCat.supplies));
db.supply_catalog = [];

check("A manager gets no Business data", (await bizDb.eventBusinessFor(mgr as never, s("f1"))) === null);
check("A bartender gets no Business data", (await bizDb.eventBusinessFor(b1 as never, s("f1"))) === null);
for (const body of [{ action: "deposit", amount: "150" }, { action: "add_payment", amount: "500" }, { action: "paid_in_full" }, { action: "delete_payment", id: "x" }, { action: "supplies", amount: "90" }, { action: "add_cost", label: "Ice", amount: "20" }, { action: "total", total: "1500" }]) {
  const r = await bizDb.saveEventBusiness(mgr as never, "p22", body);
  check(`23. A manager gets 403 on ${body.action}`, !r.ok && r.status === 403);
}
check("Nothing was written by the manager", db.event_finance.length === 0 && db.event_other_costs.length === 0 && db.event_payments.length === 0);

// Test case 22 through the real actions.
const save = (body: Record<string, unknown>) => bizDb.saveEventBusiness(admin as never, "p22", body);
check("22. Record $500 with a note", (await save({ action: "add_payment", amount: "500", date: "2026-11-10", note: "Zelle" })).ok);
let r22 = (await view("p22")).business.revenue;
check("22. $890 remaining, Partly paid, $890 remaining", r22.balanceCents === 89000 && r22.status === "Partly paid, $890.00 remaining", JSON.stringify(r22));
check("2. Each payment shows amount, date, note, and who recorded it", r22.payments[0].cents === 50000 && r22.payments[0].paidOn === "2026-11-10" && r22.payments[0].note === "Zelle" && r22.payments[0].recordedBy === "Kenneth Smith");
check("2. The date defaults to today", (await save({ action: "add_payment", amount: "1" })).ok && (db.event_payments.at(-1) as { paid_on: string }).paid_on === today);
await save({ action: "delete_payment", id: String(db.event_payments.at(-1)!.id) });
check("3. Mark paid in full records one payment for what remains", (await save({ action: "paid_in_full" })).ok && (db.event_payments.at(-1) as { amount_cents: number; note: string }).amount_cents === 89000);
r22 = (await view("p22")).business.revenue;
check("22. $0 remaining, Paid in full", r22.balanceCents === 0 && r22.status === "Paid in full");
check("3. Nothing left to mark paid", !(await save({ action: "paid_in_full" })).ok);
const fiveHundred = String((db.event_payments as { id: string; amount_cents: number }[]).find((p) => p.amount_cents === 50000)!.id);
check("22. Delete the $500", (await save({ action: "delete_payment", id: fiveHundred })).ok);
check("22. $500 remaining", (await view("p22")).business.revenue.balanceCents === 50000);
check("22. Record $2,000", (await save({ action: "add_payment", amount: "2,000" })).ok);
r22 = (await view("p22")).business.revenue;
check("22. Shows overpaid", r22.balanceCents === 0 && r22.overpaidCents === 150000);
const twoK = String((db.event_payments as { id: string; amount_cents: number }[]).find((p) => p.amount_cents === 200000)!.id);
check("2. Edit a payment", (await save({ action: "edit_payment", id: twoK, amount: "100", date: "2026-11-12", note: "second payment" })).ok && (await view("p22")).business.revenue.balanceCents === 40000);
check("Bad amounts and dates are refused", !(await save({ action: "add_payment", amount: "abc" })).ok && !(await save({ action: "add_payment", amount: "5", date: "2026-02-30" })).ok && !(await save({ action: "add_payment", amount: "0" })).ok);
check("1. Edit deposit", (await save({ action: "deposit", amount: "300", date: "2026-10-01" })).ok && (await view("p22")).business.revenue.depositPaidCents === 30000);
check("1. Blank goes back to the default $150", (await save({ action: "deposit", amount: "" })).ok && (await view("p22")).business.revenue.depositPaidCents === 15000);

// 7. An old Balance paid amount (before the migration) shows as a payment, and can be edited or removed.
db.event_finance.push({ session_id: "f1", deposit_paid_cents: null, deposit_paid_on: null, balance_paid_cents: 50000, balance_paid_on: "2026-11-01", supplies_cents: null });
const f1 = await view("f1");
check("7. A recorded balance paid becomes one payment in the list", f1.business.revenue.payments.length === 1 && f1.business.revenue.payments[0].id === "legacy" && f1.business.revenue.balanceCents === 180000 - 15000 - 50000);
check("7. ...it can be deleted like any payment", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "delete_payment", id: "legacy" })).ok && (await view("f1")).business.revenue.payments.length === 0);

check("Supplies by hand", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "supplies", amount: "210.50" })).ok && (await view("f1")).business.costs.find((c) => c.key === "supplies")!.cents === 21050);
check("Add another cost", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "add_cost", label: "Glass rental", amount: "75" })).ok && db.event_other_costs.length === 1);
check("A cost needs a label", !(await bizDb.saveEventBusiness(admin as never, "f1", { action: "add_cost", label: "", amount: "5" })).ok);
const v = await view("f1");
check("9. With someone accepted: estimate from crew ($30 default, 7 hours)", v.business.costs[0].cents === 21000 && v.business.labor === "crew" && v.business.mode === "Estimated");
check("Complete: an Estimated profit", v.business.complete && v.business.profitCents === 180000 - v.business.costCents, JSON.stringify(v.business.missing));
const costId = String(db.event_other_costs[0].id);
check("Remove a cost", (await bizDb.saveEventBusiness(admin as never, "f1", { action: "remove_cost", id: costId })).ok && db.event_other_costs.length === 0);

// A missing total.
check("A total already on file is not replaced here", !(await bizDb.saveEventBusiness(admin as never, "f1", { action: "total", total: "99" })).ok);
const nt = await view("nt");
check("No total: incomplete, and says so", !nt.business.complete && nt.business.missing[0].text === "No booked total");
check("Mark paid in full needs a total", !(await bizDb.saveEventBusiness(admin as never, "nt", { action: "paid_in_full" })).ok);
check("The gratuity cannot be more than the total", !(await bizDb.saveEventBusiness(admin as never, "nt", { action: "total", total: "100", gratuity: "200" })).ok);
check("An admin enters the missing total and gratuity", (await bizDb.saveEventBusiness(admin as never, "nt", { action: "total", total: "1,250", gratuity: "125" })).ok);
const ntRow = db.sessions.find((x) => x.id === "nt") as { booked_price: { total: number; gratuity: number; deposit_paid: number }; price_set_by_name: string };
check("Saved on the booking the usual way", ntRow.booked_price.total === 1250 && ntRow.booked_price.gratuity === 125 && ntRow.booked_price.deposit_paid === 150 && ntRow.price_set_by_name === "Kenneth Smith");
// Price pending: entering the total clears it the normal way.
db.sessions.push(event("pp", addDays(today, 30), "1 Elm St, Dallas, TX", {}, { team_market: "dallas", booked_price: { total: null, gratuity: null, deposit_paid: 150 }, price_pending: true, price_pending_info: { items: [{ changes: [] }], old_total: null } }));
check("Price pending: entering the total clears it", (await bizDb.saveEventBusiness(admin as never, "pp", { action: "total", total: "2000", gratuity: "180" })).ok);
const pp = db.sessions.find((x) => x.id === "pp") as { price_pending: boolean; booked_price: { total: number; gratuity: number } };
check("Through setPendingPrice, with the change order row", pp.price_pending === false && pp.booked_price.total === 2000 && pp.booked_price.gratuity === 180 && db.event_updates.some((u) => u.session_id === "pp"));

// 24. Staff pay and the payout card are untouched.
check("24. The payout sheet and pay are not changed by Business", !/business/i.test(src("lib/team/payout.ts").replace(/^\/\/.*$/gm, "")) && !src("lib/team/payout-db.ts").includes("business") && !src("lib/team/pay.ts").includes("business"));

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
const bizTables = ["event_finance", "event_other_costs", "event_payments"];
check("Business tables are read only in the Business module", files("lib").concat(files("app")).filter((f) => /\.(ts|tsx)$/.test(f) && bizTables.some((t) => src(f).includes(`"${t}"`))).every((f) => f.startsWith("lib/team/business")));
check("Staff pages never import Business", files("app/team").filter((f) => !f.startsWith("app/team/admin/") && /\.(ts|tsx)$/.test(f)).every((f) => !/from "@\/lib\/team\/business|eventBusinessFor|overviewEvents/.test(src(f))));

done("business");
