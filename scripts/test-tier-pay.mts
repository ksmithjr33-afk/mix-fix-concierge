// Bartender pay by tier on service fee events: the rates, the new hire rate,
// not placed, the tier on the day of the event, the rate when accepted, the
// rate stored at approval, the settings, and that staff never see a tier.
// Gratuity model events change nothing.
// Run: node --no-warnings scripts/test-tier-pay.mts

import { readdirSync, statSync } from "node:fs";
import { addDays, check, done, event, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const pay = await import("../lib/team/pay.ts");
const payDb = await import("../lib/team/pay-db.ts");
const payout = await import("../lib/team/payout.ts");
const payroll = await import("../lib/team/payroll.ts");
const bs = await import("../lib/team/business-settings.ts");
const biz = await import("../lib/team/business.ts");

const D = pay.SERVICE_FEE_RATE_DEFAULTS;
const rates = { ...pay.PACKAGE_RATE_DEFAULTS, serviceFee: D };
const sf = (role: string, standing?: Parameters<typeof pay.serviceFeeBase>[2], own: number | null = null) => pay.lineRate(own, "Full Bar", rates, { model: "service_fee", role, standing });
const st = (tier: "top" | "core" | "developing" | null, approvedEvents = 5, extra: Record<string, unknown> = {}) => ({ tier, approvedEvents, ...extra });

// ----- The rule -----
check("Defaults: Top $45, Core $40, Developing $35, new hire $30 for 1 event, support $25", D.top === 4500 && D.core === 4000 && D.developing === 3500 && D.newHire === 3000 && D.newHireEvents === 1 && D.support === 2500);
check("Top tier: $45", sf("bartender", st("top")).cents === 4500 && sf("bartender", st("top")).reason === "top");
check("Core tier: $40", sf("bartender", st("core")).cents === 4000 && sf("bartender", st("core")).reason === "core");
check("Developing tier: $35", sf("bartender", st("developing")).cents === 3500 && sf("bartender", st("developing")).reason === "developing");
check("Not placed, past the new hire count: the Core rate", sf("bartender", st(null, 1)).cents === 4000 && sf("bartender", st(null, 1)).reason === "not_placed");
check("New hire (0 approved events): $30 whatever the tier", ["top", "core", "developing", null].every((t) => sf("bartender", st(t as never, 0)).cents === 3000 && sf("bartender", st(t as never, 0)).reason === "new_hire"));
check("One approved event: past the new hire count (default 1)", sf("bartender", st("top", 1)).cents === 4500);
const n3 = { ...rates, serviceFee: { ...D, newHireEvents: 3 } };
check("New hire count 3: still a new hire with 2 approved events", pay.lineRate(null, "Full Bar", n3, { model: "service_fee", role: "bartender", standing: st("top", 2) }).cents === 3000);
const off = { ...rates, serviceFee: { ...D, newHireEvents: 0 } };
check("New hire count 0 turns it off", pay.lineRate(null, "Full Bar", off, { model: "service_fee", role: "bartender", standing: st("top", 0) }).cents === 4500);
check("Bar backs, servers and event helpers: the $25 support rate, never a tier or new hire rate", ["bar_back", "server", "event_helper"].every((r) => sf(r, st("top", 0)).cents === 2500 && sf(r, st("top", 0)).reason === "support"));
check("A personal rate only when higher: $50 wins over Top", sf("bartender", st("top"), 5000).cents === 5000 && sf("bartender", st("top"), 5000).reason === "own");
check("A personal rate lower than the tier rate is not used", sf("bartender", st("core"), 3800).cents === 4000);
check("A new hire with a higher personal rate gets the personal rate", sf("bartender", st("core", 0), 3600).cents === 3600 && sf("bartender", st("core", 0), 3600).reason === "own");
check("Never less than the rate when accepted: dropped to Developing, accepted at $45", sf("bartender", st("developing", 5, { acceptedCents: 4500 })).cents === 4500 && sf("bartender", st("developing", 5, { acceptedCents: 4500 })).reason === "accepted");
check("A raise still applies: accepted at $35, now Top", sf("bartender", st("top", 5, { acceptedCents: 3500 })).cents === 4500 && sf("bartender", st("top", 5, { acceptedCents: 3500 })).reason === "top");
check("Approved hours: the stored rate is the rate, whatever the tier is now", sf("bartender", st("top", 5, { stored: { cents: 4000, reason: "core" } })).cents === 4000 && sf("bartender", st("top", 5, { stored: { cents: 4000, reason: "core" } })).stored === true);
check("No standing (Business, before anyone accepts): the Top rate", sf("bartender").cents === 4500);
check("Gratuity events are unchanged: package rates, own rate always wins, standing ignored", pay.lineRate(null, "Full Bar", rates, { model: "gratuity", role: "bartender", standing: st("developing", 0) }).cents === 3000 && pay.lineRate(2000, "Full Bar", rates, { model: "gratuity", role: "bartender", standing: st("top") }).cents === 2000 && pay.lineRate(null, "Tailored Bar", rates, { model: "gratuity", role: "bartender", standing: st("top") }).cents === 2500 && pay.lineRate(null, "Full Bar", rates, { model: "gratuity", role: "bartender", standing: st("top") }).reason === undefined);

// ----- The tier on the day of the event -----
const ch = (at: string, tier: string) => ({ staff_id: "x", changed_at: at, after: { tier } });
const hist = [ch("2026-10-01T15:00:00Z", "developing"), ch("2026-11-20T15:00:00Z", "core"), ch("2026-12-05T15:00:00Z", "top")];
check("Tier on a day: the last change on or before it", payDb.tierOnDay("2026-11-25", { tier: "top", placed: true }, hist) === "core" && payDb.tierOnDay("2026-12-05", { tier: "top", placed: true }, hist) === "top" && payDb.tierOnDay("2027-01-10", { tier: "top", placed: true }, hist) === "top");
check("Before anyone placed them: not placed", payDb.tierOnDay("2026-09-01", { tier: "top", placed: true }, hist) === null);
check("Never changed: their row only when placed", payDb.tierOnDay("2026-11-25", { tier: "developing", placed: false }, []) === null && payDb.tierOnDay("2026-11-25", { tier: "core", placed: true }, []) === "core");
check("The change day is read in Chicago time (late evening counts as that day)", payDb.tierOnDay("2026-11-20", undefined, [ch("2026-11-21T04:30:00Z", "top")]) === "top");

// ----- Settings -----
const read = bs.readServiceFeeRates(null);
check("Settings: defaults 45, 40, 35, 30, 1, 25", read.top === 4500 && read.core === 4000 && read.developing === 3500 && read.newHire === 3000 && read.newHireEvents === 1 && read.support === 2500);
check("Settings: old per package rates are ignored", JSON.stringify(bs.readServiceFeeRates({ beerwine: 5000, full: 5200, support: 3200 })) === JSON.stringify({ ...D, support: 3200 }));
check("Settings: a saved count of 0 is kept (it turns the new hire rate off)", bs.readServiceFeeRates({ newHireEvents: 0 }).newHireEvents === 0);
const good = bs.validateServiceFeeRates({ top: "46", core: "41.50", developing: "35", newHire: "30", newHireEvents: "2", support: "30" });
check("Settings: valid form saves cents and the count", good.ok && good.value.top === 4600 && good.value.core === 4150 && good.value.newHireEvents === 2);
check("Settings: the count must be a whole number 0 to 50", !bs.validateServiceFeeRates({ top: "45", core: "40", developing: "35", newHire: "30", newHireEvents: "1.5", support: "30" }).ok && !bs.validateServiceFeeRates({ top: "45", core: "40", developing: "35", newHire: "30", newHireEvents: "51", support: "30" }).ok && bs.validateServiceFeeRates({ top: "45", core: "40", developing: "35", newHire: "30", newHireEvents: "0", support: "30" }).ok);
check("Settings: every rate is required", !bs.validateServiceFeeRates({ top: "45", core: "", developing: "35", newHire: "30", newHireEvents: "1", support: "30" }).ok);
check("Settings form: Top, Core, Developing, new hire rate, new hire count, support, no per package rates", JSON.stringify(pay.SERVICE_FEE_RATE_KEYS) === JSON.stringify(["top", "core", "developing", "newHire", "newHireEvents", "support"]) && !/Dive Bar|Premium Bar/.test(Object.values(pay.SERVICE_FEE_RATE_LABEL).join()));
check("Settings are saved by real admins only", src("lib/team/business-settings-db.ts").includes('if (!isFullAdmin(admin.role)) return { ok: false, error: "Admins only.", status: 403 };') && src("app/team/admin/business/page.tsx").includes("requireFullAdmin"));

// ----- Business labor before anyone accepts -----
const labor = biz.laborEstimate({ done: false, crew: [], bookedBartenders: 2, guests: 100, scheduledMinutes: 420, bookedMinutes: null, defaultRateCents: sf("bartender").cents, staffingFor: () => 2, defaultRateLabel: "Top rate" });
check("Business labor before anyone accepts: the Top rate", labor.cents === 2 * 4500 * 7 && labor.note.includes("$45.00/hr Top rate"));
check("Business tab passes the Top rate label on service fee events only", src("lib/team/business-db.ts").includes('...(serviceFee ? { defaultRateLabel: "Top rate" } : {})'));
check("Gratuity labor note unchanged", biz.laborEstimate({ done: false, crew: [], bookedBartenders: 1, guests: 50, scheduledMinutes: 420, bookedMinutes: null, defaultRateCents: 3000, staffingFor: () => 1 }).note.endsWith("$30.00/hr package rate"));

// ----- From the database -----
const today = time.todayIn("America/Chicago");
const ADDR = "1 Elm St, Dallas, TX";
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin", active: true };
const people = [
  { id: "t1", name: "Taylor Top", role: "bartender" },
  { id: "n1", name: "Nia New", role: "bartender" },
  { id: "u1", name: "Uri Unplaced", role: "bartender" },
  { id: "d1", name: "Dana Dev", role: "bartender" },
  { id: "bk", name: "Bo Back", role: "bar_back" },
];
const past = (n: number) => `${addDays(today, -n)}T15:00:00Z`;
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  const geo = { geo_address: ADDR, geo_lat: 32.7767, geo_lng: -96.797, team_market: "dallas" };
  db.sessions = [
    event("sf", addDays(today, 5), ADDR, {}, { ...geo, pricing_model: "service_fee", booked_price: { total: 2000, pricing_model: "service_fee", bartenders: 3 } }),
    event("sf2", addDays(today, 9), ADDR, {}, { ...geo, pricing_model: "service_fee", booked_price: { total: 2000, pricing_model: "service_fee", bartenders: 1 } }),
    event("sfpast", addDays(today, -3), ADDR, {}, { ...geo, pricing_model: "service_fee", booked_price: { total: 2000, pricing_model: "service_fee", bartenders: 1 } }),
    event("gr", addDays(today, 5), ADDR, {}, { ...geo, booked_price: { total: 1800, gratuity: 300, bartenders: 2 } }),
    event("old", addDays(today, -20), ADDR, {}, { ...geo, booked_price: { total: 1800, gratuity: 300, bartenders: 2 } }),
  ];
  db.staff = [admin, ...people.map((p) => ({ ...p, phone: "+12145550199", active: true }))].map((s) => ({ ...s, markets: ["dallas"] }));
  db.staff_pay_rates = [];
  db.staff_profiles = [];
  db.team_settings = [];
  db.assignment_mileage = [];
  db.event_assignments = [
    ...people.map((p) => ({ id: `sf-${p.id}`, session_id: "sf", staff_id: p.id, status: "accepted" })),
    ...people.map((p) => ({ id: `gr-${p.id}`, session_id: "gr", staff_id: p.id, status: "accepted" })),
    { id: "sf2-t1", session_id: "sf2", staff_id: "t1", status: "offered" },
    { id: "past-t1", session_id: "sfpast", staff_id: "t1", status: "accepted" },
    // Approved hours on an older gratuity event: everyone but Nia is past the new hire count.
    ...people.filter((p) => p.id !== "n1").map((p) => ({ id: `old-${p.id}`, session_id: "old", staff_id: p.id, status: "accepted" })),
  ];
  db.time_approvals = people.filter((p) => p.id !== "n1").map((p) => ({ assignment_id: `old-${p.id}`, staff_id: p.id, approved_by: "a1", approved_at: past(19) }));
  db.staff_rank = [
    { staff_id: "t1", tier: "top", position: 1, placed: true },
    { staff_id: "n1", tier: "top", position: 2, placed: true },
    { staff_id: "u1", tier: "developing", position: 9, placed: false },
    { staff_id: "d1", tier: "developing", position: 1, placed: true },
  ];
  db.staff_rank_history = [
    { staff_id: "t1", changed_at: past(30), after: { tier: "core" } },
    { staff_id: "t1", changed_at: past(1), after: { tier: "top" } }, // promoted yesterday
    { staff_id: "n1", changed_at: past(2), after: { tier: "top" } },
    { staff_id: "d1", changed_at: past(30), after: { tier: "developing" } },
  ];
}
reset();
const s = (id: string) => db.sessions.find((x) => x.id === id) as never;
const byId = (list: { staffId: string; estimate: { rateCents: number; reason?: string } }[]) => Object.fromEntries(list.map((c) => [c.staffId, c.estimate]));

const crew = byId(await payDb.crewEstimates(admin as never, s("sf")));
check("Payout: Top $45, new hire $30, not placed $40, Developing $35, bar back $25", crew.t1.rateCents === 4500 && crew.n1.rateCents === 3000 && crew.u1.rateCents === 4000 && crew.d1.rateCents === 3500 && crew.bk.rateCents === 2500, JSON.stringify(Object.fromEntries(Object.entries(crew).map(([k, v]) => [k, [v.rateCents, v.reason]]))));
check("Payout: the reason for admins (Top, New hire, not placed, Developing, support)", crew.t1.reason === "top" && crew.n1.reason === "new_hire" && crew.u1.reason === "not_placed" && crew.d1.reason === "developing" && crew.bk.reason === "support");
const gr = byId(await payDb.crewEstimates(admin as never, s("gr")));
check("Gratuity event: everyone on the $30 package rate, no reason (unchanged)", Object.values(gr).every((e) => e.rateCents === 3000 && e.reason === undefined));
const pastCrew = byId(await payDb.crewEstimates(admin as never, s("sfpast")));
check("Tier on the day of the event: promoted to Top yesterday, a past event 3 days ago pays Core", pastCrew.t1.rateCents === 4000 && pastCrew.t1.reason === "core");

// A personal rate.
db.staff_pay_rates = [{ staff_id: "d1", hourly_rate_cents: 5000 }];
check("Personal rate above the tier rate: paid, reason Personal rate", byId(await payDb.crewEstimates(admin as never, s("sf"))).d1.rateCents === 5000 && byId(await payDb.crewEstimates(admin as never, s("sf"))).d1.reason === "own");
db.staff_pay_rates = [];

// Settings.
db.team_settings = [{ key: "business_service_fee_rates", value: { ...D, newHireEvents: 0, core: 4200 } }];
const offCrew = byId(await payDb.crewEstimates(admin as never, s("sf")));
check("Count 0: the new hire gets their tier; Core from settings for not placed", offCrew.n1.rateCents === 4500 && offCrew.u1.rateCents === 4200);
db.team_settings = [];

// The rate when accepted.
await payDb.lockAcceptedRate("sf", "t1");
const asg = () => db.event_assignments.find((a) => a.id === "sf-t1") as Record<string, unknown>;
check("Accepting stores the rate that applies now ($45 Top)", asg().accepted_rate_cents === 4500);
db.staff_rank_history.push({ staff_id: "t1", changed_at: new Date().toISOString(), after: { tier: "developing" } });
db.staff_rank.find((r) => r.staff_id === "t1")!.tier = "developing";
const dropped = byId(await payDb.crewEstimates(admin as never, s("sf")));
check("Dropped to Developing after accepting: still $45 on that event (rate when accepted)", dropped.t1.rateCents === 4500 && dropped.t1.reason === "accepted");
const offered = await payDb.myPayEstimate("t1", s("sf2"));
check("A tier drop lowers pay on events not accepted yet ($35)", offered.rateCents === 3500);
await payDb.lockAcceptedRate("sf", "t1");
check("The first stored accepted rate is kept", asg().accepted_rate_cents === 4500);
await payDb.lockAcceptedRate("gr", "t1");
check("A gratuity event stores no accepted rate", (db.event_assignments.find((a) => a.id === "gr-t1") as Record<string, unknown>).accepted_rate_cents === undefined);

// The rate stored at approval.
const toStore = await payDb.rateToStore("sf-u1");
check("Approval stores the rate and why ($40, not placed)", toStore?.rate_cents === 4000 && toStore.rate_reason === "not_placed");
check("A gratuity event stores no rate at approval", (await payDb.rateToStore("gr-u1")) === null);
db.time_approvals.push({ assignment_id: "sf-u1", staff_id: "u1", approved_by: "a1", approved_at: new Date().toISOString(), rate_cents: 4000, rate_reason: "not_placed" });
db.staff_rank.find((r) => r.staff_id === "u1")!.placed = true;
db.staff_rank.find((r) => r.staff_id === "u1")!.tier = "top";
db.staff_rank_history.push({ staff_id: "u1", changed_at: new Date().toISOString(), after: { tier: "top" } });
db.team_settings = [{ key: "business_service_fee_rates", value: { ...D, core: 4400 } }];
const after = byId(await payDb.crewEstimates(admin as never, s("sf")));
check("After approval, a tier or settings change never rewrites the pay: still $40", after.u1.rateCents === 4000 && (after.u1 as { rateStored?: boolean }).rateStored === true);
db.team_settings = [];
check("Approving writes the stored rate, and still approves before the migration runs", src("lib/team/timesheet-db.ts").includes("insert(rate ? { ...base, ...rate } : base)") && src("lib/team/timesheet-db.ts").includes('({ error } = await supabase.from("time_approvals").insert(base));'));
check("The accepted rate is stored on every accept path (lockMileage runs after each)", src("lib/team/pay-db.ts").includes("await lockAcceptedRate(sessionId, staffId);") && ["lib/team/offers-db.ts", "lib/team/shifts-db.ts", "lib/team/assignments-db.ts"].every((f) => src(f).includes("lockMileage(")));
check("Migration adds the accepted rate and the stored rate", /accepted_rate_cents integer/.test(src("supabase/migrations/20270105_tier_pay.sql")) && /time_approvals add column if not exists rate_cents/.test(src("supabase/migrations/20270105_tier_pay.sql")));

// Payout card and Payroll.
const est = (await payDb.crewEstimates(admin as never, s("sf"))).find((c) => c.staffId === "n1")!.estimate;
const row = payout.payoutRow({ staffId: "n1", assignmentId: "sf-n1", name: "Nia New", role: "bartender", estimate: est, sheet: null });
check("Payout row carries the reason", row.reason === "new_hire" && pay.payReasonText(row.reason) === "New hire");
check("Reason labels: the tier, New hire, Personal rate", pay.payReasonText("top") === "Top" && pay.payReasonText("core") === "Core" && pay.payReasonText("own") === "Personal rate" && pay.payReasonText("core", true) === "Core, stored at approval");
check("Payout card shows the reason and the not placed warning", src("app/team/admin/payout-card.tsx").includes("payReasonText(r.reason, r.rateStored)") && src("app/team/admin/payout-card.tsx").includes('r.reason === "not_placed" && <span') && pay.NOT_PLACED_WARNING === "Not placed in a tier. Paid at the Core rate until placed.");
check("Payroll: Rate from shows the reason on service fee lines, the old text on gratuity lines", payroll.lineRateText({ rateSource: "service_fee", ratePkg: "full", reason: "developing", rateStored: false }) === "Developing" && payroll.lineRateText({ rateSource: "package", ratePkg: "full", reason: null, rateStored: false }) === "Full Bar rate");

// Scorecard warning.
const sr = await import("../lib/team/scorecard-ranks-db.ts");
db.staff_rank.find((r) => r.staff_id === "u1")!.placed = false;
db.staff_rank.push({ staff_id: "nn", tier: "developing", position: 10, placed: false });
db.staff.push({ id: "nn", name: "Newer Unplaced", role: "bartender", phone: "+12145550188", active: true, markets: ["dallas"] });
const warned = await sr.unplacedAtCore(admin as never);
check("Scorecard warning: not placed and past the new hire count, never a new hire", warned.map((w) => w.staffId).join() === "u1", JSON.stringify(warned));
check("Scorecard and offer order show the warning", src("app/team/admin/scorecard/page.tsx").includes("NOT_PLACED_WARNING") && src("app/team/admin/scorecard/offers/offer-board.tsx").includes("p.payWarning"));
check("A bartender gets no warning list", (await sr.unplacedAtCore({ id: "t1", name: "Taylor Top", role: "bartender" } as never)).length === 0);

// ----- Staff never see a tier, a rank, a new hire rate, or anyone else's rate -----
const LEAK = /"reason"|rateStored|new.?hire|not.?placed|\btier\b|\brank\b|"top"|"core"|"developing"|\bTop\b|\bCore\b|Developing/i;
const mineNew = await payDb.myPayEstimate("n1", s("sf"));
check("Staff estimate: the new hire sees $30 and nothing about why", mineNew.rateCents === 3000 && !LEAK.test(JSON.stringify(mineNew)), JSON.stringify(mineNew));
check("Staff estimate text says only \"your rate\"", pay.rateSourceText({ source: mineNew.rateSource, pkg: mineNew.ratePkg, serviceFee: mineNew.serviceFee }) === "your rate");
const mineU = await payDb.myPayEstimate("u1", s("sf"));
check("Staff estimate: not placed shows no tier or warning", !LEAK.test(JSON.stringify(mineU)));
const est2 = await payDb.myEstimates("n1", ["sf", "gr"]);
check("Staff event list: dollar amounts only", Object.values(est2).every((v) => /^\$[\d,]+\.\d\d$/.test(v)) && !LEAK.test(JSON.stringify(est2)));
const rows = await payDb.myPayRows("n1", addDays(today, -30), addDays(today, 30));
check("My pay rows: no reason, no tier", rows.rows.length > 0 && !LEAK.test(JSON.stringify(rows)), JSON.stringify(rows).slice(0, 300));
check("forStaff takes the reason off", !("reason" in pay.forStaff({ ...mineNew, reason: "new_hire", rateStored: true } as never)) && !("rateStored" in pay.forStaff({ ...mineNew, reason: "new_hire", rateStored: true } as never)));

function files(dir: string): string[] {
  return readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(new URL(`../${p}`, import.meta.url)).isDirectory() ? files(p) : [p];
  });
}
const staffSide = [...files("app/team"), ...files("app/api/team")].filter((f) => /\.(ts|tsx)$/.test(f) && !f.startsWith("app/team/admin/") && !f.startsWith("app/api/team/admin/"));
const leaks = staffSide.filter((f) => /payReasonText|PAY_REASON_LABEL|NOT_PLACED_WARNING|payStandings|tiersForPay|scorecard-pay-db|crewEstimates|payoutSheet|\.reason\b.*rate|RANK_TIER|staff_rank|newHire|new hire/i.test(src(f)));
check("No staff page or staff API route reads a tier, a rank, a reason, or the new hire rate", leaks.length === 0, leaks.join(", "));
check("Staff estimates go through forStaff", (src("lib/team/pay-db.ts").match(/return forStaff\(staffEstimate\(/g) ?? []).length === 1);
check("The staff estimate card and My pay show the rate with rateSourceText only", src("app/team/pay-estimate-card.tsx").includes("rateSourceText({ source: e.rateSource") && src("app/team/pay/page.tsx").includes("rateSourceText({ source: r.rateSource"));

done("tier pay");
