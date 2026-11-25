// Order window, the per event checklist item that replaced the weekly
// deliveries and pickups confirm: asked right after accepting, Delivery or
// Pickup and one or more windows on the days leading up to the event,
// prefilled from the usual order windows on the profile, open until answered,
// editable until the order is placed, everyone on the event whatever their
// role, skipped where we buy nothing (the new Bartender Only), one reminder
// 24 hours after accepting and one more inside 5 days (red), shown to admins
// and managers on the Team tab, the order sheet, and the events list alerts.
// Also: the usual order windows on the profile (optional, renamed), and the
// weekly confirm gone.
// Run: node --no-warnings scripts/test-delivery-availability.mts

import { check, done, src, texts, textsTo, event } from "./team-harness.mts";

const { db, missingTables } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const da = await import("../lib/team/delivery-availability.ts");
const daDb = await import("../lib/team/delivery-availability-db.ts");
const ow = await import("../lib/team/order-window.ts");
const owDb = await import("../lib/team/order-window-db.ts");
const profile = await import("../lib/team/profile.ts");

const CT = "America/Chicago";
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const manager = { id: "m1", name: "Mo Lee", phone: "+12145550101", role: "manager" as const, active: true };
const taylor = { id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender" as const, active: true };
const sam = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const lena = { id: "b3", name: "Lena Park", phone: "+13105550113", role: "bar_back" as const, active: true };

const at = (ymd: string, h: number, m = 0) => time.zonedInstant(ymd, h * 60 + m, CT);
const TUE = at("2026-11-24", 10); // before the item shipped
const WED = at("2026-11-25", 10);
const FAR = "2026-12-05"; // a Saturday, 11 days out
const NEAR = "2026-11-28"; // a Saturday, inside 5 days

const W = (o: Record<string, unknown> = {}) => ({
  delivery_windows: {
    wed: { receive: { on: true, from: "09:00", to: "17:00" }, pickup: { on: false } },
    thu: { receive: { on: true, from: "12:00", to: "18:00" }, pickup: { on: true, from: "16:00", to: "20:00" } },
    fri: { receive: { on: false }, pickup: { on: true, from: "16:00", to: "20:00" } },
  },
  home_type: "apartment",
  handoff_pref: "either",
  delivery_notes: "Gate code 1234",
  ...o,
});

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [
    { ...admin, markets: ["dallas"] },
    { ...manager, markets: ["dallas"] },
    { ...taylor, markets: ["dallas"], off_weekdays: [0] },
    { ...sam, markets: ["dallas"] },
    { ...lena, markets: ["los_angeles"] },
  ];
  db.sessions = [
    event("far", FAR, "100 Main St, Dallas, TX"),
    event("near", NEAR, "100 Main St, Dallas, TX"),
    event("bo", FAR, "100 Main St, Dallas, TX", { package: "Bartender Only", pricing_model: "service_fee" }, { package_type: "Bartender Only", pricing_model: "service_fee" }),
    event("past", "2026-11-20", "100 Main St, Dallas, TX"),
  ];
  const acc = (id: string, s: string, staff: string, status = "accepted", responded = "2026-11-20T15:00:00.000Z") => ({ id, session_id: s, staff_id: staff, status, role: "bartender", assigned_at: responded, responded_at: status === "offered" ? null : responded });
  db.event_assignments = [
    acc("x1", "far", "b1"),
    acc("x2", "far", "b2", "offered"),
    acc("x3", "far", "b3"), // bar back: answers too
    acc("x4", "near", "b1"),
    acc("x5", "bo", "b1"),
    acc("x6", "past", "b1"),
  ];
  db.event_assignments.find((a) => a.id === "x3")!.role = "bar_back";
  for (const t of ["staff_profiles", "team_settings", "team_notices", "event_order_windows", "order_sheet_lines", "team_hidden_events"]) db[t] = [];
  texts.length = 0;
}
const S = (id: string) => db.sessions.find((s) => s.id === id) as never;
const ans = (o: Record<string, unknown> = {}) => ({ method: "delivery", windows: [{ date: "2026-12-04", from: "09:00", to: "17:00" }], note: "  Leave it   with the desk ", ...o });

// ----- 1. The rules -----
const days = ow.dayChoices(FAR, "2026-11-24");
check("Days offered: a week before the event through the event day", days[0] === "2026-11-28" && days.at(-1) === FAR && days.length === 8);
check("Never a day before today", ow.dayChoices(NEAR, "2026-11-25")[0] === "2026-11-25" && ow.dayChoices(NEAR, "2026-11-25").at(-1) === NEAR);
const c = ow.cleanAnswer(ans(), days);
check("Delivery or Pickup, windows as minutes, the note one short line", c.ok && c.value.method === "delivery" && c.value.windows[0].from === 540 && c.value.windows[0].to === 1020 && c.value.note === "Leave it with the desk");
check("Pick Delivery or Pickup", !ow.cleanAnswer(ans({ method: "drone" }), days).ok);
check("At least one window", !ow.cleanAnswer(ans({ windows: [] }), days).ok);
check("A window needs a from and a to, from before to", !ow.cleanAnswer(ans({ windows: [{ date: "2026-12-04", from: "09:00", to: "" }] }), days).ok && !ow.cleanAnswer(ans({ windows: [{ date: "2026-12-04", from: "18:00", to: "09:00" }] }), days).ok);
check("A window after the event or too early is refused", !ow.cleanAnswer(ans({ windows: [{ date: "2026-12-06", from: "09:00", to: "10:00" }] }), days).ok && !ow.cleanAnswer(ans({ windows: [{ date: "2026-11-20", from: "09:00", to: "10:00" }] }), days).ok);
check("More than one window, sorted by day", (() => { const r = ow.cleanAnswer(ans({ windows: [{ date: "2026-12-04", from: "09:00", to: "12:00" }, { date: "2026-12-03", from: "13:00", to: "15:00" }] }), days); return r.ok && r.value.windows[0].date === "2026-12-03" && r.value.windows.length === 2; })());
check("Notes are cut to 120 characters", (ow.cleanAnswer(ans({ note: "x".repeat(300) }), days) as { value: { note: string } }).value.note.length === ow.NOTE_MAX);
const usual = (da.cleanDelivery(W()) as { value: { delivery_windows: unknown } }).value.delivery_windows;
const pf = ow.prefill({ delivery_windows: usual, handoff_pref: "either" }, FAR, "2026-11-24");
check("Prefilled from the usual windows on the 3 days before the event", pf.method === "delivery" && pf.windows.map((w) => `${w.date} ${w.from}-${w.to}`).join() === "2026-12-02 540-1020,2026-12-03 720-1080");
const pfp = ow.prefill({ delivery_windows: usual, handoff_pref: "pickup" }, FAR, "2026-11-24");
check("Prefers pickup prefills Pickup with the usual pickup times", pfp.method === "pickup" && pfp.windows.map((w) => w.date).join() === "2026-12-03,2026-12-04");
check("No usual windows: Delivery, nothing filled in", ow.prefill(null, FAR, "2026-11-24").windows.length === 0 && ow.prefill(null, FAR, "2026-11-24").method === "delivery");
check("The question and the item name", ow.QUESTION === "When can you receive the order for this event?" && ow.ITEM_TITLE === "Order window" && ow.NEEDED_LABEL === "Order window needed");
check("Urgent inside 5 days of the event", ow.urgent(NEAR, WED) && !ow.urgent(FAR, WED) && !ow.urgent("2026-11-20", WED));

// ----- 2. Who is asked -----
reset();
db.staff_profiles.push({ staff_id: "b1", delivery_windows: usual, handoff_pref: "either" });
const v1 = await owDb.orderWindowView(S("far"), "b1", WED);
check("Someone who accepted gets the item, open, prefilled from their profile", !!v1 && v1.answer === null && v1.prefill.windows.length === 2 && !v1.locked && !v1.urgent);
check("Whatever their role on the event: a bar back answers too", !!(await owDb.orderWindowView(S("far"), "b3", WED)));
check("Not before they accept", (await owDb.orderWindowView(S("far"), "b2", WED)) === null);
check("Skipped where we buy nothing: the new Bartender Only", (await owDb.orderWindowView(S("bo"), "b1", WED)) === null);
check("Legacy Bartender Only on the gratuity model is still asked", (() => { const s = event("legacy", FAR, "x", { package: "Bartender Only", pricing_model: "gratuity" }); return !owDb.buysNothing(s.event_data as Record<string, unknown>); })());
check("Not on a past event", (await owDb.orderWindowView(S("past"), "b1", WED)) === null);
check("Red inside 5 days while open", (await owDb.orderWindowView(S("near"), "b1", WED))!.urgent);
check("Events already accepted before this shipped get it too", (await owDb.orderWindowView(S("near"), "b1", TUE)) !== null);

// ----- 3. Answering and editing -----
const s1 = await owDb.saveOrderWindow(S("far"), taylor, ans(), WED);
check("Answering closes the item", s1.ok && !!s1.view.answer && s1.view.summary === "Delivery: Fri, Dec 4 9a–5p" && s1.view.answer!.note === "Leave it with the desk");
check("Someone not on the event cannot answer for it", !(await owDb.saveOrderWindow(S("far"), sam, ans(), WED)).ok);
check("Nor on a Bartender Only event", !(await owDb.saveOrderWindow(S("bo"), taylor, ans(), WED)).ok);
const s2 = await owDb.saveOrderWindow(S("far"), taylor, ans({ method: "pickup", windows: [{ date: "2026-12-03", from: "16:00", to: "20:00" }], note: "" }), WED);
check("They can change it any time before the order is placed", s2.ok && s2.view.summary === "Pickup: Thu, Dec 3 4p–8p" && db.event_order_windows.filter((r) => r.session_id === "far" && r.staff_id === "b1").length === 1);
db.order_sheet_lines.push({ id: "l1", session_id: "far", ordered: true, removed: false });
const s3 = await owDb.saveOrderWindow(S("far"), taylor, ans(), WED);
check("Once the order is placed it is locked", !s3.ok && s3.status === 409 && (await owDb.orderWindowView(S("far"), "b1", WED))!.locked);
db.order_sheet_lines[0].removed = true;
check("A removed ordered line does not count as placed", (await owDb.saveOrderWindow(S("far"), taylor, ans(), WED)).ok);

// ----- 4. Admins and managers: Team tab and order sheet -----
reset();
await owDb.saveOrderWindow(S("far"), taylor, ans(), WED);
db.staff_profiles.push({ staff_id: "b1", home_type: "apartment", handoff_pref: "either", delivery_notes: "Gate code 1234" });
const people = [
  { staffId: "b1", name: "Taylor Brooks", status: "accepted" },
  { staffId: "b2", name: "Sam Diaz", status: "offered" },
  { staffId: "b3", name: "Lena Park", status: "accepted" },
];
const team = await owDb.orderWindowsFor(S("far"), people, WED);
const tb = team.people.find((p) => p.staffId === "b1")!;
const lp = team.people.find((p) => p.staffId === "b3")!;
check("Each person's answer: method, windows, note, and their home from the profile", tb.method === "Delivery" && tb.windows.join() === "Fri, Dec 4 9a–5p" && tb.note === "Leave it with the desk" && tb.home === "Apartment" && tb.profileNote === "Gate code 1234" && !tb.needed);
check("Not answered: Order window needed", lp.needed && !lp.urgent);
check("Not accepted yet is not counted as needed", !team.people.find((p) => p.staffId === "b2")!.needed);
check("Red inside 5 days", (await owDb.orderWindowsFor(S("near"), [{ staffId: "b1", name: "Taylor", status: "accepted" }], WED)).people[0].urgent);
check("Hidden on events where we buy nothing", !(await owDb.orderWindowsFor(S("bo"), people, WED)).asks);
const page = src("app/team/admin/e/[id]/page.tsx");
const teamPanel = page.slice(page.indexOf("    team: () => {"), page.indexOf("    order: () => "));
const orderPanel = page.slice(page.indexOf("    order: () => "), page.indexOf("    client: () => "));
check("On the Team tab, above the assign panel", teamPanel.includes("<OrderWindowStrip data={orderWindows} />") && teamPanel.indexOf("<OrderWindowStrip") < teamPanel.indexOf("<AssignPanel"));
check("At the top of the Shopping list tab, above the order sheet", orderPanel.includes("<OrderWindowStrip data={orderWindows} />") && orderPanel.indexOf("<OrderWindowStrip") < orderPanel.indexOf("<OrderSheet"));
const strip = src("app/team/admin/e/[id]/order-window-strip.tsx");
check("The strip shows Order window needed and never a price", strip.includes("NEEDED_LABEL") && !/price|cost|cents|\$\{?\d/i.test(strip));

// ----- 5. The admin events list alert -----
const alerts = await owDb.orderWindowAlerts(WED);
check("Upcoming events with an open item count in the alerts, urgent first", alerts.map((a) => a.sessionId).join() === "near,far" && alerts[0].urgent && alerts[1].people.join() === "Lena Park");
check("Not Bartender Only, not past events", !alerts.some((a) => a.sessionId === "bo" || a.sessionId === "past"));
db.team_hidden_events.push({ session_id: "near" });
check("Not hidden events", !(await owDb.orderWindowAlerts(WED)).some((a) => a.sessionId === "near"));
db.order_sheet_lines.push({ id: "l2", session_id: "far", ordered: true, removed: false });
check("Not once the order is placed", (await owDb.orderWindowAlerts(WED)).length === 0);
check("Shown with the other alerts on the events list", src("lib/unsaved-sessions-db.ts").includes("orderWindowAlerts(now)") && src("app/team/admin/events/save-alerts.tsx").includes("Order window needed:"));

// ----- 6. Reminders -----
reset();
check("Nothing before the item shipped plus 24 hours (older accepts)", (await owDb.sendOrderWindowReminders(at("2026-11-25", 23))) === 0 && texts.length === 0);
const sentFirst = await owDb.sendOrderWindowReminders(at("2026-11-26", 9, 55));
check("24 hours on: one text each, the near event gets the inside 5 days text", sentFirst === 2 && textsTo(taylor).length === 2 && textsTo(lena).length === 0, `${sentFirst} ${JSON.stringify(texts)}`);
check("Quiet hours kept: 7:55 AM in Los Angeles waits", textsTo(lena).length === 0);
await owDb.sendOrderWindowReminders(at("2026-11-26", 9, 58));
check("Each reminder goes out once", textsTo(taylor).length === 2);
await owDb.sendOrderWindowReminders(at("2026-11-26", 10, 30)); // 8:30 AM in Los Angeles
check("Los Angeles gets it after quiet hours", textsTo(lena).length === 1);
const farText = textsTo(taylor).find((t) => !/coming up/.test(t.message))!;
const nearText = textsTo(taylor).find((t) => /coming up/.test(t.message))!;
check("The text has the event link, no prices or client details", farText.message.includes("https://plan.test/team/e/far") && !/\$|Reyes|9725550199/.test(farText.message) && /receive the order/.test(farText.message));
check("Inside 5 days it says it is needed now", nearText.message.includes("https://plan.test/team/e/near") && /still need your order window/.test(nearText.message));
const before = textsTo(taylor).length;
await owDb.sendOrderWindowReminders(at("2026-11-27", 10));
check("Inside 5 days only one more: never the first text after it", textsTo(taylor).length === before);
await owDb.sendOrderWindowReminders(at("2026-11-30", 10)); // far is now inside 5 days
check("Far event: the second reminder once it is inside 5 days", textsTo(taylor).filter((t) => t.message.includes("/team/e/far")).length === 2);
reset();
db.event_assignments.find((a) => a.id === "x1")!.responded_at = "2026-11-27T21:00:00.000Z"; // 3 PM Central
await owDb.saveOrderWindow(S("near"), taylor, ans({ windows: [{ date: "2026-11-27", from: "09:00", to: "12:00" }] }), at("2026-11-26", 9));
await owDb.sendOrderWindowReminders(at("2026-11-28", 9, 30));
check("Not until 24 hours after accepting; answered items get nothing", textsTo(taylor).length === 0, JSON.stringify(texts));
await owDb.sendOrderWindowReminders(at("2026-11-28", 15, 30));
check("Then one text", textsTo(taylor).length === 1);
check("The reminder runs from the team cron; the Wednesday one is gone", src("app/api/cron/team/route.ts").includes("sendOrderWindowReminders(now)") && !src("app/api/cron/team/route.ts").includes("sendDeliveryReminders"));

// ----- 7. Before the migration -----
reset();
missingTables.add("event_order_windows");
check("Before the migration: no reminders, no alerts, nothing throws", (await owDb.sendOrderWindowReminders(at("2026-11-30", 10)).catch(() => -1)) === 0 && (await owDb.orderWindowAlerts(WED)).length === 0 && texts.length === 0);
check("Before the migration: saving says it could not save", !(await owDb.saveOrderWindow(S("far"), taylor, ans(), WED)).ok);
missingTables.delete("event_order_windows");

// ----- 8. The staff side -----
const tabs = src("app/team/e/[id]/event-tabs.tsx");
check("The item sits with the pre event checklist on the event page", tabs.indexOf("<OrderWindowCard") > 0 && tabs.indexOf("<OrderWindowCard") < tabs.indexOf("<PrepStrip"));
check("Accepting goes straight to it", src("app/team/e/[id]/respond-banner.tsx").includes("?accepted=1") && src("app/team/offer/[id]/page.tsx").includes("<OrderWindowCard"));
const card = src("app/team/e/[id]/order-window-card.tsx");
check("One tap confirms the usual times", card.includes("Confirm my usual times"));
check("No prices, costs, or supplier links reach the card", !/price|cost|cents|supplier|http/i.test(card) && !/pricing|service-fee|bartender-only/.test(src("lib/team/order-window.ts")));

// ----- 9. Usual order windows on the profile -----
reset();
check("Renamed Usual order windows, optional", da.SECTION_TITLE === "Usual order windows" && /Optional/.test(da.SECTION_LINE) && /not about working shifts/.test(da.SECTION_LINE));
db.staff_profiles.push({ staff_id: "b1", dropoff_time: "Weekday evenings", email: "t@x.co" });
const sv = await daDb.saveDelivery(taylor, "b1", W());
const row = db.staff_profiles.find((r) => r.staff_id === "b1")!;
check("Saving keeps the rest of the profile, replaces the old note, confirms nothing", sv.ok && row.dropoff_time === null && row.email === "t@x.co" && !("availability_confirmed_at" in row));
check("Days I never work is untouched", JSON.stringify(db.staff.find((s) => s.id === "b1")!.off_weekdays) === "[0]" && !src("lib/team/delivery-availability-db.ts").includes("off_weekdays") && !src("app/team/me/profile/delivery-form.tsx").includes("off_weekdays"));
check("Another bartender cannot see or change it", (await daDb.viewDelivery(sam, "b1")) === null && !(await daDb.saveDelivery(sam, "b1", W())).ok);
check("An admin can fill it in for someone", (await daDb.saveDelivery(admin, "b2", W())).ok);
check("Optional: not on the profile completeness list", !profile.missingItems({ name: "A", phone: "1" }, null, [], [], "2026-11-24").includes("Usual order windows") && !profile.missingItems({ name: "A", phone: "1" }, null, [], [], "2026-11-24").includes("Deliveries and pickups"));

// ----- 10. The weekly confirm is gone -----
const gone = ["lib/team/delivery-availability.ts", "lib/team/delivery-availability-db.ts", "app/team/me/profile/delivery-form.tsx", "app/api/team/delivery/route.ts", "app/team/events/page.tsx", "app/team/admin/staff/page.tsx"].map(src).join("\n");
check("No Wednesday deadline, reminder, home card, or confirmed this week list", !/Wednesday,|Wednesday at|REMINDER_DAY|deadline|Still correct for this week|confirmedThisWeek|DeliveryReminderCard|DeliveryConfirmations|confirmationList|availability_confirmed_at/.test(gone));

done("order window");
