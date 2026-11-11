// Part 4: post event closeout.
// Run: node --no-warnings scripts/test-closeout.mts

import { check, done, event, hooks, src, texts, textsTo, CLIENT } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const co = await import("../lib/team/closeout.ts");
const coDb = await import("../lib/team/closeout-db.ts");

const CT = "America/Chicago";
const today = time.todayIn(CT);
const at = (min: number) => time.zonedInstant(today, min, CT);
const ed = { event_date: today, bar_service_start: "6:00pm", bar_service_end: "10:00pm" };
const photo = { type: "image/jpeg", size: 50_000 };
const gear = co.companyGear();

// ----- The rules -----
check("Company gear comes from the From The Mix Fix checklist", gear.length > 0);
check("Closed before 30 minutes ahead of service end", !co.closeoutOpen(ed, { clockedOut: false, now: at(21 * 60 + 29) }));
check("Open from 30 minutes before service end", co.closeoutOpen(ed, { clockedOut: false, now: at(21 * 60 + 30) }));
check("Open any time after clocking out", co.closeoutOpen(ed, { clockedOut: true, now: at(19 * 60) }));
check("Editable for 24 hours", co.canEdit(at(22 * 60).toISOString(), new Date(at(22 * 60).getTime() + 23.9 * 3_600_000)) && !co.canEdit(at(22 * 60).toISOString(), new Date(at(22 * 60).getTime() + 24 * 3_600_000)));
check("A rating is required", !co.validateCloseout({}, photo, { hasPhoto: false }).ok);
check("A photo is required on the first submit", (() => { const r = co.validateCloseout({ rating: "great" }, null, { hasPhoto: false }); return !r.ok && /photo/i.test(r.error); })());
check("An edit can keep its photo", co.validateCloseout({ rating: "great" }, null, { hasPhoto: true }).ok);
check("A file that is not a photo is refused", !co.validateCloseout({ rating: "great" }, { type: "application/pdf", size: 10 }, { hasPhoto: false }).ok);
check("Gear must come from the list", !co.validateCloseout({ rating: "fine", gear: ["A jet ski"] }, photo, { hasPhoto: false }).ok);
check("The guest count is a whole number", !co.validateCloseout({ rating: "fine", guests: "about 80" }, photo, { hasPhoto: false }).ok && !co.validateCloseout({ rating: "fine", guests: "-3" }, photo, { hasPhoto: false }).ok);
check("Notes are trimmed and capped", (() => { const r = co.validateCloseout({ rating: "fine", issues: "  x".repeat(900), leftover: " 2 vodka " }, photo, { hasPhoto: false }); return r.ok && r.value.issues.length <= co.ISSUES_MAX && r.value.leftoverNote === "2 vodka"; })());
check("Had problems alerts", co.needsAlert({ rating: "had_problems", gearItems: [], gearNote: "" }));
check("Broken gear alerts", co.needsAlert({ rating: "great", gearItems: [gear[0]], gearNote: "" }) && co.needsAlert({ rating: "great", gearItems: [], gearNote: "Cracked shaker" }));
check("A clean great or fine closeout does not alert", !co.needsAlert({ rating: "great", gearItems: [], gearNote: "" }) && !co.needsAlert({ rating: "fine", gearItems: [], gearNote: "  " }));
const payload = co.closeoutWebhookPayload({ clientEmail: CLIENT.client_email, eventDate: today, eventTitle: "Justin's 30th", rating: "had_problems", closeouts: 1 });
check("The GHL payload carries only the allowed fields", JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(["client_email", "closeouts", "event_date", "event_title", "had_problems", "overall_rating"]));
check("had_problems follows the rating", payload.had_problems === true && co.closeoutWebhookPayload({ clientEmail: "", eventDate: null, eventTitle: "x", rating: "great", closeouts: 1 }).had_problems === false);

// ----- Database -----
process.env.NEXT_PUBLIC_SITE_URL = "https://team.test";
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const quiet = { id: "a2", name: "Office Two", phone: "+12145550101", role: "admin" as const, active: true, alerts: false };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const b3 = { id: "b3", name: "Riley Park", phone: "+12145550113", role: "bartender" as const, active: true };
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [event("e1", today, "1 Elm St, Dallas, TX", {}, { team_market: "dallas", team_market_source: "auto" })];
  db.staff = [admin, quiet, b1, b2, b3].map((s) => ({ ...s, markets: ["dallas"] }));
  db.event_assignments = [
    { id: "as1", session_id: "e1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "e1", staff_id: "b2", status: "accepted" },
    { id: "as3", session_id: "e1", staff_id: "b3", status: "offered" },
  ];
  for (const t of ["event_closeouts", "event_closeout_versions", "team_notices", "time_punches", "team_hidden_events"]) db[t] = [];
  texts.length = 0;
  hooks.length = 0;
}
const GHL = "https://hooks.test/closeout";
const submit = (s: typeof b1, raw: Record<string, unknown>, now: Date, withPhoto = true) =>
  coDb.submitCloseout({ sessionId: "e1", staff: s, raw, photo: withPhoto ? new Blob(["x".repeat(100)], { type: "image/jpeg" }) : null, photoType: "image/jpeg", now });

reset();
process.env.GHL_EVENT_CLOSEOUT_WEBHOOK = GHL;
check("Closed early in the evening with no clock out", !(await submit(b1, { rating: "great" }, at(20 * 60))).ok && db.event_closeouts.length === 0);
check("Someone only offered the shift cannot send one", !(await submit(b3, { rating: "great" }, at(21 * 60 + 45))).ok);
check("No photo, no closeout", !(await submit(b1, { rating: "great" }, at(21 * 60 + 45), false)).ok && db.event_closeouts.length === 0);
const first = await submit(b1, { rating: "great", guests: "85", issues: "Host loved it. Client said call 972-555-0199", leftover: "2 vodka" }, at(21 * 60 + 45));
check("A bartender sends a closeout", first.ok && first.first && db.event_closeouts.length === 1 && db.event_closeouts[0].guest_estimate === 85, first.ok ? "" : first.error);
check("The photo is stored under closeout/ in the private bucket", String(db.event_closeouts[0]?.photo_path).startsWith("closeout/e1/b1/"));
check("The save is kept as version 1", db.event_closeout_versions.length === 1 && db.event_closeout_versions[0].version === 1);
check("A clean closeout texts nobody", texts.length === 0);
check("The first closeout sends GHL one webhook", hooks.filter((h) => h.url === GHL).length === 1, JSON.stringify(hooks));
const body = hooks.find((h) => h.url === GHL)?.body ?? {};
check("The webhook has the client email, date, title, rating and count", body.client_email === CLIENT.client_email && body.event_date === today && body.event_title === "Justin's 30th" && body.overall_rating === "great" && body.had_problems === false && body.closeouts === 1, JSON.stringify(body));
check("The webhook never carries staff notes or photos", !/Host loved|972-555|vodka|closeout\/|Jordan|photo|issues|leftover/i.test(JSON.stringify(body)), JSON.stringify(body));

const edit = await submit(b1, { rating: "great", guests: "90", issues: "Host loved it", leftover: "" }, at(23 * 60), false);
check("They can edit within 24 hours and keep the photo", edit.ok && db.event_closeouts.length === 1 && db.event_closeouts[0].guest_estimate === 90 && db.event_closeouts[0].edits === 1 && String(db.event_closeouts[0].photo_path).startsWith("closeout/"), edit.ok ? "" : edit.error);
check("Each edit is kept", db.event_closeout_versions.length === 2 && db.event_closeout_versions.some((v) => v.version === 2));
check("Still one closeout per bartender per event", db.event_closeouts.filter((r) => r.staff_id === "b1").length === 1);
const late = await submit(b1, { rating: "fine" }, new Date(at(21 * 60 + 45).getTime() + 25 * 3_600_000));
check("Locked after 24 hours", !late.ok && late.status === 409 && db.event_closeouts[0].rating === "great");

const second = await submit(b2, { rating: "had_problems", gear: [gear[0]], gearNote: "Cracked" }, at(21 * 60 + 50));
check("A second bartender sends one", second.ok && db.event_closeouts.length === 2);
check("Only the first closeout for the event sends the webhook", hooks.filter((h) => h.url === GHL).length === 1);
check("Had problems with broken gear texts admins with alerts on, right away", textsTo(admin).length === 1 && textsTo(quiet).length === 0, JSON.stringify(texts));
check("The alert names the bartender, event, problem and gear", (textsTo(admin)[0]?.message ?? "").includes("Sam") && textsTo(admin)[0].message.includes("Justin's 30th") && textsTo(admin)[0].message.includes("had problems") && textsTo(admin)[0].message.includes(gear[0]) && textsTo(admin)[0].message.includes("/team/admin/e/e1"));
check("Staff alerts carry no client contact details", texts.every((t) => !/justin@example|9725550199|Reyes/.test(t.message)));
await submit(b2, { rating: "had_problems", gear: [gear[0]], gearNote: "Cracked, and the jigger" }, at(22 * 60 + 10));
check("Editing does not text admins again", textsTo(admin).length === 1);

// Webhook env missing: logged and skipped, the save still works.
reset();
delete process.env.GHL_EVENT_CLOSEOUT_WEBHOOK;
const noEnv = await submit(b1, { rating: "fine" }, at(21 * 60 + 45));
check("Without the env the closeout still saves and no webhook is sent", noEnv.ok && hooks.length === 0);
check("Skipping does not use up the once-per-event claim", !db.team_notices.some((n) => String(n.key ?? "").startsWith("closeout_webhook")));
process.env.GHL_EVENT_CLOSEOUT_WEBHOOK = GHL;

// A failing text never blocks the save.
reset();
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
const offline = await submit(b2, { rating: "had_problems" }, at(21 * 60 + 45));
globalThis.fetch = realFetch;
check("A failed text or webhook never blocks the closeout", offline.ok && db.event_closeouts.length === 1);

// ----- Reminder -----
reset();
const out = (staff: string, as: string, d: Date) => db.time_punches.push({ id: `p-${as}`, assignment_id: as, staff_id: staff, session_id: "e1", type: "out", punched_at: d.toISOString() });
out("b1", "as1", at(22 * 60));
out("b2", "as2", at(22 * 60));
check("No reminder before 2 hours", (await coDb.sendCloseoutReminders(at(23 * 60 + 59))) === 0 && texts.length === 0);
await submit(b2, { rating: "great" }, at(22 * 60 + 30));
texts.length = 0;
const n = await coDb.sendCloseoutReminders(at(24 * 60 + 1));
check("One reminder 2 hours after clock out with no closeout", n === 1 && textsTo(b1).length === 1 && textsTo(b2).length === 0, JSON.stringify(texts));
check("The reminder links to the event page", (textsTo(b1)[0]?.message ?? "").includes("/team/e/e1") && textsTo(b1)[0].message.includes("closeout"));
await coDb.sendCloseoutReminders(at(25 * 60));
check("Only one reminder, ever", textsTo(b1).length === 1);
reset();
out("b1", "as1", new Date(at(22 * 60).getTime() - 30 * 3_600_000));
check("Old clock outs are never reminded", (await coDb.sendCloseoutReminders(at(23 * 60))) === 0);

// ----- Views and wiring -----
reset();
await submit(b1, { rating: "fine", issues: "Ice ran short" }, at(21 * 60 + 45));
await submit(b1, { rating: "great", issues: "Ice ran short" }, at(21 * 60 + 50), false);
const list = await coDb.closeoutsFor("e1");
check("Admins see closeouts with earlier versions", list.length === 1 && list[0].staffFirstName === "Jordan" && list[0].versions.length === 1 && list[0].versions[0].rating === "fine");
const st = await coDb.closeoutState(db.sessions[0] as never, b1, at(21 * 60 + 55));
check("The bartender's card shows their closeout and can still edit", st.open && st.canSubmit && st.mine?.rating === "great");
const st3 = await coDb.closeoutState(db.sessions[0] as never, b3, at(21 * 60 + 55));
check("Someone not on the event gets no card", !st3.open && !st3.mine);
check("The closeout view carries no client contact details", !/justin@example|9725550199|Reyes/.test(JSON.stringify(list)));
check("The event page shows the closeout card", src("app/team/e/[id]/event-tabs.tsx").includes("<CloseoutCard"));
check("The admin event page lists closeouts", src("app/team/admin/e/[id]/page.tsx").includes("closeoutsFor"));
check("The cron sends closeout reminders", src("app/api/cron/team/route.ts").includes("sendCloseoutReminders(now)"));
check("Closeout texts go through sendStaffText", !/fetch\(/.test(src("lib/team/closeout-db.ts").replace(/await fetch\(url,/, "")) && src("lib/team/closeout-db.ts").includes("sendStaffText("));
check("The photo is required in the form", src("app/team/e/[id]/closeout-card.tsx").includes("Add a photo of the bar broken down"));

done("closeout");
