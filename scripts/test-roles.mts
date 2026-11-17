// Staff types: admin, manager, bartender, bar back, server, event helper.
// Managers do everything an admin does except deactivate an admin, change an
// admin's role, or make someone an admin (on the server). Bar back, server and
// event helper get the bartender experience with their role shown.
// Run: node --no-warnings scripts/test-roles.mts

import { check, done, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const roles = await import("../lib/team/roles.ts");
const asg = await import("../lib/team/assignments.ts");
const asgDb = await import("../lib/team/assignments-db.ts");
const events = await import("../lib/team/events.ts");
const view = await import("../lib/team/view-mode.ts");

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const alex = { id: "m1", name: "Alex Rivera", phone: "+12145550101", role: "manager" as const, active: true, alerts: true };
const taylor = { id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender" as const, active: true, alerts: true };
const sam = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bar_back" as const, active: true, alerts: true };
const pat = { id: "b3", name: "Pat Lee", phone: "+12145550113", role: "server" as const, active: true, alerts: true };
const jo = { id: "b4", name: "Jo Kim", phone: "+12145550114", role: "event_helper" as const, active: true, alerts: true };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [admin, alex, taylor, sam, pat, jo].map((s) => ({ ...s, markets: ["dallas"] }));
  db.staff_sessions = [];
}
const row = (id: string) => db.staff.find((s) => s.id === id) as Record<string, unknown>;

// ----- The roles -----
check("Six roles", roles.ROLES.join() === "admin,manager,bartender,bar_back,server,event_helper");
check("Admins and managers are the admin side; the rest are not", roles.isAdminRole("admin") && roles.isAdminRole("manager") && !["bartender", "bar_back", "server", "event_helper"].some(roles.isAdminRole));
check("Only admins are full admins", roles.isFullAdmin("admin") && !roles.isFullAdmin("manager"));
check("Bar back, server and event helper get the bartender experience", ["bartender", "bar_back", "server", "event_helper"].every(roles.isFieldRole) && !roles.isFieldRole("manager"));
check("Role labels", roles.roleLabel("bar_back") === "Bar back" && roles.roleLabel("event_helper") === "Event helper" && roles.roleLabel("manager") === "Manager");
check("The role after a name for everyone but bartenders", roles.roleSuffix("bar_back") === " (bar back)" && roles.roleSuffix("server") === " (server)" && roles.roleSuffix("bartender") === "");
const norm = (v: unknown) => (String(v).replace(/\D/g, "").length === 10 ? `+1${String(v).replace(/\D/g, "")}` : null);
check("The staff form accepts every role", roles.ROLES.every((r) => { const v = asg.validateStaffInput({ first: "A", last: "B", phone: "2145550199", role: r, markets: ["dallas"] }, norm); return v.ok && v.value.role === r; }));
check("and refuses anything else", !asg.validateStaffInput({ first: "A", last: "B", phone: "2145550199", role: "owner", markets: ["dallas"] }, norm).ok);

// ----- Manager limits, on the server -----
check("Rule: a manager cannot make someone an admin", asg.managerLimitError("manager", "bartender", { role: "admin" }) !== null && asg.managerLimitError("manager", null, { role: "admin" }) !== null);
check("Rule: a manager cannot change an admin's role or deactivate an admin", asg.managerLimitError("manager", "admin", { role: "manager" }) !== null && asg.managerLimitError("manager", "admin", { active: false }) !== null);
check("Rule: an admin can do all of it", asg.managerLimitError("admin", "admin", { role: "manager", active: false }) === null && asg.managerLimitError("admin", null, { role: "admin" }) === null);
reset();
const deact = await asgDb.updateStaff(alex, "a1", { active: false });
check("A manager cannot deactivate an admin", !deact.ok && row("a1").active === true, deact.ok ? "" : deact.error);
const demote = await asgDb.updateStaff(alex, "a1", { first: "Kenneth", last: "Smith", phone: "2145550100", role: "bartender", markets: ["dallas"] });
check("A manager cannot change an admin's role", !demote.ok && row("a1").role === "admin");
const promote = await asgDb.updateStaff(alex, "b1", { first: "Taylor", last: "Brooks", phone: "2145550111", role: "admin", markets: ["dallas"] });
check("A manager cannot make someone an admin", !promote.ok && row("b1").role === "bartender");
const addAdmin = await asgDb.createStaff({ first: "New", last: "Admin", phone: "2145550177", role: "admin", markets: ["dallas"] }, alex);
check("A manager cannot add an admin", !addAdmin.ok && !db.staff.some((s) => s.phone === "+12145550177"));
const rename = await asgDb.updateStaff(alex, "a1", { first: "Ken", last: "Smith", phone: "2145550100", role: "admin", markets: ["dallas"] });
check("A manager can still edit an admin's name with the role unchanged", rename.ok && row("a1").name === "Ken Smith" && row("a1").role === "admin");
const toBarBack = await asgDb.updateStaff(alex, "b1", { first: "Taylor", last: "Brooks", phone: "2145550111", role: "bar_back", markets: ["dallas"] });
check("A manager can change a bartender to bar back", toBarBack.ok && row("b1").role === "bar_back");
const toManager = await asgDb.updateStaff(alex, "b3", { first: "Pat", last: "Lee", phone: "2145550113", role: "manager", markets: ["dallas"] });
check("A manager can make someone a manager", toManager.ok && row("b3").role === "manager");
const offHelper = await asgDb.updateStaff(alex, "b4", { active: false });
check("A manager can deactivate staff who are not admins", offHelper.ok && row("b4").active === false);
const addServer = await asgDb.createStaff({ first: "New", last: "Server", phone: "2145550178", role: "server", markets: ["dallas"] }, alex);
check("A manager can add a server", addServer.ok && db.staff.some((s) => s.phone === "+12145550178" && s.role === "server"));
reset();
const adminDemote = await asgDb.updateStaff(admin, "m1", { first: "Alex", last: "Rivera", phone: "2145550101", role: "bartender", markets: ["dallas"] });
const adminMakes = await asgDb.updateStaff(admin, "b1", { first: "Taylor", last: "Brooks", phone: "2145550111", role: "admin", markets: ["dallas"] });
check("An admin can change roles and make admins", adminDemote.ok && adminMakes.ok && row("m1").role === "bartender" && row("b1").role === "admin");
reset();
check("Nobody changes their own role or deactivates themselves", !(await asgDb.updateStaff(alex, "m1", { first: "Alex", last: "Rivera", phone: "2145550101", role: "admin", markets: ["dallas"] })).ok && !(await asgDb.updateStaff(alex, "m1", { active: false })).ok && row("m1").role === "manager");
check("The staff route passes who is asking", src("app/api/team/admin/staff/route.ts").includes("createStaff(body, a.staff)") && src("app/api/team/admin/staff/route.ts").includes("updateStaff(a.staff, id, patch)"));
const sm = src("app/team/admin/staff/staff-manager.tsx");
check("The staff form has every role, and managers never see Admin or edit an admin's role", sm.includes("ROLES.filter((r) => isFullAdmin(viewerRole) || r !== \"admin\" || initial.role === \"admin\")") && sm.includes("disabled={!isFullAdmin(viewerRole) && initial.role === \"admin\"}"));
check("Managers get no Deactivate button on an admin", sm.includes('!(s.role === "admin" && !isFullAdmin(viewerRole))'));
check("The staff list shows each role and filters by role", sm.includes("{roleLabel(s.role)}") && sm.includes('aria-label="Filter by role"') && sm.includes("!roleFilter || s.role === roleFilter"));

// ----- Managers get the admin side -----
check("Managers get the admin pages and routes (requireAdmin)", src("lib/team/auth.ts").includes('if (!isAdminRole(staff.role)) redirect("/team/events")'));
check("Managers get the admin header", src("app/team/team-header.tsx").includes("const showAdmin = admin && !bartenderView && isAdminRole(viewed?.role);"));
reset();
db.staff.push({ id: "m2", name: "Off Manager", phone: "+12145550102", role: "manager", active: false, alerts: true });
const alerted = (await events.alertAdmins()).map((s) => s.id).sort().join();
check("Admin texts and alerts go to admins and managers (active, alerts on)", alerted === "a1,m1", alerted);
check("Managers can use Bartender view", view.applyViewMode(alex, "bartender").role === "bartender" && view.applyViewMode(alex, "bartender").bartenderView === true);
check("Bartender view never raises anyone", view.applyViewMode(sam, "bartender").bartenderView === undefined);
check("ADMIN_PHONES still adds admins", src("lib/team/auth.ts").includes('.insert({ name: "", phone, role: "admin", active: true })'));
check("Admins only checks across the app use the shared helper", !/role (===|!==) "admin"/.test(["app/api/team/admin/assign/route.ts", "app/api/team/admin/event-edit/route.ts", "lib/team/approved-menu-db.ts", "lib/team/chat-db.ts", "lib/team/events.ts"].map(src).join("\n")));

// ----- Bar back, server, event helper -----
reset();
db.sessions = [{ id: "s1", status: "submitted", version: 1, event_date: "2026-12-05", event_data: { client_name: "Justin Reyes", event_type: "Birthday", event_date: "2026-12-05" } }];
db.event_assignments = [
  { id: "as1", session_id: "s1", staff_id: "b1", status: "accepted" },
  { id: "as2", session_id: "s1", staff_id: "b2", status: "accepted" },
  { id: "as3", session_id: "s1", staff_id: "b3", status: "accepted" },
  { id: "as4", session_id: "s1", staff_id: "b4", status: "offered" },
];
for (const s of [sam, pat, jo]) {
  const access = await events.openEvent("s1", s as never);
  check(`A ${roles.roleLabel(s.role).toLowerCase()} on the event opens the staff event page`, access.ok);
}
const opened = await events.openEvent("s1", taylor as never);
const mates = opened.ok ? await events.eventPageData(opened.session, taylor as never) : null;
const tm = mates?.view.teammates ?? [];
check("The event team list shows each role after the name", tm.includes("Sam (bar back)") && tm.includes("Pat (server)") && tm.includes("Jo (event helper)"), tm.join(", "));
const ap = src("app/team/admin/e/[id]/assign-panel.tsx");
check("The assign panel shows the role after each name and filters by role", ap.includes("{roleSuffix(s.role)}") && ap.includes("{roleSuffix(p.role) &&") && ap.includes('aria-label="Filter by role"') && ap.includes("pickable.map((s) => ("));

// ----- The migration -----
const sql = src("supabase/migrations/20261206_staff_roles.sql");
check("The migration allows the six roles and is safe to run twice", sql.includes("drop constraint if exists staff_role_check") && sql.includes("check (role in ('admin', 'manager', 'bartender', 'bar_back', 'server', 'event_helper'))"));
check("Managers can reopen a timesheet row in the database too", sql.includes("role in ('admin', 'manager') and active"));

done("staff role");
