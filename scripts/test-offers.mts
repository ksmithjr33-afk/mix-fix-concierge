// Ranked shift offers: the daytime clock across quiet hours, nights, weekends,
// time zones and a clock change; who is eligible and why someone is skipped;
// the order (tier, then rank, the head start, tier windows, one tier wider on
// multi bartender events); taking an offer is a request that holds a spot
// until an admin or manager approves or passes (two requesting at once,
// withdraw, the 2 hour reminder, red after 4 daytime hours, the requested
// rate as the pay floor, the notes for a wedding, over 150 guests and an all
// Developing team); assign by hand; skip, pause, resume, stop; no
// response recorded apart from declines; the one "nobody took it" text to
// every admin and manager with alerts on; Automatic (Order reviewed, the start
// days, no count on file); the posted shift way kept; the offer order on the
// Scorecard (admins change, managers view, never your own record, history,
// new hires, Not placed yet); and what staff can see. Real code against the
// in-memory database.
// Run: node --no-warnings scripts/test-offers.mts

import { addDays, check, done, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const of = await import("../lib/team/offers.ts");
const odb = await import("../lib/team/offers-db.ts");
const sodb = await import("../lib/team/scorecard-offers-db.ts");
const rk = await import("../lib/team/scorecard-ranks.ts");
const rdb = await import("../lib/team/scorecard-ranks-db.ts");
const adb = await import("../lib/team/assignments-db.ts");
const sdb = await import("../lib/team/shifts-db.ts");
const avdb = await import("../lib/team/availability-db.ts");

const CT = "America/Chicago";
const PT = "America/Los_Angeles";
const at = (day: string, hh: number, mm = 0, tz = CT) => time.zonedInstant(day, hh * 60 + mm, tz);
const M = 60_000;
const local = (d: Date, tz = CT) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(d);

// ===== 1. The daytime clock =====
const MON = "2027-04-05"; // a Monday
check("Daytime is 9:00 AM up to 8:00 PM in the market", !of.inDaytime(at(MON, 8, 59), CT) && of.inDaytime(at(MON, 9), CT) && of.inDaytime(at(MON, 19, 59), CT) && !of.inDaytime(at(MON, 20), CT));
check("30 daytime minutes from 7:45 PM is 9:15 AM the next morning", of.addDaytime(at(MON, 19, 45), 30, CT).getTime() === at(addDays(MON, 1), 9, 15).getTime());
check("From 10:00 PM (quiet hours) the clock starts at 9:00 AM: 9:30 AM", of.addDaytime(at(MON, 22), 30, CT).getTime() === at(addDays(MON, 1), 9, 30).getTime());
check("From 6:00 AM the clock starts at 9:00 AM the same day", of.addDaytime(at(MON, 6), 30, CT).getTime() === at(MON, 9, 30).getTime());
check("3 daytime hours from 6:00 PM: 2 hours today, the last hour carries to 10:00 AM the next day", of.addDaytime(at(MON, 18), 180, CT).getTime() === at(addDays(MON, 1), 10).getTime());
check("A delay ending exactly at 8:00 PM rolls to 9:00 AM (never sent at 8)", of.addDaytime(at(MON, 19, 30), 30, CT).getTime() === at(addDays(MON, 1), 9).getTime());
const FRI = "2027-04-09";
check("Weekends count like any day: Friday 7:00 PM plus 3 hours is Saturday 11:00 AM", local(of.addDaytime(at(FRI, 19), 180, CT)) === "Sat 11:00");
check("Daytime between Friday 7:00 PM and Saturday 10:00 AM is 120 minutes", of.daytimeBetween(at(FRI, 19), at(addDays(FRI, 1), 10), CT) === 120);
check("Pacific time: 7:45 PM in Los Angeles plus 30 is 9:15 AM Los Angeles time", local(of.addDaytime(at(MON, 19, 45, PT), 30, PT), PT) === "Tue 09:15");
check("The same instant is daytime in Los Angeles but quiet hours in Dallas", of.inDaytime(at(MON, 19, 30, PT), PT) && !of.inDaytime(at(MON, 19, 30, PT), CT));
const DST = "2027-03-13"; // the Saturday before clocks go forward
check("Across the clock change: Saturday 7:30 PM plus 60 is Sunday 9:30 AM local", local(of.addDaytime(at(DST, 19, 30), 60, CT)) === "Sun 09:30");
const step = (due: Date) => ({ status: "planned", due_at: due.toISOString(), due_wide_at: null });
check("A due offer never goes out in quiet hours", !of.sendNow(step(at(MON, 20, 30)), 1, at(MON, 21, 30), CT) && !of.sendNow(step(at(MON, 7)), 1, at(MON, 7, 59), CT) && of.sendNow(step(at(MON, 7)), 1, at(MON, 9), CT));
check("Nothing goes out once every spot is taken", !of.sendNow(step(at(MON, 9)), 0, at(MON, 10), CT));

// ===== 2. Who is eligible (pure) =====
const EV: import("../lib/team/offers.ts").EventFit = { market: "dallas", day: "2027-04-17", wedding: false, guests: 100, bartenders: 1 };
const NOBUSY = { unavailable: new Set<string>(), onEvent: new Set<string>(), overlapping: new Set<string>(), certIssue: {} as Record<string, string> };
const cand = (o: Partial<import("../lib/team/offers.ts").Candidate> = {}) => ({ id: "p", name: "P", role: "bartender", active: true, in_offers: false, markets: ["dallas"], off_weekdays: [], weddings: true, solo: null, ...o });
check("Bartenders are always in offers; admins and managers only when switched on; bar backs, servers and helpers never", of.includedInOffers({ role: "bartender" }) && of.includedInOffers({ role: "admin", in_offers: true }) && of.includedInOffers({ role: "manager", in_offers: true }) && !of.includedInOffers({ role: "manager", in_offers: false }) && ["bar_back", "server", "event_helper"].every((role) => !of.includedInOffers({ role, in_offers: true })));
check("Eligible: same market, active, free, fits", of.skipReason(cand(), EV, NOBUSY) === null);
check("Skipped: another market", of.skipReason(cand({ markets: ["austin"] }), EV, NOBUSY) === "Not in this market");
check("Skipped: not active", of.skipReason(cand({ active: false }), EV, NOBUSY) === "Not active");
check("Skipped: a date marked off", of.skipReason(cand(), EV, { ...NOBUSY, unavailable: new Set(["p"]) }) === "Off that day");
check("Skipped: a weekday they never work", of.skipReason(cand({ off_weekdays: [of.weekdayOf(EV.day!)] }), EV, NOBUSY) === "Never works Saturdays");
check("Skipped: on an overlapping event", of.skipReason(cand(), EV, { ...NOBUSY, overlapping: new Set(["p"]) }) === "On another event at that time");
check("Skipped: certification (only passed in while enforced)", of.skipReason(cand(), EV, { ...NOBUSY, certIssue: { p: "TABC missing" } }) === "TABC missing");
check("Skipped: weddings no on a wedding", of.skipReason(cand({ weddings: false }), { ...EV, wedding: true }, NOBUSY) === "Not set for weddings" && of.skipReason(cand({ weddings: false }), EV, NOBUSY) === null);
check("Guest fit, one bartender: their solo number against all guests", of.skipReason(cand({ solo: 80 }), EV, NOBUSY) === "100 guests, solo number 80" && of.skipReason(cand({ solo: 100 }), EV, NOBUSY) === null);
check("Guest fit, more bartenders: guests divided by bartenders", of.skipReason(cand({ solo: 90 }), { ...EV, guests: 200, bartenders: 2 }, NOBUSY) === "100 guests per bartender, solo number 90" && of.skipReason(cand({ solo: 100 }), { ...EV, guests: 200, bartenders: 2 }, NOBUSY) === null);
check("A blank solo number means no limit", of.skipReason(cand({ solo: null }), { ...EV, guests: 900 }, NOBUSY) === null);

// ===== 3. The order (pure) =====
const R = (staffId: string, grp: 0 | 1 | 2, rank: number) => ({ staffId, grp, rank });
const S = { headStartMin: 30, windowMin: 180 };
const T0 = at(MON, 10);
const one = of.planTimes([R("d1", 2, 1), R("c1", 1, 1), R("t2", 0, 2), R("t1", 0, 1), R("c2", 1, 2)], T0, 1, S, CT);
const due = (p: import("../lib/team/offers.ts").Planned[], id: string) => p.find((x) => x.staffId === id)!;
check("Order: by tier, then by rank", one.map((p) => p.staffId).join(",") === "t1,t2,c1,c2,d1");
check("Top goes first with a 30 minute head start between ranks", due(one, "t1").dueAt.getTime() === T0.getTime() && due(one, "t2").dueAt.getTime() === T0.getTime() + 30 * M);
check("Core starts when Top's 3 hour window ends, staggered the same way", due(one, "c1").dueAt.getTime() === at(MON, 13).getTime() && due(one, "c2").dueAt.getTime() === at(MON, 13, 30).getTime());
check("Developing starts when Core's window ends (6 daytime hours in)", due(one, "d1").dueAt.getTime() === at(MON, 16).getTime());
check("One spot: no wider timing", one.every((p) => p.dueWideAt === null));
const two = of.planTimes([R("t1", 0, 1), R("t2", 0, 2), R("c1", 1, 1), R("c2", 1, 2), R("d1", 2, 1)], T0, 2, S, CT);
check("Two spots: the other spots open one tier wider, Core staggered right after Top", due(two, "c1").dueWideAt?.getTime() === T0.getTime() + 60 * M && due(two, "c2").dueWideAt?.getTime() === T0.getTime() + 90 * M);
check("Two spots: the first spot keeps its order (Core's one spot time is unchanged)", due(two, "c1").dueAt.getTime() === at(MON, 13).getTime());
check("Two spots: Developing opens when the wider window ends", due(two, "d1").dueWideAt?.getTime() === at(MON, 13).getTime());
check("With two open the wider time counts; with one open, the one spot order", of.effectiveDue({ due_at: at(MON, 13).toISOString(), due_wide_at: at(MON, 11).toISOString() }, 2).getTime() === at(MON, 11).getTime() && of.effectiveDue({ due_at: at(MON, 13).toISOString(), due_wide_at: at(MON, 11).toISOString() }, 1).getTime() === at(MON, 13).getTime());
const big = of.planTimes([1, 2, 3, 4, 5, 6, 7].map((n) => R(`t${n}`, 0, n)).concat([R("c1", 1, 1)]), T0, 1, S, CT);
check("A tier bigger than its window: the next tier waits for the last head start", due(big, "c1").dueAt.getTime() === T0.getTime() + 210 * M);
check("An empty tier takes no time", of.planTimes([R("c1", 1, 1)], T0, 1, S, CT)[0].dueAt.getTime() === T0.getTime());
const late = of.planTimes([R("t1", 0, 1), R("t2", 0, 2), R("c1", 1, 1)], at(MON, 19, 50), 1, S, CT);
check("Started at 7:50 PM: rank 1 at 7:50, rank 2 after quiet hours at 9:20 AM, Core 3 daytime hours after the start", local(due(late, "t1").dueAt) === "Mon 19:50" && local(due(late, "t2").dueAt) === "Tue 09:20" && local(due(late, "c1").dueAt) === "Tue 11:50");
const night = of.planTimes([R("t1", 0, 1), R("t2", 0, 2)], at(MON, 22), 1, S, CT);
check("Started in quiet hours: the first offer waits for 9:00 AM", local(due(night, "t1").dueAt) === "Tue 09:00" && local(due(night, "t2").dueAt) === "Tue 09:30");
check("Every planned time is daytime, so never in quiet hours", [...one, ...two, ...big, ...late, ...night].every((p) => of.inDaytime(p.dueAt, CT) && (!p.dueWideAt || of.inDaytime(p.dueWideAt, CT))));

// ===== 4. Request notes (pure) =====
const base = { wedding: false, guests: 100, holdOverGuests: 150, bartenders: 1, spots: 1, claims: [], teamApproved: false, developing: false };
check("No notes on an ordinary request", of.requestNotes(base).length === 0);
check("A wedding is noted", of.requestNotes({ ...base, wedding: true }).join() === "Wedding");
check("Over 150 guests is noted; exactly 150 is not", of.requestNotes({ ...base, guests: 151 }).join() === "Over 150 guests" && of.requestNotes({ ...base, guests: 150 }).length === 0);
check("Two bartenders, the last spot, all Developing: noted", of.requestNotes({ ...base, bartenders: 2, spots: 2, claims: [{ developing: true }], developing: true }).join() === "Every spot would be Developing");
check("...not when someone outside Developing took a spot, was on before, or it is not the last spot", of.requestNotes({ ...base, bartenders: 2, spots: 2, claims: [{ developing: false }], developing: true }).length === 0 && of.requestNotes({ ...base, bartenders: 2, spots: 2, claims: [{ developing: true }], developing: true, teamApproved: true }).length === 0 && of.requestNotes({ ...base, bartenders: 2, spots: 2, claims: [], developing: true }).length === 0);
check("Several notes together", of.requestNotes({ ...base, wedding: true, guests: 200 }).join(", ") === "Wedding, Over 150 guests");
check("The assign on accept setting is gone: approval is always required", !("assignOnAccept" in of.readOfferSettings({ assignOnAccept: true })) && !("assignOnAccept" in of.OFFER_DEFAULTS));

// ===== 5. Settings =====
const defaults = of.readOfferSettings(null);
check("Defaults: 30 minute head start, 3 hour window, 150 guests, 30 days, every market Suggest", defaults.headStartMin === 30 && defaults.windowMin === 180 && defaults.holdOverGuests === 150 && defaults.startDaysBefore === 30 && Object.values(defaults.modes).every((m) => m === "suggest"));
check("Automatic without Order reviewed reads as Suggest", of.readOfferSettings({ modes: { dallas: "automatic" } }).modes.dallas === "suggest");
const noAuto = of.validateOfferSettings({ headStartMin: 30, windowMin: 180, startDaysBefore: 30, modes: { dallas: "automatic" } }, defaults);
check("A market cannot be switched to Automatic until its order is reviewed", !noAuto.ok && noAuto.error.includes("Order reviewed"));
const reviewed = { ...defaults, reviewed: { dallas: { by: "Kenneth Smith", at: "2027-04-01T15:00:00Z" } } };
const yesAuto = of.validateOfferSettings({ headStartMin: 30, windowMin: 180, startDaysBefore: 30, modes: { dallas: "automatic" } }, reviewed);
check("...and can once it is", yesAuto.ok && yesAuto.value.modes.dallas === "automatic" && yesAuto.value.modes.austin === "suggest");

// ===== The database =====
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin", active: true, alerts: true, markets: ["dallas"], in_offers: false };
const admin2 = { id: "a2", name: "Riley Admin", phone: "+12145550101", role: "admin", active: true, alerts: false, markets: ["dallas"], in_offers: true };
const mgr = { id: "m1", name: "Alex Rivera", phone: "+12145550102", role: "manager", active: true, alerts: true, markets: ["dallas"], in_offers: false };
const mgrBar = { id: "m2", name: "Robin Hale", phone: "+12145550103", role: "manager", active: true, alerts: false, markets: ["dallas"], in_offers: true };
const mgrQuiet = { id: "m3", name: "Jesse Quiet", phone: "+12145550104", role: "manager", active: true, alerts: false, markets: ["dallas"], in_offers: false };
const B = (id: string, name: string, n: number, extra: Record<string, unknown> = {}) => ({ id, name, phone: `+1214555${String(2000 + n)}`, role: "bartender", active: true, alerts: false, markets: ["dallas"], in_offers: false, off_weekdays: [], ...extra });
const t1 = B("t1", "Tara Top", 1);
const t2 = B("t2", "Toby Top", 2);
const c1 = B("c1", "Cora Core", 3);
const c2 = B("c2", "Cal Core", 4);
const d1 = B("d1", "Dana Dev", 5);
const d2 = B("d2", "Dev Dean", 6);
const x1 = B("x1", "Austin Only", 7, { markets: ["austin"] });
const srv = { ...B("s1", "Pat Server", 8), role: "server" };
const PEOPLE = [admin, admin2, mgr, mgrBar, mgrQuiet, t1, t2, c1, c2, d1, d2, x1, srv];
const rank = (staff_id: string, tier: string, position: number, extra: Record<string, unknown> = {}) => ({ staff_id, tier, position, solo_guests: null, weddings: true, note: "", placed: true, ...extra });
const RANKS = () => [rank("t1", "top", 1), rank("t2", "top", 2), rank("c1", "core", 1), rank("c2", "core", 2), rank("m2", "core", 3), rank("a2", "core", 4), rank("d1", "developing", 1), rank("d2", "developing", 2), rank("x1", "top", 3)];

const DAY0 = "2027-04-17";
const dayN = (n: number) => addDays(DAY0, n);
const ev = (id: string, day: string, extra: Record<string, unknown> = {}, more: Record<string, unknown> = {}) => ({
  id,
  status: "submitted",
  version: 1,
  event_date: day,
  team_market: "dallas",
  team_market_source: "admin",
  package_type: "Full Bar",
  ...more,
  event_data: { client_name: "Justin Reyes", event_type: "Birthday", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: "1 Main St, Dallas, TX", guest_count: 100, package: "Full Bar", bartenders: 1, ...extra },
});

const TABLES = [
  "event_assignments", "staff_unavailability", "team_hidden_events", "shift_posts", "shift_notices", "shift_requests", "shift_handoffs", "staff_certifications", "team_settings",
  "time_punches", "assignment_mileage", "staff_rank", "staff_rank_history", "offer_runs", "offer_steps", "offer_claims", "staff_ratings", "staff_rating_versions", "staff_reviews",
  "staff_checkin_calls", "staff_setup_flags", "staff_sessions", "staff_profiles", "event_week_locks", "staff_onboarding", "staff_confirmations", "event_closeouts", "bar_ready_reports",
];
function reset(sessions: Record<string, unknown>[] = []) {
  for (const k of Object.keys(db)) delete db[k];
  for (const t of TABLES) db[t] = [];
  db.staff = PEOPLE.map((s) => ({ ...s }));
  db.staff_rank = RANKS();
  db.sessions = sessions;
  texts.length = 0;
}
const sess = (id: string) => db.sessions.find((s) => s.id === id) as never;
const run = (sessionId: string) => db.offer_runs.find((r) => r.session_id === sessionId)!;
const stepFor = (sessionId: string, staffId: string) => db.offer_steps.find((s) => s.run_id === run(sessionId)?.id && s.staff_id === staffId)!;
const asg = (sessionId: string, staffId: string) => db.event_assignments.find((a) => a.session_id === sessionId && a.staff_id === staffId);
const rankSnapshot = () => JSON.stringify(db.staff_rank.map((r) => [r.staff_id, r.tier, r.position]).sort());
const asStaff = (p: Record<string, unknown>) => p as never;

// ===== 6. Eligibility against real data =====
reset([ev("e0", DAY0), ev("other", DAY0, { bar_service_start: "5:00pm", bar_service_end: "9:00pm" }), ev("w0", dayN(1), { event_type: "Wedding" }), ev("g0", dayN(2), { guest_count: 200, bartenders: 2 })]);
db.staff_unavailability.push({ id: "u1", staff_id: "t2", start_day: addDays(DAY0, -1), end_day: addDays(DAY0, 1), note: null });
db.staff.find((s) => s.id === "c2")!.off_weekdays = [of.weekdayOf(DAY0)];
db.event_assignments.push({ id: "o1", session_id: "other", staff_id: "c1", status: "accepted" });
let plan = await sodb.planFor(sess("e0"), asStaff(admin), T0);
const skipped = Object.fromEntries(plan.skipped.map((s) => [s.name, s.reason]));
check("Plan: eligible people in order (tier, then rank), Austin and the server never listed", plan.order.map((o) => o.staffId).join(",") === "t1,m2,a2,d1,d2" && !plan.order.some((o) => ["x1", "s1", "m1", "m3", "a1"].includes(o.staffId)));
check("Plan: a date off, a weekday off, an overlapping event, each with its reason", skipped["Toby Top"] === "Off that day" && skipped["Cal Core"] === "Never works Saturdays" && skipped["Cora Core"] === "On another event at that time");
check("Plan: ranks renumbered among the eligible, so nobody waits on someone skipped", plan.order.find((o) => o.staffId === "m2")!.rank === 1 && plan.planned.find((p) => p.staffId === "m2")!.dueAt.getTime() === at(MON, 13).getTime());
check("Plan: the viewer's own line shows no tier or rank", (await sodb.planFor(sess("e0"), asStaff(admin2), T0)).order.find((o) => o.staffId === "a2")!.group === "");
check("A weekday off also counts for posted shifts and assigning (isUnavailable)", (await avdb.isUnavailable("c2", DAY0)) && (await avdb.unavailableOn(DAY0)).has("c2") && !(await avdb.unavailableOn(dayN(1))).has("c2"));
db.staff_rank.find((r) => r.staff_id === "t1")!.weddings = false;
plan = await sodb.planFor(sess("w0"), asStaff(admin), T0);
check("Wedding: weddings No is skipped", plan.skipped.some((s) => s.name === "Tara Top" && s.reason === "Not set for weddings") && !plan.order.some((o) => o.staffId === "t1"));
db.staff_rank.find((r) => r.staff_id === "d1")!.solo_guests = 90;
plan = await sodb.planFor(sess("g0"), asStaff(admin), T0);
check("Guests per bartender against the solo number (200 guests, 2 bartenders, solo 90)", plan.skipped.some((s) => s.name === "Dana Dev" && s.reason === "100 guests per bartender, solo number 90"));
db.team_settings.push({ key: "enforce_certifications", value: true });
for (const p of ["t1", "m2", "a2", "d2"]) db.staff_certifications.push({ id: `cert-${p}`, staff_id: p, cert_type: "TABC", file_path: "x", file_type: "image/png", expires_on: "2029-01-01", status: "approved", review_note: null, reviewed_by: "a1", reviewed_at: "2027-01-01T00:00:00Z", uploaded_by: p, created_at: "2027-01-01T00:00:00Z" });
plan = await sodb.planFor(sess("e0"), asStaff(admin), T0);
check("Certifications enforced: no valid certification is skipped with the reason", plan.skipped.some((s) => s.name === "Dana Dev" && /TABC/.test(s.reason)) && plan.order.some((o) => o.staffId === "d2"));
db.team_settings.length = 0;
plan = await sodb.planFor(sess("e0"), asStaff(admin), T0);
check("Certifications not enforced: nobody skipped for it", !plan.skipped.some((x) => /TABC/.test(x.reason)) && plan.order.some((o) => o.staffId === "t1"));

// ===== 7. Sending, requests, approval, no response =====
reset([ev("e1", DAY0)]);
const rank0 = rankSnapshot();
const started = await sodb.startOffers(asStaff(admin), sess("e1"), T0);
check("Suggest: an admin sends offers with one tap; rank 1 of Top is texted right away", started.ok && textsTo(t1).length === 1 && textsTo(t2).length === 0 && stepFor("e1", "t1").status === "sent");
const offerMsg = textsTo(t1)[0]?.message ?? "";
check("The offer text: date, city, times, a link to request it. Nothing about order, tiers or who else", offerMsg.startsWith("Mix Fix shift offer: ") && offerMsg.includes("Request it or pass") && offerMsg.includes("/team/offer/") && !of.ORDER_WORDS.test(offerMsg) && !/Justin|Reyes|Main St/.test(offerMsg));
await odb.advanceOffers(new Date(T0.getTime() + 29 * M));
check("29 minutes in: nobody else yet", textsTo(t2).length === 0);
await odb.advanceOffers(new Date(T0.getTime() + 30 * M));
check("30 daytime minutes in: rank 2 is texted", textsTo(t2).length === 1 && stepFor("e1", "t2").status === "sent");
texts.length = 0;
const requested = await odb.respondToOffer(stepFor("e1", "t2").id as string, asStaff(t2), "accept", new Date(T0.getTime() + 40 * M));
check("Taking an offer is a request: held, not on the event", requested.ok && requested.state === "held" && stepFor("e1", "t2").status === "held" && !asg("e1", "t2"));
check("...the request holds the spot", db.offer_claims.length === 1 && db.offer_claims[0].kind === "held");
check("...the person gets no text (the page says Request sent)", textsTo(t2).length === 0 && of.REQUEST_SENT === "Request sent. We will confirm with you.");
const reqText = textsTo(admin)[0]?.message ?? "";
check("...every admin and manager with alerts on is texted the person, the event and an approve link", textsTo(admin).length === 1 && textsTo(mgr).length === 1 && textsTo(admin2).length === 0 && textsTo(mgrQuiet).length === 0 && reqText.includes("Toby Top") && reqText.includes("Approve or pass") && reqText.includes("/team/admin/e/e1?tab=team"));
const page0 = await odb.offerForStaff(stepFor("e1", "t2").id as string, asStaff(t2), new Date(T0.getTime() + 41 * M));
check("The offer page shows the request sent, with nothing about anyone else", page0.state === "held" && Object.keys(page0).sort().join(",") === "date,state,stepId");
const again = await odb.respondToOffer(stepFor("e1", "t2").id as string, asStaff(t2), "accept", new Date(T0.getTime() + 42 * M));
check("Requesting twice says it is already requested", !again.ok && again.error.includes("already requested"));
await odb.advanceOffers(at(MON, 13, 30));
check("While the request covers the only open spot, no further offers go out", textsTo(c1).length === 0 && stepFor("e1", "c1").status === "planned");
const ownAnswer = await odb.confirmHeld(asStaff(t2), stepFor("e1", "t2").id, new Date(T0.getTime() + 45 * M));
check("Staff cannot approve", !ownAnswer.ok);
const approved = await odb.confirmHeld(asStaff(mgr), stepFor("e1", "t2").id, new Date(T0.getTime() + 50 * M));
check("Approve (a manager, one tap): on the event as accepted, the usual you got the shift text", approved.ok && asg("e1", "t2")?.status === "accepted" && asg("e1", "t2")?.role === "bartender" && textsTo(t2).some((t) => t.message.startsWith("You got the shift")) && stepFor("e1", "t2").status === "accepted");
check("Filled: rank 1 never answered and is recorded as No response, told it is filled", stepFor("e1", "t1").status === "no_response" && textsTo(t1).some((t) => t.message.includes("has been filled")) && run("e1").status === "filled");
check("Offers not sent yet are closed, and nobody else is texted", stepFor("e1", "c1").status === "closed" && textsTo(c1).length === 0);
check("No response never changes a rank", rankSnapshot() === rank0 && db.staff_rank_history.length === 0);
const late1 = await odb.respondToOffer(stepFor("e1", "t1").id as string, asStaff(t1), "accept", new Date(T0.getTime() + 60 * M));
check("Answering after it closed says so", !late1.ok && late1.error === "This offer is closed.");

// Two request at the same moment, one spot.
reset([ev("e2", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("e2"), T0);
await odb.advanceOffers(new Date(T0.getTime() + 30 * M));
const [r1, r2] = await Promise.all([
  odb.respondToOffer(stepFor("e2", "t1").id as string, asStaff(t1), "accept", new Date(T0.getTime() + 31 * M)),
  odb.respondToOffer(stepFor("e2", "t2").id as string, asStaff(t2), "accept", new Date(T0.getTime() + 31 * M)),
]);
const winners = [r1, r2].filter((r) => r.ok).length;
check("Two request at once: exactly one holds the spot, nobody is placed", winners === 1 && db.offer_claims.length === 1 && db.event_assignments.filter((a) => a.session_id === "e2").length === 0);
const loser = [r1, r2].find((r) => !r.ok) as { ok: false; error: string };
check("...the other is told it was just filled, without saying who or why", loser.error.startsWith("Sorry, this shift was just filled") && !of.ORDER_WORDS.test(loser.error));

// Pass: one neutral text, offers carry on to the next person.
reset([ev("e4", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("e4"), T0);
await odb.respondToOffer(stepFor("e4", "t1").id as string, asStaff(t1), "accept", new Date(T0.getTime() + 5 * M));
texts.length = 0;
const passed = await odb.releaseHeld(asStaff(admin), stepFor("e4", "t1").id, new Date(T0.getTime() + 40 * M));
check("Pass: the spot opens again, the request is recorded as Passed", passed.ok && stepFor("e4", "t1").status === "released" && of.STEP_LABEL.released === "Passed" && db.offer_claims.length === 0 && !asg("e4", "t1"));
check("...one neutral text, never who else asked or why", textsTo(t1).length === 1 && textsTo(t1)[0].message === "This shift has been filled. Thank you for requesting it." && !of.ORDER_WORDS.test(textsTo(t1)[0].message));
check("...offers carry on to the next person", stepFor("e4", "t2").status === "sent" && textsTo(t2).length === 1);

// Withdraw: like a pass.
reset([ev("e5", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("e5"), T0);
await odb.respondToOffer(stepFor("e5", "t1").id as string, asStaff(t1), "accept", new Date(T0.getTime() + 5 * M));
texts.length = 0;
const withdrew = await odb.respondToOffer(stepFor("e5", "t1").id as string, asStaff(t1), "withdraw", new Date(T0.getTime() + 40 * M));
check("Withdraw: the spot opens, offers carry on, no pass text", withdrew.ok && stepFor("e5", "t1").status === "released" && db.offer_claims.length === 0 && stepFor("e5", "t2").status === "sent" && textsTo(t1).length === 0);
check("...the page says they withdrew", (await odb.offerForStaff(stepFor("e5", "t1").id as string, asStaff(t1), new Date(T0.getTime() + 41 * M))).state === "withdrawn");
check("...an admin can no longer approve it", !(await odb.confirmHeld(asStaff(admin), stepFor("e5", "t1").id, new Date(T0.getTime() + 42 * M))).ok);
check("Withdraw with no request is refused", !(await odb.respondToOffer(stepFor("e5", "t2").id as string, asStaff(t2), "withdraw", new Date(T0.getTime() + 43 * M))).ok);

// Reminder after 2 daytime hours, red after 4, the Applications waiting list.
reset([ev("e6", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("e6"), T0);
await odb.respondToOffer(stepFor("e6", "t1").id as string, asStaff(t1), "accept", new Date(T0.getTime() + 5 * M));
texts.length = 0;
await odb.advanceOffers(new Date(T0.getTime() + 124 * M));
check("No reminder before 2 daytime hours", textsTo(admin).length === 0);
await odb.advanceOffers(new Date(T0.getTime() + 126 * M));
check("One reminder after 2 daytime hours to admins and managers with alerts on", textsTo(admin).length === 1 && textsTo(mgr).length === 1 && textsTo(admin).every((t) => t.message.startsWith("Still waiting:")));
await odb.advanceOffers(new Date(T0.getTime() + 200 * M));
check("...only once", textsTo(admin).length === 1);
let waiting = await odb.requestsWaiting(asStaff(admin), new Date(T0.getTime() + 200 * M));
check("Applications waiting: the person, the event, tier and rank for admins", waiting.length === 1 && waiting[0].name === "Tara Top" && waiting[0].group === "Top" && waiting[0].rank === 1 && waiting[0].sessionId === "e6" && !waiting[0].red);
waiting = await odb.requestsWaiting(asStaff(admin), new Date(T0.getTime() + 250 * M));
check("...red after 4 daytime hours, on the list and the Team tab", waiting[0].red && (await odb.runView(asStaff(admin), "e6", new Date(T0.getTime() + 250 * M)))!.held[0].waitingRed);
check("...nothing for staff", (await odb.requestsWaiting(asStaff(t2))).length === 0);
const ownList = await odb.requestsWaiting(asStaff({ ...t1, role: "manager" }), new Date(T0.getTime() + 250 * M));
check("...your own request shows without tier or rank, and you cannot approve it", ownList[0].self && ownList[0].group === "" && ownList[0].rank === null && !(await odb.confirmHeld(asStaff({ ...t1, role: "manager" }), stepFor("e6", "t1").id)).ok);
const night6 = await odb.advanceOffers(at(MON, 22));
check("Reminders never go out in quiet hours", night6 === 0);

// Pay floor: the rate when they requested.
reset([ev("e7", DAY0, {}, { pricing_model: "service_fee" })]);
await sodb.startOffers(asStaff(admin), sess("e7"), T0);
await odb.respondToOffer(stepFor("e7", "t1").id as string, asStaff(t1), "accept", new Date(T0.getTime() + 5 * M));
const reqRate = stepFor("e7", "t1").requested_rate_cents as number | null;
check("The service fee rate is stored with the request", typeof reqRate === "number" && reqRate > 0);
stepFor("e7", "t1").requested_rate_cents = 4500;
await odb.confirmHeld(asStaff(admin), stepFor("e7", "t1").id, new Date(T0.getTime() + 60 * M));
check("Approving stores the rate when they requested as the pay floor", asg("e7", "t1")?.accepted_rate_cents === 4500);
reset([ev("e8", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("e8"), T0);
await odb.respondToOffer(stepFor("e8", "t1").id as string, asStaff(t1), "accept", new Date(T0.getTime() + 5 * M));
check("Gratuity events store no requested rate", stepFor("e8", "t1").requested_rate_cents == null);

// Decline.
reset([ev("e3", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("e3"), T0);
const dec = await odb.respondToOffer(stepFor("e3", "t1").id as string, asStaff(t1), "decline", new Date(T0.getTime() + 5 * M));
check("A decline is recorded for admins, as Declined, apart from No response", dec.ok && stepFor("e3", "t1").status === "declined" && of.STEP_LABEL.declined !== of.STEP_LABEL.no_response);
check("A decline texts no one and never changes a rank", texts.filter((t) => t.phone !== t1.phone).length === 0 && rankSnapshot() === JSON.stringify(RANKS().map((r) => [r.staff_id, r.tier, r.position]).sort()) && db.staff_rank_history.length === 0);
await odb.advanceOffers(new Date(T0.getTime() + 30 * M));
check("...and offers carry on to the next person on time", textsTo(t2).length === 1);
const view = await odb.runView(asStaff(admin), "e3", new Date(T0.getTime() + 31 * M));
check("Team tab: who was offered and when, who declined, who is next and at what time", !!view && view.steps.find((s) => s.name === "Tara Top")!.label === "Declined" && !!view.steps.find((s) => s.name === "Toby Top")!.sentAt && view.next?.name === "Cora Core" && view.next.at === at(MON, 13).toISOString());
check("Team tab: tier and rank shown to admins", view!.steps[0].group === "Top" && view!.steps[0].rank === 1);
check("Team tab: nothing for staff", (await odb.runView(asStaff(t1), "e3")) === null && (await sodb.offersPanel(asStaff(t1), sess("e3"))) === null);

// ===== 8. Notes on the request: wedding, over 150, all Developing; every tier needs approval =====
reset([ev("w1", DAY0, { event_type: "Wedding" })]);
await sodb.startOffers(asStaff(admin), sess("w1"), T0);
texts.length = 0;
const held = await odb.respondToOffer(stepFor("w1", "t1").id as string, asStaff(t1), "accept", new Date(T0.getTime() + 5 * M));
check("Wedding: a Top request waits for approval like any other, not assigned yet", held.ok && held.state === "held" && !asg("w1", "t1") && stepFor("w1", "t1").status === "held");
check("...the wedding is noted on the request and in the admin text", stepFor("w1", "t1").skip_reason === "Wedding" && textsTo(admin).some((t) => t.message.includes("Look closer: Wedding")));
await odb.advanceOffers(new Date(T0.getTime() + 60 * M));
check("While requested, the spot is taken: nobody else is offered", textsTo(t2).length === 0);
const stopHeld = await odb.stopRun(asStaff(admin), run("w1").id, new Date(T0.getTime() + 61 * M));
check("Stop refuses while a request is waiting", !stopHeld.ok);
const conf = await odb.confirmHeld(asStaff(admin), stepFor("w1", "t1").id, new Date(T0.getTime() + 62 * M));
check("Approve: assigned as accepted, told they got it, offers end", conf.ok && asg("w1", "t1")?.status === "accepted" && textsTo(t1).some((t) => t.message.startsWith("You got the shift")) && run("w1").status === "filled");

reset([ev("g1", DAY0, { guest_count: 200 })]);
await sodb.startOffers(asStaff(admin), sess("g1"), T0);
const big1 = await odb.respondToOffer(stepFor("g1", "t1").id as string, asStaff(t1), "accept", new Date(T0.getTime() + 5 * M));
check("Over 150 guests: noted on the request", big1.ok && big1.state === "held" && stepFor("g1", "t1").skip_reason === "Over 150 guests");

reset([ev("dv", DAY0, { bartenders: 2 })]);
for (const p of ["t1", "t2", "c1", "c2", "m2", "a2"]) db.staff_unavailability.push({ id: `u-${p}`, staff_id: p, start_day: DAY0, end_day: DAY0, note: null });
await sodb.startOffers(asStaff(admin), sess("dv"), T0);
const dv1 = await odb.respondToOffer(stepFor("dv", "d1").id as string, asStaff(d1), "accept", new Date(T0.getTime() + 5 * M));
await odb.advanceOffers(new Date(T0.getTime() + 30 * M));
const dv2 = await odb.respondToOffer(stepFor("dv", "d2").id as string, asStaff(d2), "accept", new Date(T0.getTime() + 35 * M));
check("Two spots, two requests: both wait, nobody is placed", dv1.ok && dv1.state === "held" && dv2.ok && dv2.state === "held" && !asg("dv", "d1") && !asg("dv", "d2"));
check("...the request that would make the whole team Developing is noted", stepFor("dv", "d2").skip_reason === "Every spot would be Developing" && !stepFor("dv", "d1").skip_reason);
check("...with both spots covered by requests, no further offers go out", (await odb.advanceOffers(new Date(T0.getTime() + 200 * M))) >= 0 && db.offer_steps.filter((s) => s.run_id === run("dv").id && s.status === "sent").length === 0);

// ===== 9. Assign by hand, skip, pause, resume, stop =====
reset([ev("h1", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("h1"), T0);
const hand = await adb.assignStaff(sess("h1"), "c1", asStaff(admin), "https://plan.test", { confirmUnavailable: true });
check("Assigning by hand always works and ends the offers for that spot", hand.ok && asg("h1", "c1")?.status === "offered" && run("h1").status === "filled" && db.offer_claims.some((c) => c.kind === "hand"));
check("...anyone offered who had not answered is recorded as No response and told it is filled", stepFor("h1", "t1").status === "no_response" && textsTo(t1).some((t) => t.message.includes("has been filled")));

reset([ev("p1", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("p1"), T0);
const skip = await odb.skipStep(asStaff(admin), stepFor("p1", "t2").id);
await odb.advanceOffers(new Date(T0.getTime() + 31 * M));
check("Skip: that person is never offered", skip.ok && stepFor("p1", "t2").status === "skipped" && stepFor("p1", "t2").skipped_by_name === "Kenneth Smith" && textsTo(t2).length === 0);
const c1Before = stepFor("p1", "c1").due_at as string;
await odb.pauseRun(asStaff(admin), run("p1").id, new Date(T0.getTime() + 40 * M));
await odb.advanceOffers(at(MON, 13, 30));
check("Paused: nothing goes out, even when due", textsTo(c1).length === 0);
await odb.resumeRun(asStaff(admin), run("p1").id, new Date(T0.getTime() + 100 * M));
check("Resume: offers not sent yet move later by the daytime the pause took (60 minutes)", new Date(stepFor("p1", "c1").due_at as string).getTime() === new Date(c1Before).getTime() + 60 * M);
const stop = await odb.stopRun(asStaff(admin), run("p1").id, new Date(T0.getTime() + 110 * M));
check("Stop: no more offers; anyone offered who never answered is No response and told it is closed", stop.ok && run("p1").status === "stopped" && stepFor("p1", "t1").status === "no_response" && textsTo(t1).some((t) => t.message.includes("is closed")) && stepFor("p1", "c1").status === "closed");
check("Staff controls are refused", !(await odb.pauseRun(asStaff(t1), run("p1").id)).ok && !(await odb.skipStep(asStaff(t1), stepFor("p1", "c1").id)).ok && !(await sodb.startOffers(asStaff(t1), sess("p1"), T0)).ok);

// ===== 10. Quiet hours with the database =====
reset([ev("q1", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("q1"), at(MON, 21, 30));
check("Sent at 9:30 PM: nothing goes out in quiet hours", textsTo(t1).length === 0 && local(new Date(stepFor("q1", "t1").due_at as string)) === "Tue 09:00");
await odb.advanceOffers(at(addDays(MON, 1), 8, 59));
check("8:59 AM: still nothing", textsTo(t1).length === 0);
await odb.advanceOffers(at(addDays(MON, 1), 9));
check("9:00 AM: rank 1 goes out; rank 2 is due at 9:30", textsTo(t1).length === 1 && local(new Date(stepFor("q1", "t2").due_at as string)) === "Tue 09:30");

// ===== 11. When nobody takes it =====
reset([ev("x1e", DAY0)]);
for (const p of ["t2", "c1", "c2", "m2", "a2", "d1", "d2"]) db.staff_unavailability.push({ id: `u-${p}`, staff_id: p, start_day: DAY0, end_day: DAY0, note: null });
await sodb.startOffers(asStaff(admin), sess("x1e"), T0);
const alertTo = (p: { phone: string }) => textsTo(p).filter((t) => t.message.startsWith("Shift offers: nobody has taken"));
check("Everyone offered and a spot open: one text to every admin and manager with alerts on", alertTo(admin).length === 1 && alertTo(mgr).length === 1 && alertTo(mgrQuiet).length === 0 && alertTo(mgrBar).length === 0);
check("...naming the event and what is open", (alertTo(admin)[0]?.message ?? "").includes("Justin Reyes") && (alertTo(admin)[0]?.message ?? "").includes("1 of 1 bartender spot") && (alertTo(admin)[0]?.message ?? "").includes("Everyone eligible has been offered"));
await odb.advanceOffers(new Date(T0.getTime() + 60 * M));
check("...only once", alertTo(admin).length === 1 && alertTo(t1).length === 0);
reset([ev("soon", addDays(MON, 3))]);
await sodb.startOffers(asStaff(admin), sess("soon"), T0);
check("Within 5 days with a spot open: the one text, even with people still to offer", alertTo(admin).length === 1 && (alertTo(admin)[0]?.message ?? "").includes("3 days out") && stepFor("soon", "c1").status === "planned");
reset([ev("soonq", addDays(MON, 3))]);
await sodb.startOffers(asStaff(admin), sess("soonq"), at(MON, 22));
check("The alert waits out quiet hours", alertTo(admin).length === 0);
await odb.advanceOffers(at(addDays(MON, 1), 8));
check("...and goes at 8:00 AM", alertTo(admin).length === 1);

// ===== 12. Automatic =====
reset([
  ev("auto", dayN(0)),
  ev("nocount", dayN(1), { bartenders: undefined, guest_count: 100 }),
  ev("far", addDays(MON, 45)),
  ev("posted", dayN(2)),
  ev("austin", dayN(3), {}, { team_market: "austin" }),
]);
db.shift_posts.push({ id: "post1", session_id: "posted", market: "dallas", kind: "open", status: "posted", posted_at: T0.toISOString() });
const tryAuto = await odb.saveOfferSettings(asStaff(admin), { headStartMin: 30, windowMin: 180, startDaysBefore: 30, modes: { dallas: "automatic" } });
check("Automatic is refused until the order is reviewed", !tryAuto.ok && /Order reviewed/.test(tryAuto.error));
check("A manager cannot change settings or mark the order reviewed", !(await odb.markOrderReviewed(asStaff(mgr), "dallas")).ok && !(await odb.saveOfferSettings(asStaff(mgr), {})).ok);
await odb.markOrderReviewed(asStaff(admin), "dallas", T0);
const okAuto = await odb.saveOfferSettings(asStaff(admin), { headStartMin: 30, windowMin: 180, startDaysBefore: 30, modes: { dallas: "automatic" } });
check("...and allowed once an admin tapped Order reviewed", okAuto.ok && (await odb.offerSettings()).modes.dallas === "automatic" && (await odb.offerSettings()).reviewed.dallas?.by === "Kenneth Smith");
const n = await sodb.autoStartOffers(T0);
check("Automatic starts offers on its own for an event that needs staff within 30 days", n === 1 && !!run("auto") && textsTo(t1).length === 1);
check("Never an event with no bartender count on file, one too far out, a posted shift, or a Suggest market", !run("nocount") && !run("far") && !run("posted") && !run("austin"));
const panel = await sodb.offersPanel(asStaff(admin), sess("nocount"), T0);
check("No count on file is flagged on the Team tab", !!panel && panel.noCount && panel.plan?.block === "No bartender count on file. Set it so offers can start.");
check("Automatic does not start the same event twice", (await sodb.autoStartOffers(new Date(T0.getTime() + 5 * M))) === 0);
await odb.stopRun(asStaff(admin), run("auto").id, new Date(T0.getTime() + 6 * M));
check("...and never restarts offers an admin stopped", (await sodb.autoStartOffers(new Date(T0.getTime() + 10 * M))) === 0);
const startDays = await odb.saveOfferSettings(asStaff(admin), { headStartMin: 30, windowMin: 180, startDaysBefore: 60 });
check("Start days is a setting: at 60, the far event starts", startDays.ok && (await sodb.autoStartOffers(new Date(T0.getTime() + 15 * M))) === 1 && !!run("far"));

// ===== 13. The posted shift way stays =====
reset([ev("ps", DAY0), ev("ps2", dayN(1))]);
await sodb.startOffers(asStaff(admin), sess("ps"), T0);
const refused = await sdb.postShift(sess("ps"), asStaff(admin), T0);
check("Posting is refused while offers run on the event", !refused.ok && refused.error === sdb.OFFERS_RUNNING);
const posted = await sdb.postShift(sess("ps2"), asStaff(admin), T0);
check("Posting still works on any other event", posted.ok);
const both = await sodb.startOffers(asStaff(admin), sess("ps2"), T0);
check("Offers are refused on a posted event", !both.ok && both.error.includes("Unpost it first"));
await odb.stopRun(asStaff(admin), run("ps").id, T0);
check("After stopping, the event can be posted", (await sdb.postShift(sess("ps"), asStaff(admin), T0)).ok);
reset([ev("off", DAY0)]);
db.team_settings.push({ key: "ranked_offers", value: { modes: { dallas: "off" } } });
check("Mode Off: offers cannot start", !(await sodb.startOffers(asStaff(admin), sess("off"), T0)).ok);

// ===== 14. What staff can see =====
reset([ev("v1", DAY0)]);
await sodb.startOffers(asStaff(admin), sess("v1"), T0);
const page = await odb.offerForStaff(stepFor("v1", "t1").id as string, asStaff(t1), T0);
check("The offer page: the shift summary only, no tier, rank or order", page.state === "open" && Object.keys(page).sort().join(",") === "shift,state,stepId" && !/"grp"|"rank"|"tier"|Top|Core|Developing/.test(JSON.stringify(page)));
check("An offer not sent yet does not exist for its person", (await odb.offerForStaff(stepFor("v1", "t2").id as string, asStaff(t2), T0)).state === "gone");
check("Someone else's offer: nothing", (await odb.offerForStaff(stepFor("v1", "t1").id as string, asStaff(c1), T0)).state === "gone" && !(await odb.respondToOffer(stepFor("v1", "t1").id as string, asStaff(c1), "accept", T0)).ok);
const staffTexts = [of.offerText({ shortDate: "Sat, Apr 17", city: "Dallas", arrive: "5:00 PM", service: "6:00 PM to 10:00 PM", link: "x" }), of.REQUEST_SENT, of.REQUEST_PASSED_TEXT, of.offerFilledText({ date: "Sat, Apr 17" }), of.offerClosedText({ date: "Sat, Apr 17" })];
check("No text a staff member can get mentions order, tiers, ranks or anyone else", staffTexts.every((t) => !of.ORDER_WORDS.test(t)));
check("Every text that went to staff in this run is clean too", texts.filter((t) => ![admin, mgr].some((p) => p.phone === t.phone)).every((t) => !of.ORDER_WORDS.test(t.message)));

// ===== 15. The offer order on the Scorecard =====
reset([]);
db.staff.push({ id: "n1", name: "Nia New", phone: "+12145559999", role: "bartender", active: true, alerts: false, markets: ["dallas"], in_offers: false, off_weekdays: [6] });
const board = await rdb.rankBoard(asStaff(admin));
const dallas = board!.markets.find((m) => m.market === "dallas")!;
const dev = dallas.tiers.find((t) => t.tier === "developing")!.people;
check("A new hire starts at the bottom of Developing, weddings No, tagged Not placed yet", dev[dev.length - 1].staffId === "n1" && !dev[dev.length - 1].weddings && !dev[dev.length - 1].placed && db.staff_rank.find((r) => r.staff_id === "n1")!.placed === false);
check("The board never shows the viewer, never managers or admins not switched on, never servers", !dallas.tiers.flatMap((t) => t.people).some((p) => ["a1", "m1", "m3", "s1"].includes(p.staffId)) && dallas.tiers.flatMap((t) => t.people).some((p) => p.staffId === "m2" && p.roleNote === "Manager"));
check("Each person: rank, what reviews suggest, solo guests, weddings, days off", dallas.tiers[0].people[0].line === "Rank: Top 1. Reviews suggest: Not enough reviews." && dev[dev.length - 1].daysOff === "Never Saturday");
check("Austin has its own list", board!.markets.find((m) => m.market === "austin")!.tiers[0].people.map((p) => p.staffId).join(",") === "x1");
const mBoard = await rdb.rankBoard(asStaff(mgr));
check("Managers can view, not change", !!mBoard && !mBoard.canEdit && board!.canEdit);
const mMove = await rdb.moveRank(asStaff(mgr), { staffId: "c2", dir: "up", market: "dallas" });
const mEdit = await rdb.editRank(asStaff(mgr), { staffId: "c2", solo: 50, weddings: true, note: "" });
const mTier = await rdb.setTier(asStaff(mgr), { staffId: "c2", tier: "top" });
const mInc = await rdb.setIncluded(asStaff(mgr), { staffId: "m3", on: true });
check("A manager is refused (403) on every change", [mMove, mEdit, mTier, mInc].every((r) => !r.ok && r.status === 403));
check("Staff get nothing", (await rdb.rankBoard(asStaff(t1))) === null && !(await rdb.moveRank(asStaff(t1), { staffId: "c2", dir: "up" })).ok && !(await rdb.rankHistory(asStaff(t1), "c2")).ok);
const a2Board = await rdb.rankBoard(asStaff(admin2));
check("Someone included in offers never sees their own row", !a2Board!.markets.flatMap((m) => m.tiers.flatMap((t) => t.people)).some((p) => p.staffId === "a2"));
const selfMoves = [await rdb.moveRank(asStaff(admin2), { staffId: "a2", dir: "up", market: "dallas" }), await rdb.editRank(asStaff(admin2), { staffId: "a2", solo: 10, weddings: true, note: "" }), await rdb.setTier(asStaff(admin2), { staffId: "a2", tier: "top" }), await rdb.setIncluded(asStaff(admin2), { staffId: "a2", on: false }), await rdb.rankHistory(asStaff(admin2), "a2")];
check("Nobody can change or read their own record", selfMoves.every((r) => !r.ok && r.status === 403) && db.staff_rank.find((r) => r.staff_id === "a2")!.position === 4);
const NOW = new Date("2027-04-01T15:00:00Z");
const up = await rdb.moveRank(asStaff(admin), { staffId: "c2", dir: "up", market: "dallas" }, NOW);
const pos = (id: string) => db.staff_rank.find((r) => r.staff_id === id)!;
check("Up swaps with the person above in the same tier", up.ok && pos("c2").position === 1 && pos("c1").position === 2 && pos("c2").tier === "core");
check("Who changed it and when is saved, with history for both people moved", pos("c2").updated_by_name === "Kenneth Smith" && db.staff_rank_history.length === 2 && db.staff_rank_history.every((h) => h.changed_by === "a1" && h.changed_at === NOW.toISOString()));
await rdb.moveRank(asStaff(admin), { staffId: "c2", dir: "up", market: "dallas" }, NOW);
check("Up from the top of a tier moves to the bottom of the tier above", pos("c2").tier === "top" && pos("c2").position === 4);
await rdb.moveRank(asStaff(admin), { staffId: "c2", dir: "down", market: "dallas" }, NOW);
check("Down from the bottom of a tier moves to the top of the tier below", pos("c2").tier === "core" && pos("c2").position < pos("c1").position);
const n1Tier = await rdb.setTier(asStaff(admin), { staffId: "n1", tier: "core" }, NOW);
check("Changing the tier puts them at the bottom of it, and placed", n1Tier.ok && pos("n1").tier === "core" && pos("n1").placed === true && pos("n1").position > pos("a2").position);
const badSolo = await rdb.editRank(asStaff(admin), { staffId: "d1", solo: "abc", weddings: true, note: "" });
const goodEdit = await rdb.editRank(asStaff(admin), { staffId: "d1", solo: "75", weddings: false, note: "Great with corporate" }, NOW);
check("Solo guests, weddings and a short note are saved with history", !badSolo.ok && goodEdit.ok && pos("d1").solo_guests === 75 && pos("d1").weddings === false && pos("d1").note === "Great with corporate");
const hist = await rdb.rankHistory(asStaff(mgr), "d1");
check("History can be read by admins and managers", hist.ok && hist.lines[0].by === "Kenneth Smith" && hist.lines[0].what.includes("Solo guests 75") && hist.lines[0].what.includes("Weddings no"));
check("A note over the limit is refused", !(await rdb.editRank(asStaff(admin), { staffId: "d1", solo: "", weddings: true, note: "x".repeat(rk.RANK_NOTE_MAX + 1) })).ok);
const inc = await rdb.setIncluded(asStaff(admin), { staffId: "m3", on: true });
check("Include in bartender offers: an admin switches on a manager, who is added at the bottom of Developing", inc.ok && db.staff.find((s) => s.id === "m3")!.in_offers === true && pos("m3").tier === "developing" && !pos("m3").placed);
check("Bartenders cannot be switched (they are always in)", !(await rdb.setIncluded(asStaff(admin), { staffId: "t1", on: false })).ok);
// Manual always wins: reviews that say Ace never move someone placed in Developing.
for (const [i, d] of ["2027-03-01", "2027-03-08", "2027-03-15"].entries()) {
  db.sessions.push(ev(`past${i}`, d));
  db.staff_ratings.push({ id: `r${i}`, session_id: `past${i}`, staff_id: "d2", client: 5, admin: 5, efficiency: 5, shopping: 5, leftovers: 5, comms: 5, confidence: 5, mark_notes: {}, rated_at: `${d}T23:00:00Z` });
}
const b2 = await rdb.rankBoard(asStaff(admin));
const d2Row = b2!.markets.find((m) => m.market === "dallas")!.tiers.find((t) => t.tier === "developing")!.people.find((p) => p.staffId === "d2")!;
check('Manual always wins, with the reviews shown beside it ("Rank: Developing 2. Reviews suggest: Top.")', d2Row.line === "Rank: Developing 2. Reviews suggest: Top." && pos("d2").tier === "developing");
const order = await rdb.offerOrder("dallas");
check("The offer order follows the manual tier, not the reviews", order.order.find((o) => o.staffId === "d2")!.grp === 2);

done("offers");
