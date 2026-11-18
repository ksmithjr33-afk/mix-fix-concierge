// Running low: event reports text admins and managers right away (quiet hours
// or not), kit reports wait for the 9 AM Central summary, the 30 minute
// update rule, low to out texting again, On it and Resolved, and staff only
// ever seeing their own reports.
// Run: node --no-warnings scripts/test-low-stock.mts

import { addDays, check, done, event, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const low = await import("../lib/team/low-stock.ts");
const lowDb = await import("../lib/team/low-stock-db.ts");

const CT = "America/Chicago";
const DAY = addDays(time.todayIn(CT), 3);
const at = (min: number, day = DAY) => time.zonedInstant(day, min, CT); // service is 6:00 PM to 10:00 PM, arrival 4:00 PM
const mins = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const alex = { id: "m1", name: "Alex Rivera", phone: "+12145550101", role: "manager" as const, active: true, alerts: true };
const quiet = { id: "a2", name: "Pat Quiet", phone: "+12145550102", role: "admin" as const, active: true, alerts: false };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true, alerts: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bar_back" as const, active: true, alerts: true };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    event("e1", DAY, "1 Elm St, Dallas, TX", {}, { team_market: "dallas", team_market_source: "auto" }),
    event("e2", addDays(DAY, 5), "2 Oak St, Dallas, TX", {}, { team_market: "dallas", team_market_source: "auto" }),
  ];
  db.staff = [admin, alex, quiet, b1, b2].map((s) => ({ ...s, markets: ["dallas"] }));
  db.event_assignments = [
    { id: "as1", session_id: "e1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "e1", staff_id: "b2", status: "accepted" },
  ];
  for (const t of ["low_stock_reports", "team_notices", "order_sheet_lines", "order_sheet_meta"]) db[t] = [];
  texts.length = 0;
}
type Session = Parameters<typeof lowDb.submitReport>[1];
const s1 = () => db.sessions[0] as never as Session;
const s2 = () => db.sessions[1] as never as Session;
const rows = () => db.low_stock_reports as Record<string, unknown>[];
const body = (m: string) => m.split("\n").filter((l) => !l.startsWith("https://")).join("\n"); // the wording, without the link
const noHyphen = (m: string) => !/-/.test(body(m));

// ----- When the button shows -----
const ed = (db.sessions = [event("e1", DAY, "x")], (db.sessions[0] as { event_data: Record<string, unknown> }).event_data);
check("The button is hidden before setup (arrival, 2 hours before service)", !low.lowStockOpen(ed, at(16 * 60 - 1)));
check("It shows from setup through the end of breakdown", low.lowStockOpen(ed, at(16 * 60)) && low.lowStockOpen(ed, at(21 * 60)) && low.lowStockOpen(ed, at(23 * 60)));
check("It is gone after breakdown (service end plus an hour)", !low.lowStockOpen(ed, at(23 * 60 + 1)));
const page = src("app/team/e/[id]/page.tsx");
check("The event page shows it only in that window, for people on the event", page.includes("onEvent && lowStockOpen(ed, new Date(renderedAt))") && src("app/team/e/[id]/event-tabs.tsx").includes("<RunningLowButton sessionId={view.sessionId} items={runningLow.items} />"));
check("The item list is the event's Tools and Supplies lists", page.includes("data.checklist.flatMap") && page.includes("allSupplies(data.shopping)"));
check("The Me page has it for the person's own kit, with no event", src("app/team/me/page.tsx").includes("<RunningLowButton sessionId={null} items={kitItemChoices()} kit />"));
const form = src("app/team/running-low.tsx");
check("The form: pick or type an item, Running low or Out, an optional note, one Send", form.includes("Pick from the list or type it") && form.includes('(["low", "out"] as const)') && form.includes("Add a note (optional)") && form.includes("disabled={status === \"sending\" || !item.trim()}"));
check("Bad signal: a timeout, and the form stays filled to tap Send again", form.includes("AbortController") && form.includes("Did not send. Check your signal and tap Send again."));

// ----- Event report: texted right away, quiet hours ignored -----
reset();
const night = at(21 * 60 + 30); // 9:30 PM, quiet hours
const r1 = await lowDb.submitReport(b1, s1(), { item: "Limes", level: "out", note: "Need two bags" }, night);
check("An event report on the event day is saved as an event report", r1.ok && r1.kind === "event" && rows().length === 1 && rows()[0].kind === "event" && rows()[0].session_id === "e1" && rows()[0].status === "open");
const m1 = textsTo(admin)[0]?.message ?? "";
check("It texts every admin and manager right away, at 9:30 PM in quiet hours", textsTo(admin).length === 1 && textsTo(alex).length === 1, JSON.stringify(texts));
check("Admins with alerts off, and the bartenders, are not texted", textsTo(quiet).length === 0 && textsTo(b1).length === 0 && textsTo(b2).length === 0);
check("The text says who, the event, the item, out, the note, and a link to the report", m1.includes("Jordan Lee") && m1.includes("Justin · Birthday") && m1.includes("is out of Limes") && m1.includes("Note: Need two bags") && m1.includes(`/team/admin/running-low#r-${r1.ok ? r1.id : ""}`), m1);
check("The event in the text is the client first name and event type only", !/Reyes|justin@example|9725550199|Justin's 30th/.test(m1));
check("No hyphens in the text", noHyphen(m1), m1);
reset();
await lowDb.submitReport(b2, s1(), { item: "Cups", level: "low", note: "" }, at(7 * 60)); // 7:00 AM, quiet hours, before setup
check("7:00 AM on the event day, still quiet hours: texted right away too", textsTo(admin).length === 1 && textsTo(admin)[0].message.includes("Sam Diaz is running low on Cups"));

// ----- Kit report: waits for the 9 AM summary -----
reset();
const k1 = await lowDb.submitReport(b1, null, { item: "Shaker tins", level: "low", note: "" }, at(14 * 60));
const k2 = await lowDb.submitReport(b2, s2(), { item: "Bar mats", level: "out", note: "For Saturday" }, at(14 * 60 + 5));
check("A report from the Me page is a kit report with no event", k1.ok && k1.kind === "kit" && rows()[0].session_id === null);
check("A report for an event that is not today is a kit report too", k2.ok && k2.kind === "kit");
check("Kit reports send no text right away", texts.length === 0);
const next = addDays(DAY, 1);
check("Before 9 AM: no summary", (await lowDb.sendKitSummary(at(8 * 60 + 55, next))) === 0 && texts.length === 0);
const sent = await lowDb.sendKitSummary(at(9 * 60, next));
const sum = textsTo(admin)[0]?.message ?? "";
check("At 9 AM Central: one summary to each admin and manager", sent === 2 && textsTo(admin).length === 1 && textsTo(alex).length === 1 && textsTo(quiet).length === 0 && textsTo(b1).length === 0, JSON.stringify(texts));
check("It lists every open kit report", sum.includes("2 open") && sum.includes("Jordan Lee: Shaker tins, running low") && sum.includes("Sam Diaz: Bar mats, out (For Saturday)") && sum.includes("/team/admin/running-low"), sum);
check("No hyphens in the summary", noHyphen(sum), sum);
await lowDb.sendKitSummary(at(9 * 60 + 5, next));
await lowDb.sendKitSummary(at(9 * 60 + 55, next));
check("Once a day: the cron runs again at 9:05 and 9:55 and nothing more goes out", textsTo(admin).length === 1);
check("After 9 AM the kit reports still sent nothing by themselves", (await lowDb.sendKitSummary(at(10 * 60, next))) === 0);
for (const r of rows()) r.status = "resolved";
await lowDb.submitReport(b1, s1(), { item: "Ice", level: "low", note: "" }, at(17 * 60)); // an event report: never in the kit summary
texts.length = 0;
check("No open kit reports: nothing at 9 AM", (await lowDb.sendKitSummary(at(9 * 60, addDays(DAY, 2)))) === 0 && texts.length === 0);
check("The cron runs the summary", src("app/api/cron/team/route.ts").includes("sendKitSummary(now)"));
check("9 AM is Central, whatever the server's clock", low.summaryDue(time.zonedInstant(DAY, 9 * 60 + 30, CT)) && !low.summaryDue(time.zonedInstant(DAY, 9 * 60, "America/Los_Angeles")));

// ----- The 30 minute rule, and low to out -----
reset();
const t0 = at(19 * 60);
const a = await lowDb.submitReport(b1, s1(), { item: "Limes", level: "low", note: "" }, t0);
texts.length = 0;
const b = await lowDb.submitReport(b1, s1(), { item: " limes ", level: "low", note: "Half a bag left" }, mins(t0, 10));
check("Same person, item and event inside 30 minutes: the report is updated, not added", a.ok && b.ok && b.updated && b.id === a.id && rows().length === 1 && rows()[0].note === "Half a bag left");
check("and nobody is texted again", texts.length === 0);
const c = await lowDb.submitReport(b1, s1(), { item: "Limes", level: "out", note: "" }, mins(t0, 20));
const mOut = textsTo(admin)[0]?.message ?? "";
check("Low to out inside 30 minutes updates the same report", c.ok && c.id === (a.ok ? a.id : "") && rows().length === 1 && rows()[0].level === "out");
check("and texts again, saying it is now out", textsTo(admin).length === 1 && textsTo(alex).length === 1 && mOut.startsWith("Now out: Justin · Birthday") && mOut.includes("is out of Limes") && mOut.includes("Half a bag left"), mOut);
texts.length = 0;
await lowDb.submitReport(b1, s1(), { item: "Limes", level: "out", note: "" }, mins(t0, 25));
await lowDb.submitReport(b1, s1(), { item: "Limes", level: "low", note: "" }, mins(t0, 26));
check("Out again, or back to low: no text", texts.length === 0 && rows().length === 1);
await lowDb.submitReport(b2, s1(), { item: "Limes", level: "low", note: "" }, mins(t0, 27));
check("Someone else reporting the same item is their own report, and texts", rows().length === 2 && textsTo(admin).length === 1);
texts.length = 0;
await lowDb.submitReport(b1, s1(), { item: "Limes", level: "low", note: "" }, mins(t0, 31));
check("After 30 minutes it is a new report, and texts", rows().length === 3 && textsTo(admin).length === 1);
texts.length = 0;
await lowDb.submitReport(b1, s1(), { item: "Napkins", level: "low", note: "" }, mins(t0, 32));
check("A different item is a new report", rows().length === 4 && textsTo(admin).length === 1);
reset();
await lowDb.submitReport(b1, null, { item: "Jigger", level: "low", note: "" }, t0);
await lowDb.submitReport(b1, null, { item: "Jigger", level: "out", note: "" }, mins(t0, 5));
check("A kit report going low to out is updated, and still waits for the summary", rows().length === 1 && rows()[0].level === "out" && texts.length === 0);
check("An empty item is refused", !(await lowDb.submitReport(b1, null, { item: "  ", level: "low", note: "" }, t0)).ok);

// ----- On it and Resolved -----
reset();
const rep = await lowDb.submitReport(b1, s1(), { item: "Limes", level: "out", note: "" }, t0);
const id = rep.ok ? rep.id : "";
texts.length = 0;
check("A bartender cannot take a report", !(await lowDb.takeReport(b2, id)).ok && rows()[0].status === "open");
const took = await lowDb.takeReport(admin, id, mins(t0, 2));
check("On it records who took it and when", took.ok && rows()[0].status === "on_it" && rows()[0].taken_by === "a1" && !!rows()[0].taken_at && took.ok && took.report.takenBy === "Kenneth");
check("and texts the person who reported it: [Name] is on it.", textsTo(b1).length === 1 && textsTo(b1)[0].message.startsWith("Kenneth is on it.") && noHyphen(textsTo(b1)[0].message), JSON.stringify(texts));
const second = await lowDb.takeReport(alex, id);
check("Only one person can take it: the next one is told who has it", !second.ok && second.status === 409 && second.error === "Kenneth already has it." && rows()[0].taken_by === "a1" && textsTo(b1).length === 1);
const listed = await lowDb.listReports(alex, { open: true });
check("The list shows who has it", listed.length === 1 && listed[0].status === "on_it" && listed[0].takenBy === "Kenneth");
check("A bartender cannot resolve it", !(await lowDb.resolveReport(b1, id)).ok && rows()[0].status === "on_it");
const res = await lowDb.resolveReport(alex, id, mins(t0, 30));
check("Resolved closes it and records who and when", res.ok && rows()[0].status === "resolved" && rows()[0].resolved_by === "m1" && !!rows()[0].resolved_at && res.ok && res.report.resolvedBy === "Alex");
check("Resolved twice is refused", !(await lowDb.resolveReport(admin, id)).ok);
check("A resolved report cannot be taken", !(await lowDb.takeReport(admin, id)).ok);
check("It drops off the open list", (await lowDb.listReports(admin, { open: true })).length === 0);
const open2 = await lowDb.submitReport(b1, s1(), { item: "Cups", level: "low", note: "" }, t0);
check("An open report can be resolved without anyone taking it", (await lowDb.resolveReport(admin, open2.ok ? open2.id : "")).ok);
const again = await lowDb.submitReport(b1, s1(), { item: "Limes", level: "out", note: "" }, mins(t0, 5));
check("Reporting an item again after it was resolved is a new report", again.ok && !again.updated && rows().length === 3);

// ----- Who sees what -----
reset();
await lowDb.submitReport(b1, s1(), { item: "Limes", level: "low", note: "" }, t0);
await lowDb.submitReport(b2, s1(), { item: "Ice", level: "out", note: "" }, mins(t0, 1));
await lowDb.submitReport(b2, null, { item: "Bar mats", level: "low", note: "" }, mins(t0, 2));
const mine1 = await lowDb.listReports(b1);
const mine2 = await lowDb.listReports(b2);
check("Staff only see their own reports", mine1.length === 1 && mine1.every((r) => r.staffId === "b1") && mine2.length === 2 && mine2.every((r) => r.staffId === "b2"));
check("Even when asking for one event", (await lowDb.listReports(b1, { sessionId: "e1" })).every((r) => r.staffId === "b1"));
check("Staff see the event by client first name only", mine1[0].eventTitle === "Justin · Birthday" && !JSON.stringify(mine1).includes("Reyes"));
const all = await lowDb.listReports(admin);
check("Admins and managers see everyone's, newest first", all.length === 3 && (await lowDb.listReports(alex)).length === 3 && all[0].item === "Bar mats" && all[2].item === "Limes");
check("with the event, person, item, level, note and time", all[1].eventTitle === "Justin Reyes · Birthday" && all[1].staffName === "Sam Diaz" && all[1].level === "out" && !!all[1].createdAt && all[0].eventTitle === "");
const dayOf = await lowDb.listReports(admin, { open: true, sessionId: "e1" });
check("The event's Day of tab gets its open reports", dayOf.length === 2 && dayOf.every((r) => r.sessionId === "e1"));
check("The open count is for admins and managers only", (await lowDb.openReportCount(admin)) === 3 && (await lowDb.openReportCount(b1)) === 0);
const route = src("app/api/team/low-stock/route.ts");
check("The staff route lists only what the server allows this person", route.includes("listReports(staff)") && route.includes("const access = await openEvent(sessionId, staff);"));
const adminRoute = src("app/api/team/admin/low-stock/route.ts");
check("On it and Resolved are refused on the server for anyone but admins and managers", adminRoute.includes("if (!isAdminRole(staff.role))") && adminRoute.includes("status: 403"));
check("The Me page lists only the person's own reports", src("app/team/me/page.tsx").includes("listReports({ ...staff, role: \"bartender\" }"));
check("The admin page requires an admin or manager", src("app/team/admin/running-low/page.tsx").includes('requireAdmin("/team/admin/running-low")'));
check("The Day of tab shows open reports at the top", (() => { const s = src("app/team/admin/e/[id]/page.tsx"); const i = s.indexOf("dayof: () => ("); return i > 0 && s.indexOf("<LowStockList initial={lowStock}", i) > i && s.indexOf("<LowStockList initial={lowStock}", i) < s.indexOf("Bar setup photos", i); })());
check("Admins get the Running low icon in the header", src("app/team/team-header.tsx").includes("alert={showAdmin ? <RunningLowAlert open={lowOpen} /> : undefined}"));

// ----- Wording -----
const words = [...Object.values(low.LEVEL_LABEL), low.LOW_STOCK_LABEL, low.onItText({ name: "Kenneth", item: "Limes", level: "low" })];
check("No hyphens in the labels or the On it text", words.every((w) => !w.includes("-")));
const visible = [...form.matchAll(/>([^<>{}]+)</g), ...form.matchAll(/"([A-Z][^"]*[a-z.][^"]*)"/g)].map((m) => m[1]).filter((t) => /[a-z]/.test(t) && !/^[a-z]+(-[a-z]+)+$/.test(t) && !t.includes("/api/") && t !== "Content-Type");
check("No hyphens in the wording on the form", visible.every((t) => !t.includes("-")), visible.filter((t) => t.includes("-")).join(" | "));

const sql = src("supabase/migrations/20261216_low_stock_reports.sql");
check(
  "The migration adds low_stock_reports with every column",
  sql.includes("create table if not exists public.low_stock_reports") &&
    ["id ", "session_id ", "staff_id ", "item ", "level ", "note ", "kind ", "status ", "taken_by ", "taken_at ", "resolved_by ", "resolved_at ", "created_at "].every((c) => sql.includes(`  ${c}`)) &&
    sql.includes("check (kind in ('event', 'kit'))") &&
    sql.includes("check (status in ('open', 'on_it', 'resolved'))")
);

done("running low");
