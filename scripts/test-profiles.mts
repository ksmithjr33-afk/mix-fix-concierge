// Staff profiles: the fields and their checks, who can see home address and
// email (admins and the person only), who can edit, the one time prompt after
// sign in, Food Handler next to TABC, expiry alerts at 30 days, 7 days and the
// day to admins and the bartender (quiet hours kept), the Staff page glance
// and CSV, and the distance warning on the assign panel that never blocks.
// Run: node --no-warnings scripts/test-profiles.mts

import { check, done, event, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const pr = await import("../lib/team/profile.ts");
const prDb = await import("../lib/team/profile-db.ts");
const certsDb = await import("../lib/team/certs-db.ts");
const asgDb = await import("../lib/team/assignments-db.ts");
const cfg = await import("../lib/team/cert-config.ts");

const CT = "America/Chicago";
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const admin2 = { id: "a2", name: "Pat Jones", phone: "+12145550102", role: "admin" as const, active: true, alerts: true };
const taylor = { id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender" as const, active: true };
const sam = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const adminAsBartender = { ...admin, role: "bartender" as const };
const today = "2026-11-12";
const morning = time.zonedInstant(today, 10 * 60, CT);
const plus = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const cert = (o: Record<string, unknown>) => ({
  id: String(o.id),
  staff_id: "b1",
  cert_type: "TABC",
  file_path: `certs/${o.staff_id ?? "b1"}/x.pdf`,
  file_type: "application/pdf",
  expires_on: plus(200),
  status: "approved",
  review_note: null,
  reviewed_by: "a1",
  reviewed_at: "2026-01-01T00:00:00Z",
  uploaded_by: "b1",
  created_at: "2026-01-01T00:00:00Z",
  ...o,
});

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [
    { ...admin, markets: ["dallas"] },
    { ...admin2, markets: ["dallas"] },
    { ...taylor, markets: ["dallas"] },
    { ...sam, markets: ["dallas", "austin"] },
  ];
  db.sessions = [event("e1", "2026-12-05", "500 Congress Ave, Austin, TX", {}, { team_market: "austin" }), event("e2", "2026-12-06", "1 Elm St, Dallas, TX", {}, { team_market: "dallas" })];
  for (const t of ["staff_profiles", "staff_certifications", "event_assignments", "team_notices", "team_hidden_events", "staff_unavailability", "team_settings", "shift_posts", "shift_requests", "shift_handoffs", "staff_checks", "staff_confirmations", "time_punches"]) db[t] = [];
  texts.length = 0;
}
const FULL = { first: "Taylor", last: "Brooks", email: "Taylor@Example.com", home_address: "100 Elm St, Dallas, TX 75201", dropoff_time: "Weekday evenings", max_miles: "30" };

// ----- 1. Fields -----
reset();
check("Email is checked", !pr.cleanProfile({ email: "not an email" }).ok && pr.cleanProfile({ email: "a@b.co" }).ok);
check("Max distance is 1 to 500 miles", !pr.cleanProfile({ max_miles: "0" }).ok && !pr.cleanProfile({ max_miles: "900" }).ok && !pr.cleanProfile({ max_miles: "far" }).ok && pr.cleanProfile({ max_miles: "45" }).ok);
check("Blank fields are allowed and show as missing", pr.cleanProfile({}).ok);
const saved = await prDb.saveProfile(taylor, "b1", FULL, morning);
const row = () => db.staff_profiles.find((r) => r.staff_id === "b1") as Record<string, unknown>;
check("A bartender saves their own profile", saved.ok && row().email === "taylor@example.com" && row().home_address === "100 Elm St, Dallas, TX 75201" && row().dropoff_time === "Weekday evenings" && row().max_miles === 30);
check("Saving the home address stores its map location", Math.abs(Number(row().home_lat) - 32.7767) < 0.001 && Math.abs(Number(row().home_lng) + 96.797) < 0.001 && !!row().home_geocoded_at);
check("Name changes save to the staff record", (await prDb.saveProfile(taylor, "b1", { ...FULL, first: "Tay" }, morning)).ok && db.staff.find((s) => s.id === "b1")!.name === "Tay Brooks");
await prDb.saveProfile(taylor, "b1", { ...FULL, home_address: "Somewhere Nobody Knows 99999" }, morning);
check("An address the map cannot find still saves, with no location", row().home_address === "Somewhere Nobody Knows 99999" && row().home_lat === null);
await prDb.saveProfile(taylor, "b1", FULL, morning);
check("A bartender cannot change their phone here (it is the sign in)", (await prDb.saveProfile(taylor, "b1", { ...FULL, phone: "+19995550000" }, morning)).ok && db.staff.find((s) => s.id === "b1")!.phone === taylor.phone);
check("A bartender cannot edit someone else's profile", !(await prDb.saveProfile(taylor, "b2", { email: "x@y.co" }, morning)).ok && !db.staff_profiles.some((r) => r.staff_id === "b2"));
check("An admin in Bartender view cannot edit someone else's", !(await prDb.saveProfile(adminAsBartender, "b2", { email: "x@y.co" }, morning)).ok);
check("An admin can edit any profile", (await prDb.saveProfile(admin, "b2", { email: "sam@example.com", max_miles: 20, home_address: "1 Main St, Houston, TX" }, morning)).ok && db.staff_profiles.find((r) => r.staff_id === "b2")!.email === "sam@example.com");

// ----- 2. Who sees home address and email -----
const own = await prDb.viewProfile(taylor, "b1", morning);
check("The person sees their own address and email", own?.view.email === "taylor@example.com" && own.view.homeAddress === "100 Elm St, Dallas, TX 75201");
const byAdmin = await prDb.viewProfile(admin, "b1", morning);
check("Admins see address and email", byAdmin?.view.email === "taylor@example.com" && byAdmin.view.homeAddress === "100 Elm St, Dallas, TX 75201");
const bySam = await prDb.viewProfile(sam, "b1", morning);
check("Other bartenders never see address or email", bySam !== null && bySam.view.email === null && bySam.view.homeAddress === null && !JSON.stringify(bySam).includes("Elm St") && !JSON.stringify(bySam).includes("taylor@example"));
const byView = await prDb.viewProfile(adminAsBartender, "b1", morning);
check("An admin in Bartender view does not see them either", byView?.view.email === null && byView.view.homeAddress === null);
check("Staff lists never carry profile fields", !src("lib/team/assignments-db.ts").includes("staff_profiles"));
check("The Staff page overview and CSV are admins only", Object.keys(await prDb.staffOverview(taylor, db.staff as never, morning)).length === 0 && (await prDb.staffCsv(taylor, morning)) === null);

// ----- 3. Completeness and the prompt after sign in -----
reset();
const empty = await prDb.viewProfile(taylor, "b1", morning);
check("Certificates on a profile: TABC and Food Handler at minimum", cfg.profileCertTypes(["dallas"]).join(",") === "TABC,Food Handler" && empty?.certTypes.join(",") === "TABC,Food Handler");
check("Los Angeles needs California RBS and Food Handler", cfg.profileCertTypes(["los_angeles"]).join(",") === "California RBS,Food Handler");
check("An empty profile lists what is missing", empty?.missing.join(",") === "Email,Home address,Drop off time,Farthest you will drive,TABC,Food Handler" && empty.done === 2 && empty.total === 8);
const goTo = await prDb.profilePromptPath("b1", "/team/events", morning);
check("A bartender with gaps is sent to their profile once after sign in", goTo === "/team/me/profile?first=1&next=%2Fteam%2Fevents");
check("Only once", (await prDb.profilePromptPath("b1", "/team/events", morning)) === null);
check("Admins are not asked", (await prDb.profilePromptPath("a1", "/team/events", morning)) === null);
await prDb.saveProfile(sam, "b2", { email: "s@x.co", home_address: "1 Main St, Houston, TX", dropoff_time: "Any time", max_miles: 40 }, morning);
db.staff_certifications = [cert({ id: "t2", staff_id: "b2" }), cert({ id: "f2", staff_id: "b2", cert_type: "Food Handler" })];
check("A complete profile is not asked", (await prDb.profilePromptPath("b2", "/team/events", morning)) === null && (await prDb.viewProfile(sam, "b2", morning))?.missing.length === 0);
check("The sign in route asks for the prompt and never blocks", src("app/api/team/verify-code/route.ts").includes("profilePromptPath(result.staffId") && src("app/api/team/verify-code/route.ts").includes(".catch(() => null)"));
check("The Me page links to the profile", src("app/team/me/page.tsx").includes('"/team/me/profile"'));

// ----- 4. Certificates: Food Handler uses the existing feature, enforcement stays off -----
reset();
check("Food Handler is an accepted certificate", cfg.CERT_TYPES.includes("Food Handler"));
check("Enforcement stays off by default", (await certsDb.certsEnforced()) === false);
db.staff_certifications = [cert({ id: "t1" })]; // TABC only
check("A missing Food Handler never blocks shift requests", (await certsDb.requestGate("b1", "dallas", morning)).blocked === false);
check("The migration allows Food Handler", src("supabase/migrations/20261201_approved_menu_profiles_chat_media.sql").includes("'Food Handler'"));

// ----- 5. Expiry alerts: 30 days, 7 days, the day; admins and the bartender, once each -----
reset();
db.staff_certifications = [cert({ id: "c30", expires_on: plus(23) }), cert({ id: "fh", cert_type: "Food Handler", expires_on: plus(300) })];
await certsDb.sendCertReminders(morning);
check("Inside 30 days: the bartender gets one text", textsTo(taylor).length === 1 && textsTo(taylor)[0].message.includes("TABC certification expires in 23 days"));
check("Inside 30 days: each admin gets one text", textsTo(admin).length === 1 && textsTo(admin2).length === 1 && textsTo(admin)[0].message.includes("Taylor Brooks's TABC certification expires in 23 days"));
await certsDb.sendCertReminders(new Date(morning.getTime() + 3_600_000));
await certsDb.sendCertReminders(time.zonedInstant(plus(1), 10 * 60, CT));
check("Only once at the 30 day step", textsTo(taylor).length === 1 && textsTo(admin).length === 1);
texts.length = 0;
db.staff_certifications = [cert({ id: "c30", expires_on: plus(7) })];
await certsDb.sendCertReminders(morning);
await certsDb.sendCertReminders(new Date(morning.getTime() + 7_200_000));
check("At 7 days: once more to the bartender and the admins", textsTo(taylor).length === 1 && textsTo(taylor)[0].message.includes("expires in 7 days") && textsTo(admin).length === 1 && textsTo(admin2).length === 1);
texts.length = 0;
db.staff_certifications = [cert({ id: "c30", expires_on: today })];
await certsDb.sendCertReminders(time.zonedInstant(today, 22 * 60, CT));
check("Quiet hours: nothing at 10 PM", texts.length === 0);
await certsDb.sendCertReminders(time.zonedInstant(today, 7 * 60 + 50, CT));
check("Quiet hours: nothing at 7:50 AM", texts.length === 0);
await certsDb.sendCertReminders(morning);
await certsDb.sendCertReminders(new Date(morning.getTime() + 600_000));
check("On the day: once to the bartender and the admins", textsTo(taylor).length === 1 && textsTo(taylor)[0].message.includes("expires today") && textsTo(admin).length === 1 && textsTo(admin2).length === 1);
texts.length = 0;
db.staff_certifications = [cert({ id: "fh2", cert_type: "Food Handler", expires_on: plus(30) })];
await certsDb.sendCertReminders(morning);
check("Food Handler gets the same alerts", textsTo(taylor).length === 1 && textsTo(taylor)[0].message.includes("Food Handler certification expires in 30 days") && textsTo(admin).length === 1);
texts.length = 0;
db.staff_certifications = [cert({ id: "c31", expires_on: plus(31) })];
await certsDb.sendCertReminders(morning);
check("Nothing at 31 days", texts.length === 0);
db.staff_certifications = [cert({ id: "old", expires_on: plus(5) }), cert({ id: "new", expires_on: plus(400), created_at: "2026-11-01T00:00:00Z" })];
await certsDb.sendCertReminders(morning);
check("Nothing once a renewed certificate is on file", texts.length === 0);

// ----- 6. The Staff page: labels, filter, glance, CSV -----
check("Inside 30 days reads 'expires in 23 days' in amber", JSON.stringify(pr.expiryLabel(plus(23), today)) === JSON.stringify({ text: "expires in 23 days", tone: "amber" }));
check("Past the date reads 'expired' in red", JSON.stringify(pr.expiryLabel(plus(-1), today)) === JSON.stringify({ text: "expired", tone: "red" }));
check("Far off is fine", pr.expiryLabel(plus(90), today).tone === "ok");
reset();
await prDb.saveProfile(admin, "b1", FULL, morning);
db.staff_certifications = [cert({ id: "t1", expires_on: plus(23) }), cert({ id: "f1", cert_type: "Food Handler", expires_on: plus(-3), status: "approved" })];
const ov = await prDb.staffOverview(admin, db.staff as never, morning);
check("At a glance: markets, drop off time, max distance", ov.b1.markets === "Dallas" && ov.b1.dropoffTime === "Weekday evenings" && ov.b1.maxMiles === 30 && ov.b2.markets === "Dallas, Austin");
check("At a glance: certificate status", ov.b1.certs.find((c) => c.certType === "TABC")?.text === "expires in 23 days" && ov.b1.certs.find((c) => c.certType === "Food Handler")?.tone === "red");
check("Expiring soon is flagged for the filter", ov.b1.expiringSoon && !ov.b2.expiringSoon);
check("Profile completeness marker", ov.b1.done === 7 && ov.b1.total === 8 && ov.b1.missing.join() === "Food Handler" && ov.b2.done < ov.b2.total);
const mgr = src("app/team/admin/staff/staff-manager.tsx");
check("The Staff page has the Expiring soon filter and amber and red badges", mgr.includes("Expiring soon") && mgr.includes("amber:") && mgr.includes("red:"));
const csv = (await prDb.staffCsv(admin, morning))!;
check("Admins download a CSV with the profile fields", csv.startsWith("Name,Role,Active,Phone,Email,Home address,Markets,Drop off time,Max miles,Certificates,Profile complete,Missing") && csv.includes("taylor@example.com") && csv.includes('"100 Elm St, Dallas, TX 75201"'));
check("CSV cells can never run as spreadsheet formulas", pr.csvCell("=HYPERLINK(1)") === "'=HYPERLINK(1)" && pr.csvCell("+1") === "'+1");
check("The CSV route is admins only", src("app/api/team/admin/staff/export/route.ts").includes('staff.role !== "admin"'));

// ----- 7. Distance on the assign panel: a warning, never a block -----
reset();
await prDb.saveProfile(admin, "b1", FULL, morning); // Dallas, 30 mi max
await prDb.saveProfile(admin, "b2", { home_address: "1 Main St, Dallas, TX", max_miles: 300 }, morning);
const austin = db.sessions[0] as never;
const dist = await prDb.distancesToEvent(austin, ["b1", "b2", "a1"]);
check("Straight line miles from home to the event", dist.get("b1")!.miles > 170 && dist.get("b1")!.miles < 200);
check("Beyond their max is flagged", dist.get("b1")!.over === true && dist.get("b1")!.text.includes("over their 30 mi max"));
check("Within their max is not flagged", dist.get("b2")!.over === false);
check("No address, no estimate", !dist.has("a1"));
const assigned = await asgDb.assignStaff(austin, "b1", admin, "https://plan.test");
check("Assigning someone beyond their max still works", assigned.ok && db.event_assignments.some((a) => a.session_id === "e1" && a.staff_id === "b1"));
check("The assign panel shows miles and the warning, and the assign route has no distance check", src("app/team/admin/e/[id]/assign-panel.tsx").includes("You can still assign them") && !src("app/api/team/admin/assign/route.ts").includes("distance") && !src("lib/team/assignments-db.ts").includes("distance"));

done("profile");
