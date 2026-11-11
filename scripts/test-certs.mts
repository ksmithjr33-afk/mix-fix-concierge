// Part 6: certifications and onboarding.
// Run: node --no-warnings scripts/test-certs.mts

import { addDays, check, done, event, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const cfg = await import("../lib/team/cert-config.ts");
const certs = await import("../lib/team/certs.ts");
const certsDb = await import("../lib/team/certs-db.ts");
const shiftsDb = await import("../lib/team/shifts-db.ts");
const asgDb = await import("../lib/team/assignments-db.ts");
const av = await import("../lib/team/availability.ts");

const CT = "America/Chicago";
const PT = "America/Los_Angeles";
const today = time.todayIn(CT);
const NOON = time.zonedInstant(today, 12 * 60, CT);
const row = (o: Partial<Record<string, unknown>>) =>
  ({ id: "c", staff_id: "b1", cert_type: "TABC", file_path: "certs/x.pdf", file_type: "application/pdf", expires_on: addDays(today, 200), status: "approved", review_note: null, reviewed_by: "a1", reviewed_at: "", uploaded_by: "b1", created_at: "2026-11-01T00:00:00Z", ...o }) as never;

// ----- Config and rules -----
check("TABC for the Texas markets", ["dallas", "austin", "houston"].every((m) => cfg.CERT_BY_MARKET[m as "dallas"] === "TABC"));
check("California RBS for Los Angeles", cfg.CERT_BY_MARKET.los_angeles === "California RBS" && certs.requiredCert("los_angeles") === "California RBS");
check("Reminders at 30, 7, and the day", JSON.stringify(cfg.CERT_REMINDER_DAYS) === "[30,7,0]");
check("Nothing on file is missing", certs.certStanding([], "TABC", today).state === "missing");
check("Approved and current is ok", certs.certStanding([row({})], "TABC", today).state === "ok");
check("Good through the expiry date", certs.certStanding([row({ expires_on: today })], "TABC", today).state === "ok");
check("Expired the day after", certs.certStanding([row({ expires_on: addDays(today, -1) })], "TABC", today).state === "expired");
check("Waiting for review is allowed", certs.certStanding([row({ status: "pending" })], "TABC", today).state === "pending" && !certs.blocks("pending"));
check("The latest rejected with nothing valid is rejected", certs.certStanding([row({ status: "rejected", review_note: "Blurry" })], "TABC", today).state === "rejected");
check("A current approved one wins over a newer rejected one", certs.certStanding([row({ id: "old" }), row({ id: "new", status: "rejected", created_at: "2026-11-05T00:00:00Z" })], "TABC", today).state === "ok");
check("Another type does not count", certs.certStanding([row({ cert_type: "California RBS" })], "TABC", today).state === "missing");
check("Missing, rejected, and expired block", certs.blocks("missing") && certs.blocks("rejected") && certs.blocks("expired") && !certs.blocks("ok"));
check("Reminder steps", certs.reminderStep(addDays(today, 30), today) === 30 && certs.reminderStep(addDays(today, 25), today) === 30 && certs.reminderStep(addDays(today, 7), today) === 7 && certs.reminderStep(today, today) === 0 && certs.reminderStep(addDays(today, 31), today) === null && certs.reminderStep(addDays(today, -1), today) === null);
const pdf = { type: "application/pdf", size: 1000 };
check("A PDF with a future expiry is fine", certs.validateCertUpload({ certType: "TABC", expiresOn: addDays(today, 300) }, pdf, today).ok);
check("A photo is fine", certs.validateCertUpload({ certType: "TABC", expiresOn: addDays(today, 300) }, { type: "image/jpeg", size: 1000 }, today).ok);
check("Expiry date required", !certs.validateCertUpload({ certType: "TABC" }, pdf, today).ok);
check("An expired certificate is refused", !certs.validateCertUpload({ certType: "TABC", expiresOn: addDays(today, -1) }, pdf, today).ok);
check("A file is required", !certs.validateCertUpload({ certType: "TABC", expiresOn: addDays(today, 300) }, null, today).ok);
check("Other file types are refused", !certs.validateCertUpload({ certType: "TABC", expiresOn: addDays(today, 300) }, { type: "text/plain", size: 10 }, today).ok);
check("Unknown certification refused", !certs.validateCertUpload({ certType: "Food handler", expiresOn: addDays(today, 300) }, pdf, today).ok);
check("Onboarding has the five steps", JSON.stringify(cfg.ONBOARDING.map((i) => i.id)) === JSON.stringify(["name_phone", "certification", "who_brings_what", "clock_bar_ready", "shifts_handoffs"]));
check("Every step has text and a button", cfg.ONBOARDING.every((i) => i.body.length > 0 && i.ack.length > 0));

// ----- Database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const a2 = { id: "a2", name: "Office Two", phone: "+12145550101", role: "admin" as const, active: true, alerts: false };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const b3 = { id: "b3", name: "Riley Park", phone: "+13105550113", role: "bartender" as const, active: true };
const day10 = addDays(today, 10);
function reset(enforce: boolean) {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [event("d1", day10, "1 Elm St, Dallas, TX", { event_name: "Dallas One" }, { team_market: "dallas", team_market_source: "auto" })];
  db.staff = [
    { ...admin, markets: ["dallas"] },
    { ...a2, markets: ["dallas"] },
    { ...b1, markets: ["dallas"] },
    { ...b2, markets: ["dallas"] },
    { ...b3, markets: ["los_angeles"] },
  ];
  db.staff_certifications = [row({ id: "ok2", staff_id: "b2" })]; // b2 is current, b1 has nothing
  db.team_settings = [{ key: "enforce_certifications", value: enforce }];
  for (const t of ["event_assignments", "shift_posts", "shift_requests", "shift_handoffs", "shift_notices", "team_notices", "team_hidden_events", "staff_unavailability", "time_punches", "staff_onboarding", "staff_checks", "staff_confirmations"]) db[t] = [];
  texts.length = 0;
}

// Enforcement off (the default): warnings only.
reset(false);
db.team_settings = [];
check("Enforcement is off when never set", !(await certsDb.certsEnforced()));
await shiftsDb.postShift(db.sessions[0] as never, admin, NOON, "now");
let pid = db.shift_posts[0].id as string;
const warnReq = await shiftsDb.requestShift(pid, b1);
check("Off: a bartender with no certification can still request", warnReq.ok && db.shift_requests.some((r) => r.staff_id === "b1"));
check("Off: and is warned why", warnReq.ok && /TABC certification is not on file/.test(warnReq.certWarning ?? ""), warnReq.ok ? String(warnReq.certWarning) : "");
check("Off: the shift page shows a warning, not a block", (await certsDb.certNoticeForPost(pid, "b1"))?.blocked === false);
check("Off: admins assign with no confirm step", (await asgDb.assignStaff(db.sessions[0] as never, "b1", admin, "https://team.test")).ok);
check("Off: admins still see the problem in lists", (await certsDb.certIssues(["b1", "b2"], "dallas")).b1 === "TABC missing" && !(await certsDb.certIssues(["b1", "b2"], "dallas")).b2);

// Enforcement on.
reset(true);
check("Enforcement reads the setting", await certsDb.certsEnforced());
await shiftsDb.postShift(db.sessions[0] as never, admin, NOON, "now");
pid = db.shift_posts[0].id as string;
const blocked = await shiftsDb.requestShift(pid, b1);
check("On: a bartender with no certification cannot request", !blocked.ok && blocked.status === 403 && !db.shift_requests.some((r) => r.staff_id === "b1"));
check("On: and sees why", !blocked.ok && blocked.error.includes("TABC") && blocked.error.includes("Dallas") && blocked.error.includes("My certifications"));
check("On: the shift page says it is blocked", (await certsDb.certNoticeForPost(pid, "b1"))?.blocked === true);
check("On: someone with a current certification requests normally", (await shiftsDb.requestShift(pid, b2)).ok);
db.staff_certifications.push(row({ id: "exp", staff_id: "b1", expires_on: addDays(today, -2) }));
const exp = await shiftsDb.requestShift(pid, b1);
check("On: an expired certification blocks", !exp.ok && /expired/.test(exp.error));
db.staff_certifications.push(row({ id: "rej", staff_id: "b1", status: "rejected", review_note: "Blurry", created_at: "2026-11-09T00:00:00Z" }));
check("On: a rejected certification blocks", !(await shiftsDb.requestShift(pid, b1)).ok);
db.staff_certifications.push(row({ id: "pend", staff_id: "b1", status: "pending", created_at: "2026-11-10T00:00:00Z" }));
check("On: a certification waiting for review does not block", (await shiftsDb.requestShift(pid, b1)).ok);
db.staff_certifications = db.staff_certifications.filter((c) => c.staff_id !== "b1");
const needConfirm = await asgDb.assignStaff(db.sessions[0] as never, "b1", admin, "https://team.test");
check("On: assigning needs a confirm step that names the problem", !needConfirm.ok && needConfirm.status === av.NEEDS_CONFIRM && needConfirm.error === "Jordan's TABC certification is not on file. Assign anyway?", needConfirm.ok ? "" : needConfirm.error);
check("On: after the confirm the admin can assign", (await asgDb.assignStaff(db.sessions[0] as never, "b1", admin, "https://team.test", { confirmUnavailable: true })).ok);
db.event_assignments = [];
db.staff_unavailability = [{ id: "u", staff_id: "b1", start_day: day10, end_day: day10, note: null }];
const both = await asgDb.assignStaff(db.sessions[0] as never, "b1", admin, "https://team.test");
check("One confirm names every problem", !both.ok && both.error.includes("unavailable") && both.error.includes("TABC") && both.error.endsWith("Assign anyway?"), both.ok ? "" : both.error);
db.staff_unavailability = [];
db.shift_requests.push({ id: "r1", post_id: pid, staff_id: "b1", status: "requested", requested_at: NOON.toISOString(), updated_at: NOON.toISOString() });
const appr = await shiftsDb.approveRequest(admin, pid, "b1");
check("On: approving a request needs the confirm too", !appr.ok && appr.status === av.NEEDS_CONFIRM && appr.error.includes("TABC"));
check("Los Angeles needs California RBS", (await certsDb.standingFor("b3", "los_angeles"))?.certType === "California RBS");

// Upload and review
reset(true);
const blob = () => new Blob(["%PDF"], { type: "application/pdf" });
const up = await certsDb.uploadCert({ actor: b1, staffId: "b1", raw: { certType: "TABC", expiresOn: addDays(today, 400) }, file: blob(), fileType: "application/pdf", now: NOON });
check("A bartender uploads their own and it waits for review", up.ok && up.row.status === "pending" && String(up.row.file_path).startsWith("certs/b1/"));
check("Admins with alerts on hear about it", textsTo(admin).length === 1 && textsTo(a2).length === 0 && textsTo(admin)[0].message.includes("/team/admin/staff/b1"));
check("A bartender cannot upload for someone else", !(await certsDb.uploadCert({ actor: b2, staffId: "b1", raw: { certType: "TABC", expiresOn: addDays(today, 400) }, file: blob(), fileType: "application/pdf" })).ok);
const onBehalf = await certsDb.uploadCert({ actor: admin, staffId: "b2", raw: { certType: "TABC", expiresOn: addDays(today, 400) }, file: blob(), fileType: "application/pdf", now: NOON });
check("An admin can enter one for a bartender, approved as entered", onBehalf.ok && onBehalf.row.status === "approved" && onBehalf.row.reviewed_by === "a1" && onBehalf.row.uploaded_by === "a1");
const pendingId = up.ok ? up.row.id : "";
texts.length = 0;
check("A rejection needs a note", !(await certsDb.reviewCert(admin, pendingId, "reject", "")).ok);
check("Nobody reviews their own", !(await certsDb.reviewCert({ ...admin, id: "b1" }, pendingId, "approve", "")).ok);
check("Bartenders cannot review", !(await certsDb.reviewCert(b2, pendingId, "approve", "")).ok);
check("An admin rejects with a note", (await certsDb.reviewCert(admin, pendingId, "reject", "The photo is blurry.")).ok && db.staff_certifications.find((c) => c.id === pendingId)?.status === "rejected");
check("The bartender is texted the note", textsTo(b1).length === 1 && textsTo(b1)[0].message.includes("The photo is blurry.") && textsTo(b1)[0].message.includes("/team/certifications"));
check("An admin approves", (await certsDb.reviewCert(admin, pendingId, "approve", "")).ok && db.staff_certifications.find((c) => c.id === pendingId)?.status === "approved");
check("The owner can open their file", (await certsDb.certFileLink(b1, pendingId))?.startsWith("https://signed.test/certs/b1/") === true);
check("Admins can open it", !!(await certsDb.certFileLink(admin, pendingId)));
check("Another bartender cannot", (await certsDb.certFileLink(b2, pendingId)) === null);

// Reminders
reset(false);
const inDays = (n: number) => addDays(today, n);
db.staff_certifications = [row({ id: "r30", staff_id: "b1", expires_on: inDays(30) }), row({ id: "r20", staff_id: "b2", expires_on: inDays(200) })];
const morning = time.zonedInstant(today, 10 * 60, CT);
check("30 days out: one text to the bartender", (await certsDb.sendCertReminders(morning)) === 1 && textsTo(b1).length === 1 && textsTo(b1)[0].message.includes("expires in 30 days"));
check("And admins with alerts on", textsTo(admin).length === 1 && textsTo(a2).length === 0 && textsTo(admin)[0].message.includes("Jordan Lee"));
await certsDb.sendCertReminders(new Date(morning.getTime() + 3_600_000));
check("Only once per step", textsTo(b1).length === 1);
db.staff_certifications[0].expires_on = inDays(7);
await certsDb.sendCertReminders(morning);
check("Then at 7 days", textsTo(b1).length === 2 && textsTo(b1)[1].message.includes("7 days"));
db.staff_certifications[0].expires_on = today;
await certsDb.sendCertReminders(morning);
check("Then on the day", textsTo(b1).length === 3 && textsTo(b1)[2].message.includes("expires today"));
check("Nothing for a certificate far from expiry", textsTo(b2).length === 0);
reset(false);
db.staff_certifications = [row({ id: "q", staff_id: "b1", expires_on: inDays(7) })];
await certsDb.sendCertReminders(time.zonedInstant(today, 22 * 60, CT));
check("Not during quiet hours", texts.length === 0);
db.staff_certifications.push(row({ id: "renewed", staff_id: "b1", expires_on: inDays(700), created_at: "2026-11-09T00:00:00Z" }));
await certsDb.sendCertReminders(morning);
check("Not after it was renewed", texts.length === 0);
reset(false);
db.staff_certifications = [row({ id: "la", staff_id: "b3", cert_type: "California RBS", expires_on: time.todayIn(PT, time.zonedInstant(today, 10 * 60, PT)) })];
await certsDb.sendCertReminders(time.zonedInstant(today, 10 * 60, PT));
check("Los Angeles reminders use Pacific time", textsTo(b3).length === 1 && textsTo(b3)[0].message.includes("California RBS certification expires today"));

// Onboarding
reset(false);
check("Acknowledging a step ticks it", (await certsDb.acknowledgeItem(b1, "who_brings_what")).ok && (await certsDb.onboardingDone("b1")).has("who_brings_what"));
check("Unknown steps are refused", !(await certsDb.acknowledgeItem(b1, "nope")).ok);
await certsDb.acknowledgeItem(b1, "name_phone");
await certsDb.acknowledgeItem(b1, "name_phone");
check("Progress counts each step once", (await certsDb.onboardingProgress(["b1", "b2"])).get("b1") === 2 && (await certsDb.onboardingProgress(["b1", "b2"])).get("b2") === 0);
check("Onboarding blocks nothing", !/onboarding/i.test(src("lib/team/shifts-db.ts")) && !/onboarding/i.test(src("lib/team/assignments-db.ts")));

// Wiring
check("The cron sends certification reminders", src("app/api/cron/team/route.ts").includes("sendCertReminders(now)"));
check("The staff page has the enforce setting", src("app/team/admin/staff/page.tsx").includes("<EnforceToggle"));
check("Staff detail shows certifications and onboarding", src("app/team/admin/staff/[id]/page.tsx").includes("<CertReview") && src("app/team/admin/staff/[id]/page.tsx").includes("Onboarding:"));
check("Me links certifications and onboarding", src("app/team/me/page.tsx").includes('"/team/certifications"') && src("app/team/me/page.tsx").includes('"/team/onboarding"'));
check("Files are opened through the access check", src("app/api/team/certs/file/route.ts").includes("certFileLink(staff"));
check("Certification texts go through sendStaffText", !/fetch\(/.test(src("lib/team/certs-db.ts")) && src("lib/team/certs-db.ts").includes("sendStaffText("));

done("certification");
