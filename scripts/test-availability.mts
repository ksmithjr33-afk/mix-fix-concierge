// Part 3: availability and time off.
// Run: node --no-warnings scripts/test-availability.mts

import { addDays, check, done, event, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const av = await import("../lib/team/availability.ts");
const avDb = await import("../lib/team/availability-db.ts");
const shiftsDb = await import("../lib/team/shifts-db.ts");
const asgDb = await import("../lib/team/assignments-db.ts");

const CT = "America/Chicago";
const today = time.todayIn(CT);
const day10 = addDays(today, 10);
const day12 = addDays(today, 12);
const NOON = time.zonedInstant(today, 12 * 60, CT);

// ----- The rules -----
check("A single date today or later is fine", av.validateUnavailable({ start: day10 }, today).ok);
check("A single date fills the end", (() => { const r = av.validateUnavailable({ start: day10 }, today); return r.ok && r.value.end === day10; })());
check("A range is fine", av.validateUnavailable({ start: day10, end: day12, note: " Out of  town " }, today).ok);
check("The note is tidied", (() => { const r = av.validateUnavailable({ start: day10, note: " Out of  town " }, today); return r.ok && r.value.note === "Out of town"; })());
check("Past dates cannot be added", (() => { const r = av.validateUnavailable({ start: addDays(today, -1) }, today); return !r.ok && /Past dates/.test(r.error); })());
check("End before start is refused", !av.validateUnavailable({ start: day12, end: day10 }, today).ok);
check("A range over a year is refused", !av.validateUnavailable({ start: day10, end: addDays(day10, 366) }, today).ok);
check("A bad date is refused", !av.validateUnavailable({ start: "2026-02-30" }, today).ok && !av.validateUnavailable({ start: "soon" }, today).ok);
check("A long note is refused", !av.validateUnavailable({ start: day10, note: "x".repeat(201) }, today).ok);
check("Removing a future row deletes it", av.removalPlan({ start_day: day10, end_day: day12 }, today).action === "delete");
check("Removing a row that started keeps the past days", (() => { const p = av.removalPlan({ start_day: addDays(today, -2), end_day: day10 }, today); return p.action === "trim" && p.end === addDays(today, -1); })());
check("A row that is over cannot be changed", av.removalPlan({ start_day: addDays(today, -5), end_day: addDays(today, -1) }, today).action === "past");
const rows = [{ staff_id: "b1", start_day: day10, end_day: day12 }];
check("Covered days are unavailable", av.isUnavailableOn(rows, "b1", day10) && av.isUnavailableOn(rows, "b1", addDays(day10, 1)) && av.isUnavailableOn(rows, "b1", day12));
check("Other days and other people are not", !av.isUnavailableOn(rows, "b1", addDays(day12, 1)) && !av.isUnavailableOn(rows, "b2", day10) && !av.isUnavailableOn(rows, "b1", null));
check("Labels read like dates", av.rangeLabel({ start_day: "2026-12-12", end_day: "2026-12-12" }) === "Sat, Dec 12" && av.rangeLabel({ start_day: "2026-12-12", end_day: "2026-12-15" }) === "Sat, Dec 12 to Tue, Dec 15");
check("The confirm text names the person and day", av.unavailableConfirm({ name: "Jordan", day: "2026-12-12", verb: "Assign" }) === "Jordan marked themselves unavailable on Sat, Dec 12. Assign anyway?");
check("The warning points to Give up this shift", av.acceptedWarning({ title: "Maria's wedding", day: "2026-12-12" }).includes('use "Give up this shift"'));

// ----- Database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true, markets: ["dallas"] };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true, markets: ["austin"] };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true, markets: ["austin"] };
const b3 = { id: "b3", name: "Riley Park", phone: "+12145550113", role: "bartender" as const, active: true, markets: ["austin"] };
const b4 = { id: "b4", name: "Dana Cole", phone: "+12145550114", role: "bartender" as const, active: true, markets: ["dallas"] };
const signedIn = (s: typeof b1) => ({ id: s.id, name: s.name, phone: s.phone, role: s.role, active: s.active });
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    event("au1", day10, "500 Congress Ave, Austin, TX", { event_name: "Austin One" }, { team_market: "austin", team_market_source: "auto" }),
    event("au2", day12, "1 Main St, Austin, TX", { event_name: "Austin Two" }, { team_market: "austin", team_market_source: "auto" }),
    event("da1", day10, "1 Elm St, Dallas, TX", { event_name: "Dallas One" }, { team_market: "dallas", team_market_source: "auto" }),
  ];
  db.staff = [admin, b1, b2, b3, b4].map((s) => ({ ...s }));
  db.event_assignments = [{ id: "acc", session_id: "au2", staff_id: "b1", status: "accepted" }];
  for (const t of ["shift_posts", "shift_requests", "shift_handoffs", "shift_notices", "team_notices", "team_hidden_events", "staff_unavailability", "time_punches", "staff_checks", "staff_confirmations"]) db[t] = [];
  texts.length = 0;
}
reset();
const add = await avDb.addUnavailable(signedIn(b1), { start: day10, end: day12, note: "Family trip" }, NOON);
check("A bartender can mark a range unavailable", add.ok && db.staff_unavailability.length === 1 && db.staff_unavailability[0].start_day === day10 && db.staff_unavailability[0].note === "Family trip");
check("Marking a day with an accepted event warns them to give it up", add.ok && add.warnings.length === 1 && add.warnings[0].includes("Austin Two") && add.warnings[0].includes('"Give up this shift"'), add.ok ? add.warnings.join() : "");
check("They keep the event they accepted", db.event_assignments.find((a) => a.id === "acc")?.status === "accepted");
check("No warning for days with no accepted event", await (async () => { const r = await avDb.addUnavailable(signedIn(b2), { start: day10 }, NOON); return r.ok && r.warnings.length === 0; })());
check("Past dates cannot be added through the database path", !(await avDb.addUnavailable(signedIn(b3), { start: addDays(today, -1) }, NOON)).ok);
const b1Row = db.staff_unavailability.find((r) => r.staff_id === "b1")!;
check("Nobody can remove someone else's dates", !(await avDb.removeUnavailable(signedIn(b2), b1Row.id as string, NOON)).ok && db.staff_unavailability.length === 2);
db.staff_unavailability.push({ id: "past", staff_id: "b3", start_day: addDays(today, -6), end_day: addDays(today, -2), note: null });
check("Past rows cannot be removed", !(await avDb.removeUnavailable(signedIn(b3), "past", NOON)).ok && db.staff_unavailability.some((r) => r.id === "past"));
db.staff_unavailability.push({ id: "started", staff_id: "b3", start_day: addDays(today, -2), end_day: addDays(today, 3), note: null });
check("Removing a started range keeps the past days", (await avDb.removeUnavailable(signedIn(b3), "started", NOON)).ok && db.staff_unavailability.find((r) => r.id === "started")?.end_day === addDays(today, -1));
check("Removing a future row deletes it", (await avDb.removeUnavailable(signedIn(b1), b1Row.id as string, NOON)).ok && !db.staff_unavailability.some((r) => r.id === b1Row.id));

// ----- Shift texts and Open shifts -----
reset();
db.staff_unavailability = [{ id: "u1", staff_id: "b1", start_day: day10, end_day: day10, note: null }];
const posted = await shiftsDb.postShift(db.sessions[0] as never, admin, NOON, "now");
check("An unavailable bartender is not queued for a shift text that day", posted.ok && !db.shift_notices.some((n) => n.staff_id === "b1") && db.shift_notices.some((n) => n.staff_id === "b2"), JSON.stringify(db.shift_notices));
await shiftsDb.deliverShiftNotices(NOON);
check("They get no shift text; others do", textsTo(b1).length === 0 && textsTo(b2).length === 1 && textsTo(b3).length === 1, JSON.stringify(texts));
check("The admin's count leaves them out", posted.ok && posted.plan.queued === 2);
const theirOpen = await shiftsDb.openShiftsFor(signedIn(b1));
check("They do not see the shift under Open shifts", theirOpen.length === 0);
check("Others still see it", (await shiftsDb.openShiftsFor(signedIn(b2))).length === 1);
const postId = db.shift_posts[0].id as string;
check("They cannot request it", !(await shiftsDb.requestShift(postId, signedIn(b1))).ok);
check("The shift page says it is gone for them", (await shiftsDb.shiftForStaff(postId, signedIn(b1))).state === "gone");
// Marked unavailable after the text was queued: the queued text is skipped.
reset();
await shiftsDb.postShift(db.sessions[0] as never, admin, NOON);
db.staff_unavailability = [{ id: "late", staff_id: "b2", start_day: day10, end_day: day10, note: null }];
await shiftsDb.deliverShiftNotices(new Date(NOON.getTime() + 11 * 60_000));
check("A text queued before they marked the day is skipped", textsTo(b2).length === 0 && textsTo(b1).length === 1 && db.shift_notices.find((n) => n.staff_id === "b2")?.status === "skipped");
// A batch: the Post all texts count only shifts they are available for.
reset();
db.staff_unavailability = [{ id: "u2", staff_id: "b2", start_day: day12, end_day: day12, note: null }];
db.event_assignments = [];
await shiftsDb.postSelected(admin, ["au1", "au2"], NOON);
check("In a batch, only the shift they are available for counts", /^New Mix Fix shift: /.test(textsTo(b2)[0]?.message ?? "") && /^2 new Mix Fix shifts/.test(textsTo(b3)[0]?.message ?? ""), JSON.stringify(texts));

// ----- Admins: tags, counts, and the confirm step -----
reset();
db.staff_unavailability = [{ id: "u3", staff_id: "b2", start_day: day10, end_day: day10, note: null }];
const noConfirm = await asgDb.assignStaff(db.sessions[0] as never, "b2", admin, "https://plan.test");
check("Assigning someone unavailable needs a confirm step", !noConfirm.ok && noConfirm.status === av.NEEDS_CONFIRM && noConfirm.error === `Sam marked themselves unavailable on ${av.shortDay(day10)}. Assign anyway?` && !db.event_assignments.some((a) => a.staff_id === "b2"), JSON.stringify(noConfirm));
const confirmed = await asgDb.assignStaff(db.sessions[0] as never, "b2", admin, "https://plan.test", { confirmUnavailable: true });
check("After the confirm they are assigned and texted", confirmed.ok && db.event_assignments.some((a) => a.staff_id === "b2" && a.status === "offered") && textsTo(b2).length === 1);
check("Someone available needs no confirm", (await asgDb.assignStaff(db.sessions[0] as never, "b3", admin, "https://plan.test")).ok);
// Approving a request from someone who marked the day after asking.
reset();
await shiftsDb.postShift(db.sessions[0] as never, admin, NOON, "now");
const pid = db.shift_posts[0].id as string;
await shiftsDb.requestShift(pid, signedIn(b2));
db.staff_unavailability = [{ id: "u4", staff_id: "b2", start_day: day10, end_day: day10, note: null }];
const panel = await shiftsDb.postPanel(db.sessions[0] as never);
check("The request list tags them Unavailable", panel.requesters.find((r) => r.staffId === "b2")?.unavailable === true);
const appr = await shiftsDb.approveRequest(admin, pid, "b2");
check("Approving them needs a confirm step", !appr.ok && appr.status === av.NEEDS_CONFIRM && !db.event_assignments.some((a) => a.staff_id === "b2"));
check("After the confirm they are approved", (await shiftsDb.approveRequest(admin, pid, "b2", { confirmUnavailable: true })).ok && db.event_assignments.some((a) => a.staff_id === "b2" && a.status === "accepted"));
// A teammate handoff to someone unavailable.
reset();
db.event_assignments = [{ id: "x1", session_id: "au1", staff_id: "b1", status: "accepted" }];
db.shift_handoffs = [{ id: "h1", session_id: "au1", from_staff_id: "b1", to_staff_id: "b3", mode: "teammate", status: "teammate_accepted", reason: "Sick", urgent: false, created_at: NOON.toISOString() }];
db.staff_unavailability = [{ id: "u5", staff_id: "b3", start_day: day10, end_day: day10, note: null }];
check("The handoff card tags the teammate Unavailable", (await shiftsDb.handoffPanel(db.sessions[0] as never))[0]?.teammateUnavailable === true);
const ha = await shiftsDb.approveHandoff("h1", admin);
check("Approving the handoff needs a confirm step", !ha.ok && ha.status === av.NEEDS_CONFIRM && db.event_assignments.some((a) => a.staff_id === "b1"));
check("After the confirm the shift moves", (await shiftsDb.approveHandoff("h1", admin, { confirmUnavailable: true })).ok && db.event_assignments.some((a) => a.staff_id === "b3"));
// Available counts per market.
reset();
db.staff_unavailability = [{ id: "u6", staff_id: "b1", start_day: day10, end_day: day12, note: null }];
const counts = await avDb.availableCounts(db.sessions as never);
check("Available bartenders per market on the event day", counts.get("au1") === 2 && counts.get("au2") === 2 && counts.get("da1") === 1, JSON.stringify([...counts]));
check("Admins are not counted as bartenders", !db.staff.some((s) => s.role === "admin" && (s.markets as string[]).includes("dallas") && counts.get("da1") !== 1));
db.sessions.push(event("nomk", day10, "Far", {}, { team_market: null, team_market_source: "none", team_market_address: "Far" }));
check("No market, no count", (await avDb.availableCounts(db.sessions as never)).get("nomk") === null);

// ----- Pages -----
const staffing = src("app/team/admin/events/page.tsx");
check("Staffing rows and calendar blocks show the available count", staffing.includes("availableCounts(sessions)") && staffing.includes("`${availability.get(s.id)} available`"));
check("The assign dropdown tags Unavailable and confirms", src("app/team/admin/e/[id]/assign-panel.tsx").includes('{s.unavailable ? " (Unavailable)" : ""}') && src("app/team/admin/e/[id]/assign-panel.tsx").includes("Assign anyway"));
check("Request and handoff approvals tag Unavailable and confirm", src("app/team/admin/e/[id]/shift-panel.tsx").includes(">Unavailable</span>") && src("app/team/admin/e/[id]/shift-panel.tsx").includes("Approve anyway"));
check("The staff page shows each person's unavailable days, with a detail page", src("app/team/admin/staff/page.tsx").includes("Unavailable: ") && src("app/team/admin/staff/[id]/page.tsx").includes('aria-label="Availability"'));
check("Bartenders reach Availability from Me in the header", src("app/team/team-header.tsx").includes('href="/team/me"') && src("app/team/me/page.tsx").includes('"/team/availability"'));
const route = src("app/api/team/availability/route.ts");
check("The availability route needs a sign in and only touches your own rows", route.includes("getCurrentStaff()") && route.includes("status: 401") && src("lib/team/availability-db.ts").includes("row.staff_id !== staff.id"));
check("The date picker starts at today", src("app/team/availability/availability-form.tsx").includes("min={today}"));
const mig = src("supabase/migrations/20261121_availability.sql");
check("Migration: RLS on, no anon access", mig.includes("enable row level security") && mig.includes("revoke all on public.staff_unavailability from anon, authenticated"));

done("availability");
