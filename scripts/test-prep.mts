// 1 Tools, 2 Supplies: the Checklist tab is now Tools, Supplies is locked
// until Tools is done, Supplies has its own "I have gone through the supplies
// list" confirm (unchecked items reported missing), the progress strip, the
// 2 hour text to the person and the 30 minute text to admins and managers,
// the status on the manager's Day of tab, and clock in is never blocked.
// Run: node --no-warnings scripts/test-prep.mts

import { addDays, check, done, event, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const prep = await import("../lib/team/prep.ts");
const prepDb = await import("../lib/team/prep-db.ts");
const events = await import("../lib/team/events.ts");
const config = await import("../lib/team/checklist-config.ts");
const asgDb = await import("../lib/team/assignments-db.ts");
const supdb = await import("../lib/team/supplies-db.ts");
const sup = await import("../lib/team/supplies.ts");
const clock = await import("../lib/team/clock.ts");

const CT = "America/Chicago";
const today = time.todayIn(CT);
const DAY = addDays(today, 2);
const at = (min: number) => time.zonedInstant(DAY, min, CT); // service is 6:00 PM to 10:00 PM

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const alex = { id: "m1", name: "Alex Rivera", phone: "+12145550101", role: "manager" as const, active: true, alerts: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true, alerts: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bar_back" as const, active: true, alerts: true };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [event("e1", DAY, "1 Elm St, Dallas, TX", {}, { team_market: "dallas", team_market_source: "auto" })];
  db.staff = [admin, alex, b1, b2].map((s) => ({ ...s, markets: ["dallas"] }));
  db.event_assignments = [
    { id: "as1", session_id: "e1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "e1", staff_id: "b2", status: "accepted" },
  ];
  for (const t of ["order_sheet_lines", "order_sheet_meta", "staff_checks", "staff_supply_views", "missing_reports", "bar_ready_reports", "team_notices", "time_punches", "staff_confirmations", "staff_supplies_confirmations", "team_hidden_events"]) db[t] = [];
  texts.length = 0;
}
const session = () => db.sessions[0] as never as Parameters<typeof events.eventPageData>[0];
const pkg = () => (db.sessions[0] as { event_data: { package: string } }).event_data.package;
async function finishTools(who: typeof b1) {
  for (const k of config.checklistKeys(pkg())) await events.saveCheck(session(), who, "checklist", k, true);
  return events.confirmChecklist(session(), who);
}

// ----- The pure rules -----
check("The strip reads 1 Tools, 2 Supplies, each Done or To do", JSON.stringify(prep.prepSteps({ tools: true, supplies: false })) === JSON.stringify([{ n: 1, label: "Tools", done: true }, { n: 2, label: "Supplies", done: false }]));
check("What is left, in words", prep.stepsLeft({ tools: false, supplies: false }) === "Tools and Supplies" && prep.stepsLeft({ tools: true, supplies: false }) === "Supplies" && prep.stepsLeft({ tools: true, supplies: true }) === "");
check("No lock rule is left: Supplies never waits on Tools", !("suppliesUnlocked" in prep) && !("SUPPLIES_LOCKED" in prep) && !("SUPPLIES_LOCKED_NOTE" in prep));
const ed = (db.sessions = [event("e1", DAY, "x")], (db.sessions[0] as { event_data: Record<string, unknown> }).event_data);
check("The person's text is due from 2 hours before service, not before", !prep.staffReminderDue(ed, at(18 * 60 - 121), { tools: false, supplies: false }) && prep.staffReminderDue(ed, at(16 * 60), { tools: false, supplies: false }) && !prep.staffReminderDue(ed, at(18 * 60), { tools: false, supplies: false }));
check("Nobody is texted when both steps are done", !prep.staffReminderDue(ed, at(16 * 60 + 30), { tools: true, supplies: true }));
check("The admin text is due from 30 minutes before service", !prep.adminAlertDue(ed, at(17 * 60 + 29), [{ tools: false, supplies: false }]) && prep.adminAlertDue(ed, at(17 * 60 + 30), [{ tools: true, supplies: false }]) && !prep.adminAlertDue(ed, at(17 * 60 + 30), [{ tools: true, supplies: true }]));

// ----- Tools, then Supplies -----
reset();
check("Tools is done with the existing I have everything", !!(await finishTools(b1)) && (await prepDb.prepTimes(session(), "b1")).toolsAt !== null);
const items = sup.allSupplies((await supdb.staffSupplies(session())).list);
for (const i of items.slice(1)) await events.saveCheck(session(), b1, "shopping", i.key, true);
texts.length = 0;
const conf = await prepDb.confirmSupplies(session(), b1, "https://plan.test");
check("Then Supplies confirms, and what was not checked is listed", conf.ok && conf.missing.length === 1 && conf.missing[0] === items[0].item, JSON.stringify(conf));
check("Unchecked items are reported missing like Something is missing: saved for Day of", db.missing_reports.length === 1 && (db.missing_reports[0].items as string[])[0] === items[0].item && db.missing_reports[0].staff_id === "b1");
check("and texted to admins and managers with the event link", textsTo(admin).length === 1 && textsTo(alex).length === 1 && textsTo(admin)[0].message.includes(items[0].item) && textsTo(admin)[0].message.includes("/team/e/e1") && textsTo(b2).length === 0);
const again = await prepDb.confirmSupplies(session(), b1, "https://plan.test");
check("A second tap keeps the first time and reports nothing again", again.ok && conf.ok && again.confirmedAt === conf.confirmedAt && db.missing_reports.length === 1);
check("Both steps show done", JSON.stringify(prepDb.statusOf(await prepDb.prepTimes(session(), "b1"))) === JSON.stringify({ tools: true, supplies: true }));
await events.saveCheck(session(), b1, "checklist", config.checklistKeys(pkg())[0], false);
const t = await prepDb.prepTimes(session(), "b1");
check("Unchecking a Tools item undoes Tools but never wipes the Supplies confirm", t.toolsAt === null && t.suppliesAt !== null);
await finishTools(b2);
for (const i of items) await events.saveCheck(session(), b2, "shopping", i.key, true);
texts.length = 0;
const all = await prepDb.confirmSupplies(session(), b2, "https://plan.test");
check("Everything checked: confirmed with no missing report or text", all.ok && all.missing.length === 0 && db.missing_reports.length === 1 && texts.length === 0);

// ----- Page data and the manager's Day of -----
const page = await events.eventPageData(session(), b2);
check("The event page gets both confirm times", !!page.confirmedAt && !!page.suppliesConfirmedAt);
const people = await asgDb.assigneeProgress(session());
const p2 = people.find((p) => p.staffId === "b2")!;
const p1 = people.find((p) => p.staffId === "b1")!;
check("Day of gets each person's two steps", !!p2.confirmedAt && !!p2.suppliesConfirmedAt && p1.confirmedAt === null && !!p1.suppliesConfirmedAt);
const dayOf = src("app/team/admin/e/[id]/day-of.tsx");
check("Day of shows 1 Tools and 2 Supplies, Done with the time or To do, per person", dayOf.includes("export function PrepStatusLine") && dayOf.includes("<PrepStatusLine person={p} timeZone={timeZone} />") && dayOf.includes('`Done ${timeLabel(at[i]!, undefined, timeZone)}` : "To do"'));
check("The Team panel uses the same line and the Tools name", src("app/team/admin/e/[id]/assign-panel.tsx").includes("<PrepStatusLine person={p} timeZone={timeZone} />") && src("app/team/admin/e/[id]/assign-panel.tsx").includes("<Bar label={TOOLS_TAB}"));

// ----- The bartender page -----
const tabs = src("app/team/e/[id]/event-tabs.tsx");
check("The Checklist tab is named Tools", tabs.includes('["checklist", TOOLS_TAB],') && !tabs.includes('"Checklist"]') && prep.TOOLS_TAB === "Tools");
const order = ['["details", "Details"]', '["checklist", TOOLS_TAB]', '["shopping", SUPPLIES_TAB]', '[["wrapup", WRAP_UP_TAB]]', '["chat", `Chat'].map((s) => tabs.indexOf(s));
check("Tab order: Details, Tools, Supplies, Wrap up, Chat", order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), JSON.stringify(order));
check("Supplies always opens: no Finish Tools first lock on the page", !tabs.includes("SuppliesLocked") && !tabs.includes("Finish Tools first") && !tabs.includes("toolsAt || suppliesAt") && /<div hidden=\{tab !== "shopping"\}[\s\S]*?<Supplies\n/.test(tabs));
check("No tab is locked behind another: every tab panel is shown by the selected tab alone", (tabs.match(/<div hidden=\{tab !== "(\w+)"\}/g) ?? []).length === 7 && !/toolsAt \?|toolsAt &&|suppliesAt \?|suppliesAt &&/.test(tabs));
check("The server never refuses Supplies for Tools", !src("lib/team/prep-db.ts").includes("Finish Tools first") && !src("app/api/team/supplies-confirm/route.ts").includes("Finish Tools"));
check("Supplies has the explicit confirm, warning about unchecked items first", tabs.includes("SUPPLIES_CONFIRM_LABEL") && prep.SUPPLIES_CONFIRM_LABEL === "I have gone through the supplies list" && tabs.includes("will be reported missing to the team") && tabs.includes('fetch("/api/team/supplies-confirm"'));
check("The progress strip is on the event page", tabs.includes("<PrepStrip tools={!!toolsAt} supplies={!!suppliesAt} onOpen={setTab} />"));
check("Confirming Tools and Supplies updates the strip right away", tabs.includes("onConfirmed={setToolsAt}") && tabs.includes("onConfirmed={setSuppliesAt}"));
check("The route checks the person is on the event", src("app/api/team/supplies-confirm/route.ts").includes("const access = await openEvent(sessionId, staff);") && src("app/api/team/supplies-confirm/route.ts").includes("confirmSupplies(access.session, staff"));
check("Clock in is never blocked by Tools or Supplies", !/prep|toolsAt|suppliesConfirm|confirmedAt/.test(src("lib/team/clock-db.ts")) && !/prep|confirmedAt/.test(src("lib/team/clock.ts")) && typeof clock.lateSetupDue === "function");
check("Nothing in the database was renamed", src("lib/team/events.ts").includes('checkRows(staff.id, session.id, "checklist")') && src("lib/team/events.ts").includes('from("staff_confirmations")'));
check("The onboarding text says Tools, not checklist", !/checklist/i.test(src("lib/team/cert-config.ts")));

// ----- The texts -----
reset();
await finishTools(b2);
await prepDb.confirmSupplies(session(), b2, "https://plan.test");
texts.length = 0;
check("No texts 3 hours before service", (await prepDb.sendPrepReminders(at(15 * 60))) === 0 && texts.length === 0);
await prepDb.sendPrepReminders(at(16 * 60));
check("2 hours before: the person with a step left gets one text, naming what is left", textsTo(b1).length === 1 && textsTo(b1)[0].message.includes("Tools and Supplies") && textsTo(b1)[0].message.includes("6:00 PM") && textsTo(b1)[0].message.includes("/team/e/e1"), JSON.stringify(texts));
check("Someone who finished both gets nothing", textsTo(b2).length === 0);
check("The person's text uses the first name title, never the client's last name", !/Reyes/.test(textsTo(b1)[0]?.message ?? ""));
check("Admins are not texted yet", textsTo(admin).length === 0 && textsTo(alex).length === 0);
await prepDb.sendPrepReminders(at(16 * 60 + 30));
check("The person's text goes once", textsTo(b1).length === 1);
await finishTools(b1);
await prepDb.sendPrepReminders(at(17 * 60 + 30));
check("30 minutes before: admins and managers get one text naming who has not finished which step", textsTo(admin).length === 1 && textsTo(alex).length === 1 && textsTo(admin)[0].message.includes("Jordan Lee: Supplies") && !textsTo(admin)[0].message.includes("Sam Diaz"), textsTo(admin)[0]?.message);
check("It links to the manager's Day of tab", textsTo(admin)[0].message.includes("/team/admin/e/e1?tab=dayof"));
await prepDb.sendPrepReminders(at(17 * 60 + 40));
check("The admin text goes once", textsTo(admin).length === 1);
reset();
await finishTools(b1);
await finishTools(b2);
await prepDb.confirmSupplies(session(), b1, "https://plan.test");
await prepDb.confirmSupplies(session(), b2, "https://plan.test");
texts.length = 0;
await prepDb.sendPrepReminders(at(17 * 60 + 35));
check("Everyone done: no admin text", textsTo(admin).length === 0);
reset();
db.team_hidden_events.push({ session_id: "e1" });
await prepDb.sendPrepReminders(at(16 * 60));
check("A hidden event sends nothing", texts.length === 0);
reset();
db.event_assignments[0].status = "offered";
await prepDb.sendPrepReminders(at(16 * 60));
check("Only people who accepted are texted", textsTo(b1).length === 0 && textsTo(b2).length === 1);
check("The cron runs it", src("app/api/cron/team/route.ts").includes("sendPrepReminders(now)"));
check("A replacement starts with a clean Supplies confirm", src("lib/team/shifts-db.ts").includes('from("staff_supplies_confirmations").delete()'));

// ----- Supplies before Tools, for every role -----
reset();
const helper = { id: "b3", name: "Riley Park", phone: "+12145550113", role: "event_helper" as const, active: true, alerts: true };
const adminAsBartender = { ...admin, role: "bartender" as const, bartenderView: true };
db.staff.push({ ...helper, markets: ["dallas"] });
db.event_assignments.push({ id: "as3", session_id: "e1", staff_id: "b3", status: "accepted" });
const everyItem = sup.allSupplies((await supdb.staffSupplies(session())).list);
for (const who of [b1, b2, helper, adminAsBartender]) {
  for (const i of everyItem) await events.saveCheck(session(), who as typeof b1, "shopping", i.key, true);
  const before = await prepDb.prepTimes(session(), who.id);
  const r = await prepDb.confirmSupplies(session(), who as typeof b1, "https://plan.test");
  const after = await prepDb.prepTimes(session(), who.id);
  check(`${"bartenderView" in who ? "An admin in Bartender view" : { bartender: "A bartender", bar_back: "A bar back", event_helper: "An event helper" }[who.role as string]} who has not done Tools can confirm Supplies`, before.toolsAt === null && r.ok && after.suppliesAt !== null);
  check("...and Tools still shows To do", after.toolsAt === null && prep.prepSteps(prepDb.statusOf(after))[0].done === false && prep.stepsLeft(prepDb.statusOf(after)) === "Tools");
}

const sql = src("supabase/migrations/20261209_tools_supplies.sql");
check("The migration adds staff_supplies_confirmations, safe to run twice", sql.includes("create table if not exists public.staff_supplies_confirmations") && sql.includes("primary key (staff_id, session_id)"));

done("tools and supplies");
