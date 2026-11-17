// Adding an event from the calendar, and calendar only events: nothing goes to
// GHL or the client (no intake webhook, no contact note, no update webhooks,
// no client list, no follow up), the staff side works as normal, and "Turn on
// client messages" sends the intake payload once.
// Run: node --no-warnings scripts/test-calendar-only.mts

import { registerHooks } from "node:module";
import { addDays, check, done, hooks, src, texts } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

process.env.GHL_WEBHOOK_URL = "https://hooks.test/intake";
process.env.GHL_UPDATE_WEBHOOK_URL = "https://hooks.test/update";
process.env.GHL_EVENT_CLOSEOUT_WEBHOOK = "https://hooks.test/closeout";

const { db } = await import("./fake-supabase.mts");
const manualDb = await import("../lib/manual-event-db.ts");
const cldb = await import("../lib/client-list-db.ts");
const delivery = await import("../lib/update-delivery.ts");
const editDb = await import("../lib/team/admin-edit-db.ts");
const closeout = await import("../lib/team/closeout-db.ts");
const links = await import("../lib/client-links.ts");
const asgDb = await import("../lib/team/assignments-db.ts");
const events = await import("../lib/team/events.ts");
const eventList = await import("../lib/team/event-list.ts");
const calOnly = await import("../lib/calendar-only.ts");
const time = await import("../lib/team/time.ts");

const admin = { id: "admin-1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const alex = { id: "mgr-1", name: "Alex Rivera", phone: "+12145550102", role: "manager" as const, active: true, alerts: true };
const sam = { id: "bart-1", name: "Sam Lee", phone: "+12145550101", role: "bartender" as const, active: true, alerts: true };
const today = time.chicagoToday();
const DAY = addDays(today, 30);

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [admin, alex, sam].map((s) => ({ ...s, markets: ["dallas"] }));
  db.staff_sessions = [];
  db.team_settings = [{ key: cldb.AUTO_SEND_KEY, value: true }];
  hooks.length = 0;
  texts.length = 0;
}
const form = (extra: Record<string, unknown> = {}) => ({
  first_name: "Dana",
  last_name: "Whitfield",
  email: "dana.w@example.com",
  phone: "(214) 555-0177",
  event_type: "Birthday",
  event_name: "Dana's 50th",
  event_date: DAY,
  bar_service_start: "18:00",
  bar_service_end: "22:00",
  arrival_time: "16:30",
  event_address: "500 Main St, Dallas, TX 75201",
  guest_count: "90",
  package: "Full Bar",
  bartenders: "1",
  drinks: [{ key: "craft:French Martini" }],
  mode: "confirmed",
  ...extra,
});
const session = (id: string) => (db.sessions as Record<string, unknown>[]).find((s) => s.id === id) as Record<string, unknown> & { event_data: Record<string, unknown> };
const ghl = () => hooks.filter((h) => h.url.startsWith("https://hooks.test/"));

// ----- 1. Add an event from the calendar -----
const cal = src("app/team/calendar-view.tsx");
check("Admins get Add event on a day in Month and Week, opening the form with the date", cal.includes("export const addEventHref = (ymd: string) => `/team/admin/events/new?date=${ymd}`;") && (cal.match(/\{canAdd\(d\) && <AddDay/g) ?? []).length === 2);
check("An empty day is one big tap target", cal.includes('fill ? "min-h-[3rem]" : ""') && cal.includes("fill={d.events.length === 0}"));
check("The phone month's day panel has Add event too", cal.includes("canAdd={canAdd(openDay)}") && cal.includes("+ Add event on this day"));
check("Admins and managers only, today or later", cal.includes('const canAdd = (d: CalDay) => audience === "admin" && !past(d);'));
const newPage = src("app/team/admin/events/new/page.tsx");
check("The form fills in the date from the calendar, never a past one", newPage.includes("date >= today ? date : \"\"") && newPage.includes("initialDate={initialDate} today={today}") && src("app/team/admin/events/new/add-event-form.tsx").includes("min={today || undefined}"));
reset();
const past = await manualDb.addManualEvent(admin, form({ event_date: addDays(today, -1) }));
check("Past dates stay refused on the server", !past.ok && past.status === 400);
check("The Staffing page entry point stays", src("app/team/admin/events/page.tsx").includes('href="/team/admin/events/new"'));

// ----- 2. Calendar only: nothing to GHL or the client -----
reset();
const r = await manualDb.addManualEvent(admin, form({ calendar_only: true, send_list: true }));
check("A calendar only event saves as confirmed", r.ok && r.mode === "confirmed", JSON.stringify(r));
const id = r.ok ? r.id : "";
check("calendar_only is stored on the session", session(id)?.calendar_only === true);
check("No intake webhook and nothing else to GHL", ghl().length === 0, JSON.stringify(hooks));
check("No client shopping list, even with the box ticked", session(id)?.send_client_list === false);
check("A calendar only event never sends a concierge link", !(await manualDb.addManualEvent(admin, form({ calendar_only: true, mode: "link", email: "other@example.com" }))).ok);
check("The manager view hides the client links", (await links.clientLinks(session(id) as never, admin)) === null);

// The staff side works as normal.
const asg = await asgDb.assignStaff(session(id) as never, "bart-1", admin as never, "https://plan.test");
check("Staffing works and the bartender gets their text", (asg as { ok?: boolean }).ok !== false && texts.some((t) => t.phone === sam.phone), JSON.stringify(asg));
for (const a of (db.event_assignments ?? []) as Record<string, unknown>[]) if (a.session_id === id) a.status = "accepted";
check("Once they accept, the bartender opens the event as normal", (await events.openEvent(id, sam as never)).ok);
texts.length = 0;
const edit = await editDb.saveAdminEdit({ sessionId: id, admin: admin as never, changes: { guest_count: "120" }, price: { mode: "keep" }, expectedVersion: 1, origin: "https://plan.test" });
check("An admin edit saves", edit.ok, JSON.stringify(edit));
check("No update webhook and no GHL note for the change", ghl().length === 0, JSON.stringify(hooks));
const skipped = (db.event_updates as Record<string, unknown>[]).filter((u) => u.session_id === id && Number(u.version) > 1);
check("The update row is marked skipped", skipped.length > 0 && skipped.every((u) => u.webhook_error === calOnly.CALENDAR_ONLY_SKIP));
check("A retry never sends a skipped row", (await delivery.getUndeliveredUpdates(id)).length === 0);
const listErr = await delivery.postListOnly(session(id) as never, {});
check("Sending the client their list is refused", !!listErr && /calendar only/i.test(listErr) && ghl().length === 0);
check("No post event follow up", (await closeout.sendCloseoutWebhook(session(id) as never, "great" as never, 1)) === "skipped" && ghl().length === 0);

// Every guard the card lists is in the code it names.
const guards: Record<string, string[]> = {
  concierge_link: ["lib/manual-event.ts", "lib/client-links.ts"],
  intake: ["lib/manual-event-db.ts"],
  updates: ["lib/update-delivery.ts"],
  shopping_list: ["lib/manual-event.ts", "lib/update-delivery.ts"],
  balance: ["lib/manual-event-db.ts", "lib/update-delivery.ts"],
  follow_up: ["lib/team/closeout-db.ts"],
};
check("The Calendar only list is built from the paths actually skipped", calOnly.CALENDAR_ONLY_SKIPPED.every((s) => (guards[s.key] ?? []).length > 0 && guards[s.key].every((p) => /isCalendarOnly\(|calendarOnly/.test(src(p)))) && calOnly.CALENDAR_ONLY_SKIPPED.length === Object.keys(guards).length);
check("It names the six things the client will not get", ["concierge link", "automated client texts or emails", "client shopping list", "balance reminders", "post event follow up"].every((w) => calOnly.CALENDAR_ONLY_SKIPPED.some((s) => s.label.toLowerCase().includes(w))));

// The tag, the form and the card.
const item = eventList.eventListItem(session(id) as never, undefined, { admin: true });
check("A Calendar only tag on the admin list and calendar", item.calendarOnly === true && src("app/team/events/event-list.tsx").includes("{e.calendarOnly && <span") && cal.includes("{e.calendarOnly && <span"));
check("Bartenders never see the tag", eventList.eventListItem(session(id) as never).calendarOnly === undefined);
const formSrc = src("app/team/admin/events/new/add-event-form.tsx");
check("The form asks New booking or Already confirmed at the top", formSrc.indexOf("Already confirmed, add to our calendar only") < formSrc.indexOf(">Client</h2>") && formSrc.includes('"New booking"'));
check("The form's note lists what will not happen, and hides the link and list options", formSrc.includes("CALENDAR_ONLY_SKIPPED.map((s) => (") && formSrc.includes("{!calendarOnly && (\n            <button") && formSrc.includes("{!calendarOnly && (\n          <label"));
const mgr = src("app/team/admin/e/[id]/page.tsx");
check("The Calendar only card is at the bottom of Details", mgr.indexOf("{session.calendar_only && <CalendarOnlyCard") > mgr.indexOf("<HideAction") && mgr.indexOf("{session.calendar_only && <CalendarOnlyCard") < mgr.indexOf("team: () =>"));
check("The card lists the same paths and confirms before turning on", src("app/team/admin/e/[id]/calendar-only-card.tsx").includes("CALENDAR_ONLY_SKIPPED.map") && src("app/team/admin/e/[id]/calendar-only-card.tsx").includes("Yes, turn on client messages"));

// ----- Turn on client messages -----
check("A bartender cannot turn on client messages", !(await manualDb.turnOnClientMessages(sam as never, id)).ok && session(id).calendar_only === true);
hooks.length = 0;
const on = await manualDb.turnOnClientMessages(alex as never, id);
check("A manager turns them on: calendar only is off and the intake goes once", on.ok && on.sent && session(id).calendar_only === false && hooks.filter((h) => h.url === "https://hooks.test/intake").length === 1);
const again = await manualDb.turnOnClientMessages(admin as never, id);
check("A second tap sends nothing more", again.ok && !again.sent && hooks.filter((h) => h.url === "https://hooks.test/intake").length === 1);
check("Who turned them on is recorded", session(id).client_messages_on_by === "Alex" && !!session(id).client_messages_on_at);
const later = await editDb.saveAdminEdit({ sessionId: id, admin: admin as never, changes: { guest_count: "130" }, price: { mode: "keep" }, expectedVersion: Number(session(id).version), origin: "https://plan.test" });
check("From then on updates go to GHL as normal", later.ok && hooks.some((h) => h.url === "https://hooks.test/update"));
check("The route is admins and managers only", src("app/api/team/admin/client-messages/route.ts").includes("if (!isAdminRole(staff.role)) return NextResponse.json({ error: \"Admins only.\" }, { status: 403 });"));

// ----- A normal booking is unchanged -----
reset();
const normal = await manualDb.addManualEvent(admin, form({ email: "new@example.com" }));
check("A New booking still sends the intake", normal.ok && hooks.filter((h) => h.url === "https://hooks.test/intake").length === 1 && session(normal.ok ? normal.id : "").calendar_only !== true);

// ----- The migration -----
const sql = src("supabase/migrations/20261207_calendar_only.sql");
check("The migration adds calendar_only and who turned messages on, safe to run twice", sql.includes("add column if not exists calendar_only         boolean not null default false") && sql.includes("client_messages_on_at") && sql.includes("client_messages_on_by"));

done("calendar only");
