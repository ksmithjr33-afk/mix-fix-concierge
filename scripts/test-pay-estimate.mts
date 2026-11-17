// Staff pay estimates: hours, mileage, tips, and who sees what.
// Run: node --no-warnings scripts/test-pay-estimate.mts

import { addDays, check, done, event, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const pay = await import("../lib/team/pay.ts");
const payDb = await import("../lib/team/pay-db.ts");
const settings = await import("../lib/team/business-settings.ts");
const settingsDb = await import("../lib/team/business-settings-db.ts");
const asgDb = await import("../lib/team/assignments-db.ts");

const today = time.todayIn("America/Chicago");
const S = pay.MILEAGE_DEFAULTS;

// ----- 1. Hours: setup + service + 1 hour breakdown, $30 default -----
const party = { event_date: today, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_type: "Birthday" };
const wedding = { ...party, event_type: "Wedding" };
check("4 hour event: 2 setup + 4 + 1 = 7 hours", pay.scheduledMinutes(party) === 420);
check("7 hours at the $30 default is $210", pay.payCents(pay.effectiveRate(null), pay.scheduledMinutes(party)) === 21000);
check("4 hour wedding: 3 setup + 4 + 1 = 8 hours = $240", pay.scheduledMinutes(wedding) === 480 && pay.payCents(pay.effectiveRate(null), 480) === 24000);
check("The wedding rule is the arrival time's rule", time.isWeddingEvent({ package: "Big Day Bar" }) && pay.scheduledMinutes({ ...party, package: "Big Day Bar" }) === 480);
check("The estimate uses scheduledMinutes, not a second calculation", src("lib/team/pay-db.ts").match(/scheduledMinutes\(eventData\(session\)\)/g)!.length >= 2 && !/BREAKDOWN_MIN|isWeddingEvent/.test(src("lib/team/pay-db.ts")));

// ----- 2. Mileage -----
check("20 miles one way: $0", JSON.stringify(pay.mileagePay(20, S, false)) === JSON.stringify({ paidMiles: 0, cents: 0 }));
check("21 one way: 22 paid miles = $6.60", JSON.stringify(pay.mileagePay(21, S, false)) === JSON.stringify({ paidMiles: 22, cents: 660 }));
check("50 one way: 80 paid miles = $24.00", JSON.stringify(pay.mileagePay(50, S, false)) === JSON.stringify({ paidMiles: 80, cents: 2400 }));
check("50 one way in California: $32.00", pay.mileagePay(50, S, true).cents === 3200);
check("Under the threshold: $0", pay.mileagePay(5.5, S, false).cents === 0);
const custom = { thresholdMiles: 10, deductionMiles: 0, rateCents: 50, caRateCents: 60 };
check("Settings change the math", pay.mileagePay(11, custom, false).cents === 1100);
check("No address", pay.mileageLine({ oneWayMiles: null, reason: "no_address", source: "straight_line", locked: false }, S, false).state === "no_address" && pay.NO_ADDRESS_TEXT === "Add your home address to see mileage");
const over = pay.mileageLine({ oneWayMiles: 50, source: "straight_line", locked: true, overrideMiles: 30, overrideNote: "Took the toll road", overrideByName: "Kenneth Smith" }, S, false);
check("An override of miles reruns the rule", over.state === "paid" && over.paidMiles === 40 && over.cents === 1200 && over.adjustedBy === "Kenneth Smith");
check("Overrides read 'adjusted by [name]'", pay.mileageText(over).endsWith("adjusted by Kenneth Smith"));
const amt = pay.mileageLine({ oneWayMiles: 50, source: "straight_line", locked: true, overrideCents: 1500, overrideNote: "Flat amount", overrideByName: "Pat" }, S, false);
check("An override of the amount wins", amt.state === "paid" && amt.cents === 1500);
const noAddrAmt = pay.mileageLine({ oneWayMiles: null, reason: "no_address", source: "straight_line", locked: true, overrideCents: 900, overrideByName: "Pat" }, S, false);
check("An amount can be set with no address on file", noAddrAmt.state === "paid" && noAddrAmt.cents === 900);
check("Straight line miles say so", pay.mileageText(pay.mileageLine({ oneWayMiles: 50, source: "straight_line", locked: true }, S, false)).includes("straight line"));
check("An override needs a note", !pay.validateMileageOverride({ miles: "30", note: "" }).ok && pay.validateMileageOverride({ miles: "30", note: "toll road" }).ok);
check("Blank override clears it", (() => { const v = pay.validateMileageOverride({}); return v.ok && v.clear; })());
check("Bad override numbers are refused", !pay.validateMileageOverride({ miles: "abc", note: "x y z" }).ok && !pay.validateMileageOverride({ amount: "-4", note: "x y z" }).ok);

// ----- 3. Tips -----
check("Gratuity split evenly among the bartenders", JSON.stringify(pay.tipsShare(300, 2, true)) === JSON.stringify({ state: "on_file", cents: 15000, bartenders: 2 }));
check("No gratuity on file", pay.tipsShare(null, 2, true).state === "not_on_file" && pay.tipsText(pay.tipsShare(undefined, 2, true)) === "Tips: not on file yet");
check("Bar backs and others get no tip share", pay.tipsShare(300, 2, false).state === "not_bartender");
const e1 = pay.staffEstimate({ rateOnFile: null, minutes: 420, mileage: pay.mileageLine({ oneWayMiles: 50, source: "straight_line", locked: true }, S, false), tips: pay.tipsShare(null, 1, true) });
check("Tips not on file are left out of the total", e1.totalCents === 21000 + 2400 && e1.rateIsDefault);
const e2 = pay.staffEstimate({ rateOnFile: 2500, minutes: 420, mileage: { state: "no_address" }, tips: pay.tipsShare(119, 1, true) });
check("Total is hourly + mileage + tips", e2.totalCents === 17500 + 11900);
check("The note is exact", pay.ESTIMATE_NOTE === "Estimate only. Final pay is based on your actual clock in and clock out, before taxes.");

// ----- Settings -----
check("Defaults: 20, 20, $0.30, $0.40", JSON.stringify(settings.readMileage(null)) === JSON.stringify({ thresholdMiles: 20, deductionMiles: 20, rateCents: 30, caRateCents: 40 }));
check("Settings form in dollars a mile", (() => { const v = settings.validateMileage({ thresholdMiles: "25", deductionMiles: "15", rate: "0.35", caRate: "0.45" }); return v.ok && v.value.rateCents === 35 && v.value.caRateCents === 45; })());
check("Bad settings refused", !settings.validateMileage({ thresholdMiles: "x", deductionMiles: "1", rate: "1", caRate: "1" }).ok);

// ----- From the database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const mgr = { id: "m1", name: "Pat Manager", phone: "+12145550101", role: "manager" as const, active: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const bb = { id: "bb", name: "Alex Back", phone: "+12145550113", role: "bar_back" as const, active: true };
const EVENT = { lat: 32.7767, lng: -96.797 };
const north = (miles: number) => ({ lat: EVENT.lat + miles / 69.0933, lng: EVENT.lng });
const ADDR = "1 Elm St, Dallas, TX";
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  const geo = { geo_address: ADDR, geo_lat: EVENT.lat, geo_lng: EVENT.lng, team_market: "dallas" };
  db.sessions = [
    event("f1", addDays(today, 5), ADDR, {}, { ...geo, booked_price: { total: 1800, gratuity: 300, bartenders: 2 } }),
    event("la", addDays(today, 6), ADDR, {}, { ...geo, team_market: "los_angeles", booked_price: { total: 1800, gratuity: null } }),
  ];
  db.staff = [admin, mgr, b1, b2, bb].map((s) => ({ ...s, markets: ["dallas", "los_angeles"] }));
  db.staff_pay_rates = [{ staff_id: "b2", hourly_rate_cents: 2500 }];
  db.staff_profiles = [
    { staff_id: "b1", home_address: "50 miles north", home_lat: north(50).lat, home_lng: north(50).lng },
    { staff_id: "b2", home_address: "21 miles north", home_lat: north(21).lat, home_lng: north(21).lng },
  ];
  db.event_assignments = [
    { id: "x1", session_id: "f1", staff_id: "b1", status: "offered" },
    { id: "x2", session_id: "f1", staff_id: "b2", status: "accepted" },
    { id: "x3", session_id: "f1", staff_id: "bb", status: "accepted" },
    { id: "x4", session_id: "la", staff_id: "b1", status: "accepted" },
  ];
  db.team_settings = [];
  db.assignment_mileage = [];
  db.shift_posts = [{ id: "post1", session_id: "la", market: "los_angeles", kind: "open", status: "posted" }];
}
reset();
const s = (id: string) => db.sessions.find((x) => x.id === id) as never;

const mine = await payDb.myPayEstimate("b1", s("f1"));
check("Hourly at the default $30: $210", mine.hourlyCents === 21000 && mine.rateIsDefault);
check("50 miles one way: $24.00 mileage", mine.mileage.state === "paid" && mine.mileage.cents === 2400 && mine.mileage.paidMiles === 80, JSON.stringify(mine.mileage));
check("Before accepting, the viewer is counted in the tips split", mine.tips.state === "on_file" && mine.tips.cents === 15000 && mine.tips.bartenders === 2, JSON.stringify(mine.tips));
check("Total adds them up", mine.totalCents === 21000 + 2400 + 15000);
const theirs = await payDb.myPayEstimate("b2", s("f1"));
check("Their own rate, 21 miles = $6.60", theirs.hourlyCents === 17500 && theirs.mileage.state === "paid" && theirs.mileage.cents === 660, JSON.stringify(theirs.mileage));
const back = await payDb.myPayEstimate("bb", s("f1"));
check("No home address: the profile prompt", back.mileage.state === "no_address" && back.tips.state === "not_bartender");
const la = await payDb.myPayEstimate("b1", s("la"));
check("Los Angeles market: California rate $32.00", la.mileage.state === "paid" && la.mileage.cents === 3200 && la.mileage.california);
check("No gratuity: not on file, left out of the total", la.tips.state === "not_on_file" && la.totalCents === 21000 + 3200);
const post = await payDb.myPayEstimateForPost("b2", "post1");
check("Open shifts show the full estimate", post !== null && post.mileage.state === "paid" && post.mileage.california);

// Settings an admin saves change the estimate; managers cannot save them.
check("A manager cannot change business settings", !(await settingsDb.saveBusinessSettings(mgr, "mileage", { thresholdMiles: "0", deductionMiles: "0", rate: "1", caRate: "1" })).ok);
check("An admin can", (await settingsDb.saveBusinessSettings(admin, "mileage", { thresholdMiles: "20", deductionMiles: "20", rate: "0.50", caRate: "0.40" })).ok);
check("Saved settings feed the estimate", (await payDb.myPayEstimate("b1", s("f1"))).mileage.state === "paid" && ((await payDb.myPayEstimate("b1", s("f1"))).mileage as { cents: number }).cents === 4000);
db.team_settings = [];

// Stored on accept, so it does not drift.
await asgDb.respondToAssignment("f1", b1 as never, "accept", "https://plan.test");
const stored = db.assignment_mileage.find((r) => r.assignment_id === "x1");
check("Accepting stores the miles on the assignment", stored?.one_way_miles === 50 && !!stored?.locked_at && stored?.miles_source === "straight_line", JSON.stringify(stored));
db.staff_profiles = db.staff_profiles.map((p) => (p.staff_id === "b1" ? { ...p, home_lat: north(5).lat, home_lng: north(5).lng } : p));
const after = await payDb.myPayEstimate("b1", s("f1"));
check("Moving home later does not change the stored miles", after.mileage.state === "paid" && after.mileage.oneWayMiles === 50 && after.mileage.locked);
check("Once on the event, the split counts the accepted bartenders", after.tips.state === "on_file" && after.tips.bartenders === 2);
await payDb.lockMileage("f1", "b1");
check("Locking again keeps the first number", db.assignment_mileage.filter((r) => r.assignment_id === "x1").length === 1 && db.assignment_mileage.find((r) => r.assignment_id === "x1")?.one_way_miles === 50);
await payDb.lockMileage("f1", "bb");
check("No address is stored as no address", db.assignment_mileage.find((r) => r.assignment_id === "x3")?.miles_reason === "no_address");

// Overrides: admins and managers, with a note.
check("A bartender cannot adjust mileage", !(await payDb.setMileageOverride(b2 as never, "f1", "b1", { miles: "10", note: "mine" })).ok);
check("An override needs a note", !(await payDb.setMileageOverride(mgr as never, "f1", "b1", { miles: "30" })).ok);
check("A manager can adjust mileage with a note", (await payDb.setMileageOverride(mgr as never, "f1", "b1", { miles: "30", note: "Shorter route" })).ok);
const adj = await payDb.myPayEstimate("b1", s("f1"));
check("The adjustment shows who made it", adj.mileage.state === "paid" && adj.mileage.cents === 1200 && adj.mileage.adjustedBy === "Pat Manager" && adj.mileage.note === "Shorter route");
check("Clearing the adjustment goes back to the stored miles", (await payDb.setMileageOverride(admin as never, "f1", "b1", {})).ok && ((await payDb.myPayEstimate("b1", s("f1"))).mileage as { cents: number }).cents === 2400);
check("Only people on the event can be adjusted", !(await payDb.setMileageOverride(admin as never, "f1", "b9", { miles: "3", note: "nobody" })).ok);

// Crew estimates are for admins and managers.
check("A bartender gets no crew estimates", (await payDb.crewEstimates(b1 as never, s("f1"))).length === 0);
const crew = await payDb.crewEstimates(mgr as never, s("f1"));
check("Managers see the crew estimates", crew.length === 3 && crew.find((c) => c.staffId === "b2")?.estimate.hourlyCents === 17500);

// ----- Who sees what (source checks) -----
check("The card is labeled and carries the note", ["Hourly (estimate)", "Mileage (estimate)", "Tips (estimate)", "Total (estimate)", "ESTIMATE_NOTE", "PROFILE_HREF"].every((t) => src("app/team/pay-estimate-card.tsx").includes(t)));
check("Staff pages only ask for their own estimate", src("app/team/shifts/[id]/page.tsx").includes("myPayEstimateForPost(staff.id, id)") && src("app/team/e/[id]/page.tsx").includes("myPayEstimate(staff.id, access.session)"));
check("The staff estimate carries no client price or booking total", !/booked|price|profit|cost|deposit|balance/i.test(src("app/team/pay-estimate-card.tsx")));
check("Mileage is read only in the pay module", ["lib", "app"].every(() => true) && !src("lib/team/assignments-db.ts").includes("assignment_mileage") && !src("lib/team/shifts-db.ts").includes("assignment_mileage"));
check("The override route is admins and managers", src("app/api/team/admin/mileage/route.ts").includes("!isAdminRole(staff.role)"));
check("The settings route is admins only", src("app/api/team/admin/business/settings/route.ts").includes("!isFullAdmin(staff.role)"));
check("Every accept path stores mileage", src("lib/team/assignments-db.ts").includes('if (response === "accept") await lockMileage') && (src("lib/team/shifts-db.ts").match(/await lockMileage\(/g) ?? []).length === 2);

done("pay estimate");
