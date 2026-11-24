// A role for each person on each event (Bartender, Barback, Event helper,
// Server): setting it on the Team tab, the counts by role, pay on service fee
// events, the role change text and rate floor, where staff and clients see it,
// and the $25 support rate. Gratuity model events pay exactly as before.
// Run: node --no-warnings scripts/test-event-roles.mts

import { addDays, check, done, event, src, texts } from "./team-harness.mts";

const { db, guards } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const roles = await import("../lib/team/event-roles.ts");
const pay = await import("../lib/team/pay.ts");
const payDb = await import("../lib/team/pay-db.ts");
const asgDb = await import("../lib/team/assignments-db.ts");
const events = await import("../lib/team/events.ts");
const fix = await import("../lib/team/staffing-fix.ts");
const fixDb = await import("../lib/team/staffing-fix-db.ts");
const home = await import("../lib/event-home-db.ts");
const payout = await import("../lib/team/payout.ts");
const payoutDb = await import("../lib/team/payout-db.ts");
const timesheetDb = await import("../lib/team/timesheet-db.ts");
const teamDb = await import("../lib/team/team-db.ts");
const teamLine = await import("../lib/team/team-line.ts");

// ----- The rules -----
check("Four roles: Bartender, Barback, Event helper, Server", JSON.stringify(roles.EVENT_ROLES.map((r) => roles.EVENT_ROLE_LABEL[r])) === JSON.stringify(["Bartender", "Barback", "Event helper", "Server"]));
check("Default from the profile: field roles keep theirs, admins and managers work as Bartender", roles.defaultEventRole("bar_back") === "bar_back" && roles.defaultEventRole("server") === "server" && roles.defaultEventRole("admin") === "bartender" && roles.defaultEventRole("manager") === "bartender" && roles.defaultEventRole(undefined) === "bartender");
check("The assignment's role wins over the profile", roles.eventRoleOf({ role: "bar_back" }, "bartender") === "bar_back" && roles.eventRoleOf({ role: null }, "server") === "server" && roles.eventRoleOf({ role: "nope" }, "bartender") === "bartender");
check("Staff line: \"You are working this event as: Barback.\"", roles.workingAsText("bar_back") === "You are working this event as: Barback.");
check("Role change text", roles.roleChangeText({ event: "Justin's 30th on 12/5", role: "event_helper" }) === "Your role on Justin's 30th on 12/5 changed to Event helper.");
const rc = roles.roleCounts({ bartender: 2, bar_back: 1, event_helper: 0, server: 2 }, [
  { status: "accepted", role: "bartender" },
  { status: "offered", role: "bar_back" },
  { status: "declined", role: "server" },
  { status: "accepted", role: "server" },
]);
const by = (r: string) => rc.find((c) => c.role === r)!;
check("Still needed is counted per role; declined never counts", by("bartender").stillNeeded === 1 && by("bar_back").stillNeeded === 0 && by("server").stillNeeded === 1 && by("event_helper").stillNeeded === 0);
check("Still needed text for other roles", roles.otherRolesStillNeeded(rc) === "1 server still needed");

// ----- The support rate -----
check("Support rate default is $25", pay.SUPPORT_RATE_CENTS === 2500 && pay.SERVICE_FEE_RATE_DEFAULTS.support === 2500);
const mig = src("supabase/migrations/20270106_assignment_roles.sql");
check("Migration: a saved support rate of 30 becomes 25, nothing else changes", /jsonb_set\(value, '\{support\}', '2500'::jsonb\)/.test(mig) && /\(value ->> 'support'\)::numeric = 3000/.test(mig) && /key = 'business_service_fee_rates'/.test(mig));
check("Migration: role column with the four roles, existing rows default from the profile", /add column if not exists role text check \(role is null or role in \('bartender', 'bar_back', 'event_helper', 'server'\)\)/.test(mig) && /else 'bartender' end/.test(mig) && /a\.role is null/.test(mig));
const rates = { ...pay.PACKAGE_RATE_DEFAULTS, serviceFee: pay.SERVICE_FEE_RATE_DEFAULTS };
check("Gratuity events: the role never changes the rate", ["bartender", "bar_back", "server", "event_helper"].every((role) => pay.lineRate(null, "Full Bar", rates, { model: "gratuity", role }).cents === 3000));

// ----- From the database -----
const today = time.todayIn("America/Chicago");
const ADDR = "1 Elm St, Dallas, TX";
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin", active: true };
const people = [
  { id: "t1", name: "Taylor Top", role: "bartender" },
  { id: "t2", name: "Tess Two", role: "bartender" },
  { id: "bk", name: "Bo Back", role: "bar_back" },
  { id: "sv", name: "Sid Server", role: "server" },
];
const past = (n: number) => `${addDays(today, -n)}T15:00:00Z`;
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  guards.length = 0;
  texts.length = 0;
  const geo = { geo_address: ADDR, geo_lat: 32.7767, geo_lng: -96.797, team_market: "dallas" };
  db.sessions = [
    event("sf", addDays(today, 5), ADDR, { package: "The Big Day Bar", event_type: "Wedding", bartenders: 2 }, { ...geo, pricing_model: "service_fee", booked_price: { total: 4000, pricing_model: "service_fee", bartenders: 2 } }),
    event("gr", addDays(today, 6), ADDR, { bartenders: 1 }, { ...geo, booked_price: { total: 1800, gratuity: 300, bartenders: 1 } }),
    event("old1", addDays(today, -20), ADDR, {}, { ...geo, booked_price: { total: 1800, gratuity: 300, bartenders: 1 } }),
    event("old2", addDays(today, -15), ADDR, {}, { ...geo, booked_price: { total: 1800, gratuity: 300, bartenders: 1 } }),
  ];
  db.staff = [admin, ...people.map((p) => ({ ...p, phone: `+1214555${p.id.charCodeAt(0)}${p.id.charCodeAt(1)}`.slice(0, 12), active: true }))].map((s) => ({ ...s, markets: ["dallas"] }));
  db.staff_pay_rates = [];
  db.staff_profiles = [];
  db.team_settings = [];
  db.assignment_mileage = [];
  db.event_assignments = [
    { id: "sf-t1", session_id: "sf", staff_id: "t1", status: "accepted", role: "bartender" },
    { id: "sf-t2", session_id: "sf", staff_id: "t2", status: "accepted", role: "bar_back" }, // a bartender working as a barback
    { id: "gr-t1", session_id: "gr", staff_id: "t1", status: "accepted", role: "bar_back" },
    // t2's only approved event was worked as a barback: it never counts toward the new hire count.
    { id: "old1-t2", session_id: "old1", staff_id: "t2", status: "accepted", role: "bar_back" },
    { id: "old1-t1", session_id: "old1", staff_id: "t1", status: "accepted", role: "bartender" },
  ];
  db.time_approvals = [
    { assignment_id: "old1-t2", staff_id: "t2", approved_by: "a1", approved_at: past(19) },
    { assignment_id: "old1-t1", staff_id: "t1", approved_by: "a1", approved_at: past(19) },
  ];
  db.staff_rank = [
    { staff_id: "t1", tier: "top", position: 1, placed: true },
    { staff_id: "t2", tier: "top", position: 2, placed: true },
  ];
  db.staff_rank_history = [];
}
reset();
const s = (id: string) => db.sessions.find((x) => x.id === id) as never;
const asgRow = (id: string) => db.event_assignments.find((a) => a.id === id) as Record<string, unknown>;
const crewOf = async (sid: string) => Object.fromEntries((await payDb.crewEstimates(admin as never, s(sid))).map((c) => [c.staffId, c]));

// Pay follows the role on the assignment.
let crew = await crewOf("sf");
check("Service fee: a bartender working as Barback gets the $25 support rate", crew.t2.estimate.rateCents === 2500 && crew.t2.estimate.reason === "support" && crew.t2.eventRole === "bar_back" && crew.t2.role === "bartender");
check("Service fee: Bartender role uses the tier rules (Top $45)", crew.t1.estimate.rateCents === 4500 && crew.t1.estimate.reason === "top");
const grCrew = await crewOf("gr");
check("Gratuity event: role recorded (Barback) but paid exactly as before: the $30 package rate and the bartender's tip share", grCrew.t1.eventRole === "bar_back" && grCrew.t1.estimate.rateCents === 3000 && grCrew.t1.estimate.tips.state === "on_file");
db.staff_pay_rates = [{ staff_id: "t2", hourly_rate_cents: 2800 }];
check("A personal rate still applies only when higher ($28 over the $25 support rate)", (await crewOf("sf")).t2.estimate.rateCents === 2800);
db.staff_pay_rates = [{ staff_id: "t2", hourly_rate_cents: 2200 }];
check("A lower personal rate is not used", (await crewOf("sf")).t2.estimate.rateCents === 2500);
db.staff_pay_rates = [];

// New hire count: only events worked as Bartender.
check("New hire count only counts Bartender events: a barback event leaves them a new hire", (await payDb.approvedEventCounts(["t1", "t2"])).get("t2") === 0 && (await payDb.approvedEventCounts(["t1", "t2"])).get("t1") === 1);
asgRow("sf-t2").role = "bartender";
crew = await crewOf("sf");
check("Working as Bartender with no Bartender events yet: the new hire rate ($30), whatever the tier", crew.t2.estimate.rateCents === 3000 && crew.t2.estimate.reason === "new_hire");
asgRow("sf-t2").role = "bar_back";

// Assigning with a role.
reset();
db.event_assignments = [];
const origin = "https://mixfix.test";
let r = await asgDb.assignStaff(s("sf"), "t1", admin as never, origin, { role: "event_helper", confirmUnavailable: true });
check("Assigning saves the picked role", r.ok && db.event_assignments.find((a) => a.staff_id === "t1")?.role === "event_helper");
r = await asgDb.assignStaff(s("sf"), "bk", admin as never, origin, { confirmUnavailable: true });
check("No role picked: the default from the profile (Barback)", r.ok && db.event_assignments.find((a) => a.staff_id === "bk")?.role === "bar_back");
r = await asgDb.assignStaff(s("sf"), "t2", admin as never, origin, { role: "chef", confirmUnavailable: true });
check("An unknown role is refused", !r.ok && r.status === 400);
// Before the migration: assigning still works, without the role.
const hasRole = (x: unknown) => !!x && typeof x === "object" && (Array.isArray(x) ? x.some((y) => "role" in y) : "role" in (x as object));
guards.push((table, op, rows, patch) => (table === "event_assignments" && (op === "upsert" || op === "update" || op === "insert") && (hasRole(rows) || hasRole(patch)) ? 'column "role" of relation "event_assignments" does not exist' : null));
r = await asgDb.assignStaff(s("sf"), "sv", admin as never, origin, { role: "server", confirmUnavailable: true });
check("Before the migration: assigning still works (saved without the role)", r.ok && !!db.event_assignments.find((a) => a.staff_id === "sv") && db.event_assignments.find((a) => a.staff_id === "sv")?.role === undefined);
const notReady = await asgDb.setAssignmentRole(s("sf"), "sv", "bar_back");
check("Before the migration: a role change says to run it", !notReady.ok && notReady.status === 503 && /20270106_assignment_roles\.sql/.test(notReady.error));
guards.length = 0;

// Counts by role: Bartenders needed counts only Bartender rows.
reset();
db.event_assignments = [
  { id: "sf-t1", session_id: "sf", staff_id: "t1", status: "accepted", role: "bartender" },
  { id: "sf-bk", session_id: "sf", staff_id: "bk", status: "accepted", role: "bar_back" },
  { id: "sf-sv", session_id: "sf", staff_id: "sv", status: "offered", role: "server" },
];
const counts = (await asgDb.staffingByEvent([s("sf")])).get("sf")!;
check("Bartenders still needed ignores barbacks and servers (2 needed, 1 bartender: 1 still needed)", counts.needed === 2 && counts.assigned === 1 && counts.stillNeeded === 1);
const progress = await asgDb.assigneeProgress(s("sf"));
check("Assigned list carries the role on the event", progress.find((p) => p.staffId === "bk")?.eventRole === "bar_back" && progress.find((p) => p.staffId === "sv")?.eventRole === "server");
check("Barbacks default to 1 on a package with a barback; helpers and servers 0", JSON.stringify(fix.roleNeeded(s("sf"), true)) === JSON.stringify({ bar_back: 1, event_helper: 0, server: 0 }) && fix.roleNeeded(s("gr"), false).bar_back === 0);
let fr = await fixDb.setRoleNeeded("sf", admin as never, "server", 2);
check("Servers needed saves (staffing only) and is logged", fr.ok && fix.roleNeeded(s("sf"), true).server === 2 && fix.staffingLog(s("sf"))[0]?.text === "Servers needed set to 2");
fr = await fixDb.setRoleNeeded("sf", admin as never, "server", 7);
check("Needed counts are 0 to 4", !fr.ok && fr.status === 400);
fr = await fixDb.setRoleNeeded("sf", { ...admin, role: "bartender" } as never, "server", 1);
check("Only admins and managers set needed counts", !fr.ok && fr.status === 403);
fr = await fixDb.setRoleNeeded("sf", { ...admin, role: "manager" } as never, "event_helper", 1);
check("A manager can set them", fr.ok && fix.roleNeeded(s("sf"), true).event_helper === 1);
const page = src("app/team/admin/e/[id]/page.tsx");
check("Barback line clears when someone holds the Barback role", page.includes('!people.some((p) => p.eventRole === "bar_back" && p.status !== "declined")'));
check("Team tab: Barbacks, Event helpers and Servers needed next to Bartenders needed", src("app/team/admin/e/[id]/bartenders-needed.tsx").includes("data-role-needed") && page.includes("`${EVENT_ROLE_PLURAL[r]} needed`"));
check("Team tab: pick the role when assigning and on the assigned list", src("app/team/admin/e/[id]/assign-panel.tsx").includes("data-assign-role") && src("app/team/admin/e/[id]/assign-panel.tsx").includes("data-event-role") && src("app/api/team/admin/assign/route.ts").includes("export async function PATCH"));

// Events list line: bartender spots count only Bartender rows.
const teams = await teamDb.teamsByEvent(["sf"]);
const line = teamLine.teamLine(teams.get("sf") ?? [], { bartenders: 2, barback: true }, {});
check("Events list: 1 bartender still needed, barback held", line?.needed === "1 bartender still needed", JSON.stringify(line));

// Ranked offers and open shifts fill Bartender spots only.
check("Ranked offers assign as Bartender and count Bartender spots only", src("lib/team/offers-db.ts").includes('role: "bartender" });') && src("lib/team/scorecard-offers-db.ts").includes("return bartenderRows(await assignmentsWithRoles(sessionId));"));
check("Open shifts are Bartender spots; a handoff keeps the original role", src("lib/team/shifts-db.ts").includes('assigned_by: admin.id, role: "bartender" });') && src("lib/team/shifts-db.ts").includes("role: original.role });"));
check("Assigning someone in another role takes no offer spot", src("lib/team/assignments-db.ts").includes('if (role === "bartender") await handAssigned(session.id, staffId);'));

// Changing a role after someone accepted.
reset();
await payDb.lockAcceptedRate("sf", "t1");
check("Accepted as Bartender: the floor is the Top rate ($45)", asgRow("sf-t1").accepted_rate_cents === 4500);
texts.length = 0;
r = await asgDb.setAssignmentRole(s("sf"), "t1", "bar_back");
const t1Phone = (db.staff.find((x) => x.id === "t1") as { phone: string }).phone;
check("Role change texts the person", r.ok && texts.some((t) => t.phone === t1Phone && /^Your role on .+ changed to Barback\.$/.test(t.message)), JSON.stringify(texts));
check("After a role change the floor is the new role's rate at the time of the change ($25)", asgRow("sf-t1").accepted_rate_cents === 2500 && asgRow("sf-t1").role === "bar_back");
check("And pay follows it: $25 support, not the old $45 floor", (await crewOf("sf")).t1.estimate.rateCents === 2500);
texts.length = 0;
await asgDb.setAssignmentRole(s("sf"), "t1", "bar_back");
check("Setting the same role again sends nothing", texts.length === 0);
r = await asgDb.setAssignmentRole(s("gr"), "t1", "server");
check("Gratuity event: the role changes and no rate is stored", r.ok && asgRow("gr-t1").role === "server" && asgRow("gr-t1").accepted_rate_cents === undefined);
db.event_assignments.push({ id: "sf-sv", session_id: "sf", staff_id: "sv", status: "offered", role: "server" });
texts.length = 0;
r = await asgDb.setAssignmentRole(s("sf"), "sv", "event_helper");
check("Offered, not accepted yet: the role changes with no text", r.ok && texts.length === 0 && asgRow("sf-sv").role === "event_helper");
r = await asgDb.setAssignmentRole(s("sf"), "nobody", "server");
check("Someone not on the event: refused", !r.ok && r.status === 404);

// Where it shows.
reset();
const view = await events.eventPageData(s("sf"), { id: "t2", name: "Tess Two", role: "bartender", phone: "", active: true } as never);
check("Staff event page: their own role", view.view.workingAs === "You are working this event as: Barback.");
check("Also working: first names with roles", JSON.stringify(view.view.teammates) === JSON.stringify(["Taylor (Bartender)"]), JSON.stringify(view.view.teammates));
check("The offer and event page show the line", src("app/team/offer/[id]/page.tsx").includes('workingAsText("bartender")') && src("app/team/e/[id]/respond-banner.tsx").includes("data-working-as") && src("app/team/e/[id]/event-details.tsx").includes("data-working-as"));
const bar = await home.homeTeam("sf");
check("Client bar team: first names with roles", JSON.stringify(bar) === JSON.stringify([{ name: "Taylor", role: "Bartender" }, { name: "Tess", role: "Barback" }]) || JSON.stringify(bar) === JSON.stringify([{ name: "Tess", role: "Barback" }, { name: "Taylor", role: "Bartender" }]), JSON.stringify(bar));
const sheet = await payoutDb.payoutSheet(admin as never, s("sf"));
check("Payout card: the role worked on the event", sheet?.rows.find((x) => x.staffId === "t2")?.eventRole === "bar_back" && src("app/team/admin/payout-card.tsx").includes("eventRoleLabel(r.eventRole)"));
const tsRows = await timesheetDb.eventTimesheetRows("sf");
check("Timesheets: the role worked on the event", tsRows.find((x) => x.staffId === "t2")?.eventRole === "bar_back" && src("app/team/admin/timesheets/timesheet-week.tsx").includes("eventRoleLabel(row.eventRole)"));
check("Payroll: the role worked on each line", src("lib/team/payroll.ts").includes("eventRole: p.eventRole,") && src("app/team/admin/payroll/payroll-board.tsx").includes("eventRoleLabel(l.eventRole)"));
const anyEstimate = (await payDb.crewEstimates(admin as never, s("sf")))[0].estimate;
const prow = payout.payoutRow({ staffId: "x", assignmentId: "y", name: "X", role: "bar_back", estimate: anyEstimate, sheet: null });
check("A payout row with no event role falls back to the profile's", prow.eventRole === "bar_back");

// Privacy: staff see their own role and pay, never a tier or anyone else's pay.
const LEAK = /"reason"|rateStored|new.?hire|\btier\b|\brank\b|"top"|"core"|"developing"|\bTop\b|\bCore\b|Developing/i;
const mine = await payDb.myPayEstimate("t2", s("sf"));
check("Staff estimate: the support rate and nothing about why", mine.rateCents === 2500 && !LEAK.test(JSON.stringify(mine)), JSON.stringify(mine));
check("Staff event view: no tier, rank or pay", !LEAK.test(JSON.stringify(view.view)) && !/rateCents|\$\d/.test(JSON.stringify(view.view.teammates)));

done("event role");
