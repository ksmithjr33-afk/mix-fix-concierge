// Staff Scorecard: admins and managers only, never about yourself, the note at
// 3 or lower, blanks left out, every tier rule, rank within market, the To rate
// list and its 48 hour flag, check in calls and Locked by Tuesday, the reliability
// facts, pages loading before the migration, and no scorecard data on any staff
// facing page, text or export. Real code against the in-memory database.
// Run: node --no-warnings scripts/test-scorecard.mts

import { readdirSync, statSync } from "node:fs";
import { addDays, check, done, src, texts } from "./team-harness.mts";

const { db, missingTables } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const sc = await import("../lib/team/scorecard.ts");
const scdb = await import("../lib/team/scorecard-db.ts");
const rel = await import("../lib/team/reliability.ts");
const nav = await import("../lib/team/header-nav.ts");

const NOW = new Date();
const today = time.chicagoToday(NOW);
const H = 3_600_000;

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true, markets: ["dallas"] };
const mgr = { id: "m1", name: "Alex Rivera", phone: "+12145550102", role: "manager" as const, active: true, alerts: true, markets: ["dallas"] };
const mgr2 = { id: "m2", name: "Robin Hale", phone: "+12145550103", role: "manager" as const, active: true, alerts: true, markets: ["dallas"] };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true, alerts: false, markets: ["dallas"] };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true, alerts: false, markets: ["dallas"] };
const b3 = { id: "b3", name: "Casey Moore", phone: "+12145550113", role: "bartender" as const, active: true, alerts: false, markets: ["austin"] };
const b4 = { id: "b4", name: "Drew Park", phone: "+12145550114", role: "bartender" as const, active: true, alerts: false, markets: ["austin", "dallas"] };
const srv = { id: "s1", name: "Pat Quinn", phone: "+12145550115", role: "server" as const, active: true, alerts: false, markets: ["dallas"] };
const PEOPLE = [admin, mgr, mgr2, b1, b2, b3, b4, srv];
const NON_SCORERS = ["bartender", "bar_back", "server", "event_helper"].map((role) => ({ ...b1, id: "x-" + role, role }));

const ev = (id: string, day: string, extra: Record<string, unknown> = {}, market = "dallas") => ({
  id,
  status: "submitted",
  version: 1,
  event_date: day,
  team_market: market,
  team_market_source: "admin",
  package_type: "Full Bar",
  event_data: { client_name: "Justin Reyes", event_type: "Wedding", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: "1 Main St, Dallas, TX", guest_count: 120, package: "Full Bar", ...extra },
});

const SCORE_TABLES = ["staff_ratings", "staff_rating_versions", "staff_reviews", "staff_checkin_calls", "event_week_locks", "staff_setup_flags"];
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = PEOPLE.map((s) => ({ ...s }));
  db.sessions = [
    ev("e1", addDays(today, -3)), // over 48 hours ago
    ev("e2", addDays(today, -1)), // ended last night
    ev("e3", addDays(today, -20)), // outside the 14 days
    ev("u1", addDays(today, 2)), // upcoming
    ev("u2", addDays(today, 10)),
  ];
  db.event_assignments = [
    { id: "x1", session_id: "e1", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "e1", staff_id: "m1", status: "accepted" }, // the manager who also bartends
    { id: "x3", session_id: "e2", staff_id: "b2", status: "accepted" },
    { id: "x4", session_id: "e2", staff_id: "b3", status: "declined", responded_at: addDays(today, -5) + "T12:00:00Z" },
    { id: "x5", session_id: "e3", staff_id: "b1", status: "accepted" },
    { id: "x6", session_id: "u1", staff_id: "b1", status: "accepted" },
    { id: "x7", session_id: "u1", staff_id: "m1", status: "accepted" },
    { id: "x8", session_id: "u2", staff_id: "b2", status: "offered" },
  ];
  for (const t of [...SCORE_TABLES, "team_hidden_events", "time_punches", "bar_ready_reports", "event_closeouts", "shift_handoffs", "staff_certifications", "staff_onboarding", "team_settings", "staff_confirmations", "staff_supplies_confirmations", "low_stock_reports"]) db[t] = [];
}
const marks = (v: Partial<Record<string, number | null>>) => ({ ...sc.blankMarks(), ...v });
const fives = sc.allFives();

// ----- 1. Staff and non managers refused everywhere -----
reset();
check("Only admins and managers can score", sc.MARKS.length === 7 && scdb.canScore(admin) && scdb.canScore(mgr) && NON_SCORERS.every((s) => !scdb.canScore(s)));
for (const s of NON_SCORERS) {
  const r = [
    await scdb.roster(s, NOW),
    await scdb.toRate(s, NOW),
    await scdb.callsView(s, NOW),
    await scdb.rosterCsvFor(s, NOW),
    await scdb.ratingsCsvFor(s, NOW),
    await scdb.rateTeamCard(s, db.sessions[0] as never, [{ staffId: "b1", name: "Jordan", status: "accepted" }], NOW),
  ];
  const badges = await scdb.tierBadges(s, ["b1", "b2"]);
  const writes = [
    await scdb.saveRating(s, { sessionId: "e1", staffId: "b2", marks: fives }, NOW),
    await scdb.addReview(s, { staffId: "b2", kind: "praise", date: today, body: "Great" }, NOW),
    await scdb.editReview(s, { id: "r1", kind: "praise", date: today, body: "x" }, NOW),
    await scdb.saveCall(s, { sessionId: "u1", staffId: "b2", done: true }, NOW),
    await scdb.saveLock(s, { sessionId: "u1", locked: true }, NOW),
    await scdb.setPayrollDone(s, { staffId: "b2", done: true }, NOW),
    await scdb.saveTierSettings(s, { ...sc.TIER_DEFAULTS }, NOW),
    await scdb.personCard(s, "b2", NOW),
    await scdb.rateForm(s, "e1", "b2", NOW),
  ];
  check(`A ${s.role} gets nothing back from any Scorecard read`, r.every((x) => x === null) && Object.keys(badges).length === 0);
  check(`A ${s.role} is refused (403) on every Scorecard save and page`, writes.every((w) => !w.ok && w.status === 403), JSON.stringify(writes.map((w) => (w.ok ? "ok" : w.status))));
}
check("An admin in Bartender view is refused too", (await scdb.roster({ ...admin, role: "bartender" }, NOW)) === null);
check("Nothing was written by a refused call", SCORE_TABLES.every((t) => db[t].length === 0));
const api = src("app/api/team/admin/scorecard/route.ts");
const exp = src("app/api/team/admin/scorecard/export/route.ts");
check("The save and export routes answer 401 signed out and 403 for anyone else", [api, exp].every((f) => f.includes("status: 401") && f.includes("if (!isAdminRole(staff.role)) return NextResponse.json({ error: \"Admins and managers only.\" }, { status: 403 });")));
const pages = ["app/team/admin/scorecard/page.tsx", "app/team/admin/scorecard/[staffId]/page.tsx", "app/team/admin/scorecard/rate/[sessionId]/[staffId]/page.tsx", "app/team/admin/scorecard/calls/page.tsx"];
check("Every Scorecard page answers 403 to anyone but admins and managers", pages.every((p) => src(p).includes("await requireScorecard(")) && src("lib/team/scorecard-page.ts").includes("if (!canScore(staff)) forbidden();") && src("next.config.ts").includes("authInterrupts: true"));
const staffLinks = nav.headerLinks(false, { unreadNews: 0 });
const adminLinks = nav.headerLinks(true, { unreadNews: 0 });
check("The Scorecard link is in the header for admins and managers only", adminLinks.some((l) => l.href === "/team/admin/scorecard" && l.label === "Scorecard") && !staffLinks.some((l) => l.href.includes("scorecard")));

// ----- 2. Nobody sees or rates themselves -----
reset();
const selfWrites = [
  await scdb.saveRating(mgr, { sessionId: "e1", staffId: "m1", marks: fives }, NOW),
  await scdb.addReview(mgr, { staffId: "m1", kind: "praise", date: today, body: "Me" }, NOW),
  await scdb.saveCall(mgr, { sessionId: "u1", staffId: "m1", done: true, confidence: 5 }, NOW),
  await scdb.personCard(mgr, "m1", NOW),
  await scdb.rateForm(mgr, "e1", "m1", NOW),
  await scdb.setPayrollDone(admin, { staffId: "a1", done: true }, NOW),
];
check("No one can rate, review, call, open or tick themselves", selfWrites.every((w) => !w.ok && w.status === 403), JSON.stringify(selfWrites.map((w) => (w.ok ? "ok" : w.status))));
check("Nothing was saved about themselves", SCORE_TABLES.every((t) => db[t].length === 0));
// Someone else rates the manager; the manager must never see it.
check("Another admin can rate the manager", (await scdb.saveRating(admin, { sessionId: "e1", staffId: "m1", marks: fives }, NOW)).ok);
await scdb.saveRating(admin, { sessionId: "e1", staffId: "b1", marks: fives }, NOW);
await scdb.addReview(admin, { staffId: "m1", kind: "coaching", date: today, body: "Private note about the manager" }, NOW);
const mgrRoster = (await scdb.roster(mgr, NOW))!;
check("A manager who bartends sees every record except their own", !mgrRoster.rows.some((r) => r.staffId === "m1") && mgrRoster.rows.some((r) => r.staffId === "b1"));
check("An admin sees the manager on the roster", (await scdb.roster(admin, NOW))!.rows.some((r) => r.staffId === "m1"));
check("Tier badges never include the viewer", !("m1" in (await scdb.tierBadges(mgr, ["m1", "b1"]))) && "b1" in (await scdb.tierBadges(mgr, ["m1", "b1"])));
check("The To rate list leaves out the viewer", !(await scdb.toRate(mgr, NOW))!.some((e) => e.people.some((p) => p.staffId === "m1")));
check("Rate the team leaves out the viewer", !(await scdb.rateTeamCard(mgr, db.sessions[0] as never, [{ staffId: "m1", name: "Alex", status: "accepted" }, { staffId: "b1", name: "Jordan", status: "accepted" }], NOW))!.people.some((p) => p.staffId === "m1"));
check("Check in calls leave out the viewer", !(await scdb.callsView(mgr, NOW))!.events.some((e) => e.people.some((p) => p.staffId === "m1")));
const mgrCsv = (await scdb.ratingsCsvFor(mgr, NOW))!;
const mgrRosterCsv = (await scdb.rosterCsvFor(mgr, NOW))!;
check("The CSVs leave out the viewer's own rows", !mgrCsv.includes("Alex Rivera") && mgrCsv.includes("Jordan Lee") && !mgrRosterCsv.includes("Alex Rivera"));
const reviewAboutMgr = db.staff_reviews[0] as { id: string };
check("A review about yourself cannot be edited by you", !(await scdb.editReview(mgr, { id: reviewAboutMgr.id, kind: "praise", date: today, body: "Fixed" }, NOW)).ok);

// ----- 3. The note at 3 or lower, and blanks -----
check("A mark of 3 needs a note", !sc.validateRating({ marks: marks({ client: 5, admin: 3 }) }).ok && (sc.validateRating({ marks: marks({ client: 5, admin: 3 }) }) as { error: string }).error.includes("Admin"));
check("A mark of 1 needs a note too", !sc.validateRating({ marks: marks({ efficiency: 1 }) }).ok);
check("With the note it saves", sc.validateRating({ marks: marks({ client: 5, admin: 3 }), markNotes: { admin: "Late to setup" } }).ok);
check("A 4 needs no note", sc.validateRating({ marks: marks({ admin: 4 }) }).ok);
check("Every mark blank is refused", !sc.validateRating({ marks: sc.blankMarks() }).ok);
check("Marks must be 1 to 5", !sc.validateRating({ marks: marks({ client: 6 }) }).ok && !sc.validateRating({ marks: marks({ client: 0 }) }).ok);
const noNote = await scdb.saveRating(admin, { sessionId: "e2", staffId: "b2", marks: marks({ client: 2 }) }, NOW);
check("The server refuses a low mark with no note", !noNote.ok && noNote.status === 400);
check("Blanks are left out of the average", sc.markAverage(marks({ client: null, admin: 4, efficiency: 5 })) === 4.5 && sc.lowestMark(marks({ client: null, admin: 4 })) === 4);
check("A blank client mark is fine (no client rating yet)", sc.validateRating({ marks: { ...fives, client: null } }).ok);
const blankEvents = [5, 4, 4].map((n, i) => ({ sessionId: `b${i}`, day: null, marks: marks({ client: null, admin: n, efficiency: n }) }));
check("Blanks are left out of the tier average", sc.tierFor(blankEvents).lastAvg === (5 + 4 + 4) / 3);

// ----- 4. Tiers -----
const evs = (avgs: Partial<Record<string, number | null>>[]) => avgs.map((m, i) => ({ sessionId: `t${i}`, day: addDays(today, -i), marks: marks(m) }));
const all = (n: number) => Object.fromEntries(sc.MARK_KEYS.map((k) => [k, n]));
check("New: fewer than 3 rated events", sc.tierFor(evs([all(5), all(5)])).tier === "new");
check("Exactly 3 rated events is no longer New", sc.tierFor(evs([all(5), all(5), all(5)])).tier === "ace");
check("Events with every mark blank do not count as rated", sc.tierFor([...evs([all(5), all(5)]), { sessionId: "z", day: null, marks: sc.blankMarks() }]).tier === "new");
check("Ace: average 4.8 or higher and no mark below 4", sc.tierFor(evs([all(5), all(5), { ...all(5), client: 4 }, all(5)])).tier === "ace");
check("A mark below 4 keeps someone out of Ace", sc.tierFor(evs([all(5), all(5), all(5), all(5), { ...all(5), client: 3 }])).tier === "solid");
check("Solid: average 4.5 or higher", sc.tierFor(evs([all(5), all(4), all(5), all(4)])).tier === "solid");
check("Coach: average below 4.5", sc.tierFor(evs([all(4), all(4), all(5), all(4)])).tier === "coach");
check("Coach from a recent low mark, even with a high average", sc.tierFor(evs([{ ...all(5), shopping: 2 }, all(5), all(5), all(5), all(5), all(5), all(5), all(5), all(5), all(5)])).tier === "coach");
check("A low mark older than the last 3 rated events does not force Coach", sc.tierFor(evs([all(5), all(5), all(5), { ...all(5), shopping: 2 }, all(5), all(5), all(5), all(5), all(5), all(5)])).tier === "solid");
const eleven = evs([...Array(10).fill(all(5)), all(1)]);
check("The tier looks at the last 10 rated events only", sc.tierFor(eleven).tier === "ace" && sc.tierFor(eleven).lastAvg === 5 && sc.tierFor(eleven).allAvg! < 5);
check("The window is a setting", sc.tierFor(eleven, { ...sc.TIER_DEFAULTS, window: 11 }).tier !== "ace");
check("The thresholds are settings", sc.tierFor(evs([all(4), all(4), all(4)]), { ...sc.TIER_DEFAULTS, solidAvg: 4 }).tier === "solid");
check("Settings are checked", !sc.validateTierSettings({ ...sc.TIER_DEFAULTS, aceAvg: 6 }).ok && !sc.validateTierSettings({ ...sc.TIER_DEFAULTS, solidAvg: 4.9, aceAvg: 4.8 }).ok && sc.validateTierSettings({ ...sc.TIER_DEFAULTS }).ok);
check("Only admins save the settings, not managers", !(await scdb.saveTierSettings(mgr, { ...sc.TIER_DEFAULTS, window: 5 }, NOW)).ok && (await scdb.saveTierSettings(admin, { ...sc.TIER_DEFAULTS, window: 5 }, NOW)).ok && (await scdb.tierSettings()).window === 5);
check("The trend runs oldest to newest", JSON.stringify(sc.tierFor(evs([all(5), all(4), all(3)])).trend) === "[3,4,5]");
check("Each mark is averaged so weak spots stand out", sc.tierFor(evs([{ ...all(5), shopping: 3 }, { ...all(5), shopping: 4 }, all(5)])).markAvgs.shopping === 4);

// ----- 5. Rank within each market -----
const ranks = sc.ranksByMarket([
  { staffId: "a", name: "A", markets: ["dallas"], tier: "solid", lastAvg: 4.6, rated: 5 },
  { staffId: "b", name: "B", markets: ["dallas"], tier: "ace", lastAvg: 4.9, rated: 4 },
  { staffId: "c", name: "C", markets: ["dallas"], tier: "solid", lastAvg: 4.6, rated: 9 },
  { staffId: "d", name: "D", markets: ["dallas", "austin"], tier: "coach", lastAvg: 4.9, rated: 9 },
  { staffId: "e", name: "E", markets: ["austin"], tier: "ace", lastAvg: 4.8, rated: 3 },
  { staffId: "f", name: "F", markets: ["dallas"], tier: "new", lastAvg: 5, rated: 1 },
]);
const dal = ranks.get("dallas")!;
check("Rank by tier first, then average, then events rated", dal.get("b") === 1 && dal.get("c") === 2 && dal.get("a") === 3 && dal.get("d") === 4, JSON.stringify([...dal]));
check("Rank is within each market", ranks.get("austin")!.get("e") === 1 && ranks.get("austin")!.get("d") === 2);
check("New is listed but not ranked", !dal.has("f"));

// ----- 6. The To rate list and the 48 hour flag -----
reset();
const toRate = (await scdb.toRate(admin, NOW))!;
check("To rate: events in the last 14 days with people not rated, oldest first", toRate.map((e) => e.sessionId).join() === "e1,e2", toRate.map((e) => e.sessionId).join());
check("Past 48 hours is flagged, a fresh one is not", toRate[0].late && !toRate[1].late);
check("Upcoming events, declined people and events past 14 days are not on it", !toRate.some((e) => ["u1", "u2", "e3"].includes(e.sessionId)) && !toRate.some((e) => e.people.some((p) => p.staffId === "b3")));
await scdb.saveRating(admin, { sessionId: "e2", staffId: "b2", marks: fives }, NOW);
check("Once everyone on an event is rated it leaves the list", !(await scdb.toRate(admin, NOW))!.some((e) => e.sessionId === "e2"));
const pure = sc.toRateList(
  [
    { sessionId: "p1", staffId: "x", end: new Date(NOW.getTime() - 47 * H) },
    { sessionId: "p2", staffId: "x", end: new Date(NOW.getTime() - 49 * H) },
    { sessionId: "p3", staffId: "x", end: new Date(NOW.getTime() + H) },
  ],
  new Set(),
  NOW,
);
check("The 48 hour line: 47 hours is not flagged, 49 is, not yet ended is left out", pure.map((e) => `${e.sessionId}:${e.late}`).join() === "p2:true,p1:false");
check("Rating waits for the event to end", !(await scdb.saveRating(admin, { sessionId: "u1", staffId: "b1", marks: fives }, NOW)).ok);
check("Only people who worked it can be rated", (await scdb.saveRating(admin, { sessionId: "e2", staffId: "b3", marks: fives }, NOW)).ok === false);

// ----- 7. The rating form: facts, suggestions, history -----
reset();
const e1 = time.eventSchedule(db.sessions[0].event_data as Record<string, unknown>);
db.time_punches.push({ assignment_id: "x1", staff_id: "b1", session_id: "e1", type: "in", punched_at: new Date(e1.arrival!.getTime() + 12 * 60_000).toISOString(), flags: [] });
db.event_closeouts.push({ id: "c1", session_id: "e1", staff_id: "b1", submitted_at: new Date(e1.end!.getTime() + 30 * 60_000).toISOString(), supplies: [{ key: "limes", count: 3 }] });
db.low_stock_reports.push({ id: "l1", session_id: "e1", staff_id: "b1", item: "Limes", level: "low", created_at: e1.start!.toISOString() });
db.staff_checkin_calls.push({ session_id: "e1", staff_id: "b1", done: true, outcome: "good", confidence: 4, notes: "", called_by: "a1", called_by_name: "Kenneth Smith", called_at: addDays(today, -5) + "T15:00:00Z", updated_at: NOW.toISOString() });
const form = await scdb.rateForm(admin, "e1", "b1", NOW);
check("The form shows the facts the app has", form.ok && form.form.facts.arrivalText === "12 minutes late" && form.form.facts.missingClockOut && !form.form.facts.barPhotoAt && !!form.form.facts.closeoutAt && form.form.facts.lowStock[0].item === "Limes", form.ok ? JSON.stringify(form.form.facts) : "");
check("Leftovers is suggested from the closeout report", form.ok && form.form.suggested.leftovers?.value === 5);
check("Confidence is suggested from the check in call", form.ok && form.form.suggested.confidence?.value === 4);
check("Opening the form saves nothing", db.staff_ratings.length === 0);
check("Suggestions are marked and wait for the reviewer", src("app/team/admin/scorecard/rate/[sessionId]/[staffId]/rate-form.tsx").includes("Confirm or change the suggested marks first.") && src("app/team/admin/scorecard/rate/[sessionId]/[staffId]/rate-form.tsx").includes(">Suggested<"));
check("No closeout suggests a 1 for leftovers", sc.leftoverSuggestion(null, new Date()).value === 1);
await scdb.saveRating(admin, { sessionId: "e1", staffId: "b1", marks: fives, clientFeedback: "Loved them" }, NOW);
const first = db.staff_ratings[0] as Record<string, unknown>;
check("A rating records who rated and when", first.rated_by === "a1" && first.rated_by_name === "Kenneth Smith" && !!first.rated_at && first.client_feedback === "Loved them");
await scdb.saveRating(mgr, { sessionId: "e1", staffId: "b1", marks: { ...fives, admin: 3 }, markNotes: { admin: "Uniform" } }, NOW);
const edited = db.staff_ratings[0] as Record<string, unknown>;
check("Editing keeps the earlier save in the history", db.staff_ratings.length === 1 && db.staff_rating_versions.length === 1 && (db.staff_rating_versions[0] as { data: Record<string, unknown> }).data.admin === 5 && edited.admin === 3 && edited.updated_by === "m1" && edited.rated_by === "a1");
const form2 = await scdb.rateForm(admin, "e1", "b1", NOW);
check("The history shows on the form", form2.ok && form2.form.history.length === 1 && form2.form.history[0].by === "Kenneth Smith");

// ----- 8. Check in calls and Locked by Tuesday -----
check("The Tuesday before a Saturday is that week's Tuesday", sc.tuesdayBefore("2026-11-21") === "2026-11-17");
check("The Tuesday before a Wednesday is the day before", sc.tuesdayBefore("2026-11-18") === "2026-11-17");
check("An event on a Tuesday locks the Tuesday before", sc.tuesdayBefore("2026-11-24") === "2026-11-17");
check("Not locked on or after that Tuesday is flagged", sc.lockOverdue("2026-11-21", false, "2026-11-17") && sc.lockOverdue("2026-11-21", false, "2026-11-19") && !sc.lockOverdue("2026-11-21", false, "2026-11-16") && !sc.lockOverdue("2026-11-21", true, "2026-11-19"));
check("A call not done is flagged for the coming week only", sc.callOverdue(addDays(today, 3), false, today) && !sc.callOverdue(addDays(today, 10), false, today) && !sc.callOverdue(addDays(today, 3), true, today));
reset();
const calls = (await scdb.callsView(admin, NOW))!;
check("Check in calls list every event in the next 14 days, soonest first, with each assigned person", calls.events.map((e) => e.sessionId).join() === "u1,u2" && calls.events[0].people.map((p) => p.staffId).sort().join() === "b1,m1" && calls.events[1].people[0].staffId === "b2");
check("A call not done in the coming week is highlighted", calls.events[0].people.every((p) => p.overdue) && !calls.events[1].people[0].overdue);
const saved = await scdb.saveCall(mgr, { sessionId: "u1", staffId: "b1", done: true, outcome: "okay", confidence: 3, notes: "Nervous about the dive bar setup" }, NOW);
const call = db.staff_checkin_calls[0] as Record<string, unknown>;
check("A call saves done, outcome, confidence, notes, who called and when", saved.ok && call.done === true && call.outcome === "okay" && call.confidence === 3 && call.called_by_name === "Alex Rivera" && !!call.called_at);
check("A call is refused for someone not on the event", !(await scdb.saveCall(admin, { sessionId: "u1", staffId: "b3", done: true }, NOW)).ok);
check("Outcome and confidence are checked", !(await scdb.saveCall(admin, { sessionId: "u1", staffId: "b1", outcome: "great" }, NOW)).ok && !(await scdb.saveCall(admin, { sessionId: "u1", staffId: "b1", confidence: 9 }, NOW)).ok);
check("Locked by Tuesday saves who and when", (await scdb.saveLock(admin, { sessionId: "u1", locked: true }, NOW)).ok && (db.event_week_locks[0] as Record<string, unknown>).locked_by_name === "Kenneth Smith" && !!(db.event_week_locks[0] as Record<string, unknown>).locked_at);
const after = (await scdb.callsView(admin, NOW))!;
check("Locked and called show on the list", after.events[0].lock.locked && !after.events[0].lockOverdue && after.events[0].people.find((p) => p.staffId === "b1")!.done && !after.events[0].people.find((p) => p.staffId === "b1")!.overdue);

// ----- 9. Reviews -----
reset();
const rv = await scdb.addReview(mgr, { staffId: "b1", kind: "incident", date: today, body: "Left the bar early" }, NOW);
check("Admins and managers add reviews with a type, date and text", rv.ok && (db.staff_reviews[0] as Record<string, unknown>).author_name === "Alex Rivera");
check("The author can edit it", (await scdb.editReview(mgr, { id: (rv as { id: string }).id, kind: "incident", date: today, body: "Left 20 minutes early" }, NOW)).ok);
check("Another manager cannot", !(await scdb.editReview(mgr2, { id: (rv as { id: string }).id, kind: "general", date: today, body: "x" }, NOW)).ok);
check("An admin can", (await scdb.editReview(admin, { id: (rv as { id: string }).id, kind: "coaching", date: today, body: "Talked it through" }, NOW)).ok);
await scdb.addReview(admin, { staffId: "b1", kind: "praise", date: addDays(today, -10), body: "Client called to thank us" }, NOW);
const card = await scdb.personCard(admin, "b1", NOW);
check("Reviews come newest first", card.ok && card.card.reviews.map((x) => x.kind).join() === "coaching,praise");
check("Review types are checked", !(await scdb.addReview(admin, { staffId: "b1", kind: "rant", date: today, body: "x" }, NOW)).ok);

// ----- 10. Reliability facts and setup flags -----
const facts = rel.computeRecord(
  {
    ...rel.emptyFacts(),
    events: [
      { sessionId: "1", end: new Date(NOW.getTime() - 5 * 86_400_000), arrival: new Date(NOW.getTime() - 5 * 86_400_000 - 6 * H), start: null, clockIn: new Date(NOW.getTime() - 5 * 86_400_000 - 5 * H), clockOut: null, barReadyAt: null, closeout: false },
      { sessionId: "2", end: new Date(NOW.getTime() - 6 * 86_400_000), arrival: new Date(NOW.getTime() - 6 * 86_400_000 - 6 * H), start: null, clockIn: new Date(NOW.getTime() - 6 * 86_400_000 - 7 * H), clockOut: new Date(NOW.getTime() - 6 * 86_400_000), barReadyAt: null, closeout: true },
    ],
    handoffs: [{ at: new Date(NOW.getTime() - 3 * 86_400_000), urgent: false }],
    declines: [new Date(NOW.getTime() - 10 * 86_400_000), new Date(NOW.getTime() - 200 * 86_400_000)],
  },
  rel.since90(NOW),
);
check("Reliability counts over 90 days: late, no clock out, declined, handed off, no closeout", facts.lateArrivals === 1 && facts.missingClockOuts === 1 && facts.declines === 1 && facts.handoffs === 1 && facts.missingCloseouts === 1, JSON.stringify(facts));
check("Only admins tick Payroll setup done", !(await scdb.setPayrollDone(mgr, { staffId: "b1", done: true }, NOW)).ok && (await scdb.setPayrollDone(admin, { staffId: "b1", done: true }, NOW)).ok && (await scdb.roster(admin, NOW))!.rows.find((r) => r.staffId === "b1")!.payrollDone);
const ros = (await scdb.roster(admin, NOW))!;
const jo = ros.rows.find((r) => r.staffId === "b1")!;
check("The roster has one row per active person who works events", ros.rows.some((r) => r.staffId === "s1") && !ros.rows.some((r) => r.staffId === "a1") && jo.worked === 2 && jo.facts.noCloseout === 2);
check("Declines come from the offers", ros.rows.find((r) => r.staffId === "b3")!.facts.declined === 1);

// ----- 11. Pages load before the migration -----
for (const t of SCORE_TABLES) missingTables.add(t);
const before = (await scdb.roster(admin, NOW))!;
check("Before the migration the roster loads, everyone New, and says to run it", !before.ready && before.rows.length > 0 && before.rows.every((r) => r.result.tier === "new"));
check("Before the migration To rate, calls, badges and the form all load", (await scdb.toRate(admin, NOW))!.length > 0 && !(await scdb.callsView(admin, NOW))!.ready && Object.keys(await scdb.tierBadges(admin, ["b1"])).length === 0 && (await scdb.rateForm(admin, "e1", "b1", NOW)).ok);
check("Before the migration a save says to run it", (await scdb.saveRating(admin, { sessionId: "e1", staffId: "b1", marks: fives }, NOW)).ok === false);
const mig = src("supabase/migrations/20261220_staff_scorecard.sql");
check("One migration creates every table", SCORE_TABLES.every((t) => mig.includes(`create table if not exists public.${t}`)) && mig.includes("rated_by <> staff_id") && !/insert into public\.staff_ratings/.test(mig));

// ----- 12. CSV columns -----
missingTables.clear();
reset();
await scdb.saveRating(admin, { sessionId: "e1", staffId: "b1", marks: { ...fives, client: null }, clientFeedback: "Great, \"really\"" }, NOW);
const csv = (await scdb.ratingsCsvFor(admin, NOW))!.split("\r\n");
check(
  "Ratings CSV columns in order",
  csv[0] === "Event Date,Event,Package,Client,Bartender,Monday Call Done,Locked by Tuesday,Manual Signed,Client,Admin,Efficiency,Shopping List,Leftovers & Inventory,Comms w/ Admin,Confidence,Average,Lowest Mark,Tier,Client Feedback,Admin Notes,Leftover Report In",
  csv[0],
);
check("One row per person per event, blanks left blank", csv.length === 2 && csv[1].startsWith(`${addDays(today, -3)},Justin Reyes · Wedding,Full Bar,Justin Reyes,Jordan Lee,No,No,No,,5,5,5,5,5,5,5.00,5,New,"Great, ""really""",,No`), csv[1]);
check("Roster CSV has a header and a row each", (await scdb.rosterCsvFor(admin, NOW))!.split("\r\n")[0].startsWith("Name,Market,Events Worked,Events Rated"));

// ----- 13. Nothing reaches staff -----
const walk = (dir: string): string[] =>
  readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(new URL(`../${p}`, import.meta.url)).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
const staffFacing = [...walk("app/team"), ...walk("app/api/team"), ...walk("app/s")].filter((p) => !p.startsWith("app/team/admin/") && !p.startsWith("app/api/team/admin/"));
const leaks = staffFacing.filter((p) => /scorecard|TierBadge|staff_ratings|staff_reviews|checkin_calls/i.test(src(p)));
check("No staff facing page or route imports or reads scorecard data", leaks.length === 0, leaks.join(", "));
const libLeaks = walk("lib").filter((p) => !p.includes("scorecard") && p !== "lib/team/header-nav.ts" && /scorecard|staff_ratings|staff_reviews|staff_checkin_calls/.test(src(p)));
check("No other server code (texts, staff exports) reads scorecard tables", libLeaks.length === 0, libLeaks.join(", "));
check("No text went to anyone while scoring", texts.length === 0);
const shown = [...walk("app/team/admin/scorecard").filter((p) => !p.endsWith("/save.ts")), "app/team/admin/e/[id]/rate-team-card.tsx", "app/forbidden.tsx"].flatMap((p) => [...(src(p).match(/>\s*[A-Z][^<>{}();=]*</g) ?? []), ...(src(p).match(/"[A-Z][a-z][^"]*"/g) ?? [])]);
check("No hyphens in wording shown on screen", shown.every((t) => !t.includes("-")), shown.filter((t) => t.includes("-")).join(" | "));
const words = Object.values(sc.MARKS).map((m) => m.label + m.help).concat(Object.values(sc.TIER_LABEL), [sc.NOT_READY]);
check("No hyphens in the marks, tiers or messages", words.every((w) => !w.includes("-")));

done("scorecard");
