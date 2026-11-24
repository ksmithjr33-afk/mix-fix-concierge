// Deliveries and pickups on the staff profile: the per day windows and their
// checks, house or apartment, delivery pickup or either, the notes line, the
// weekly confirm (one tap or saving an edit, never an admin for someone),
// the deadline (Wednesday 6 PM Central, changeable by admins only), the
// home screen card until confirmed, the admin and manager list, nobody
// reassigned, and the one Wednesday 9 AM reminder text that keeps quiet hours.
// Run: node --no-warnings scripts/test-delivery-availability.mts

import { check, done, src, texts, textsTo } from "./team-harness.mts";

const { db, missingTables } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const da = await import("../lib/team/delivery-availability.ts");
const daDb = await import("../lib/team/delivery-availability-db.ts");

const CT = "America/Chicago";
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const manager = { id: "m1", name: "Mo Lee", phone: "+12145550101", role: "manager" as const, active: true };
const taylor = { id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender" as const, active: true };
const sam = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const lena = { id: "b3", name: "Lena Park", phone: "+13105550113", role: "bar_back" as const, active: true };
const gone = { id: "b4", name: "Old Timer", phone: "+12145550114", role: "bartender" as const, active: false };

// Week of Monday Nov 23, 2026. Wednesday is Nov 25.
const at = (ymd: string, h: number, m = 0) => time.zonedInstant(ymd, h * 60 + m, CT);
const mon = at("2026-11-23", 10);
const tue = at("2026-11-24", 15);

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [
    { ...admin, markets: ["dallas"] },
    { ...manager, markets: ["dallas"] },
    { ...taylor, markets: ["dallas"], off_weekdays: [0] },
    { ...sam, markets: ["austin"] },
    { ...lena, markets: ["los_angeles"] },
    { ...gone, markets: ["dallas"] },
  ];
  for (const t of ["staff_profiles", "team_settings", "team_notices"]) db[t] = [];
  texts.length = 0;
}

const W = (o: Record<string, unknown> = {}) => ({
  delivery_windows: {
    mon: { receive: { on: true, from: "09:00", to: "17:00" }, pickup: { on: false, from: "", to: "" } },
    fri: { receive: { on: false }, pickup: { on: true, from: "16:00", to: "20:00" } },
    sat: { receive: { on: true, from: "10:00", to: "14:00" }, pickup: { on: true, from: "08:00", to: "11:30" } },
  },
  home_type: "apartment",
  handoff_pref: "pickup",
  delivery_notes: "  Gate code 1234,   side door ",
  ...o,
});
const row = (id: string) => db.staff_profiles.find((r) => r.staff_id === id) as Record<string, unknown> | undefined;

// ----- 1. The fields -----
reset();
const c = da.cleanDelivery(W());
check("Per day receive and pickup windows are saved as minutes", c.ok && c.value.delivery_windows.mon.receive.from === 540 && c.value.delivery_windows.mon.receive.to === 1020 && c.value.delivery_windows.sat.pickup.to === 690);
check("A day left alone is a no for both", c.ok && !c.value.delivery_windows.tue.receive.on && !c.value.delivery_windows.tue.pickup.on);
check("House or apartment, the preference, and one short notes line", c.ok && c.value.home_type === "apartment" && c.value.handoff_pref === "pickup" && c.value.delivery_notes === "Gate code 1234, side door");
check("A yes needs a from and a to time", !da.cleanDelivery(W({ delivery_windows: { tue: { receive: { on: true, from: "09:00", to: "" } } } })).ok);
check("The from time must be before the to time", !da.cleanDelivery(W({ delivery_windows: { tue: { pickup: { on: true, from: "18:00", to: "09:00" } } } })).ok);
check("Only house or apartment", !da.cleanDelivery(W({ home_type: "boat" })).ok);
check("Only delivery, pickup, or either", !da.cleanDelivery(W({ handoff_pref: "drone" })).ok && da.cleanDelivery(W({ handoff_pref: "either" })).ok);
check("Notes are one short line", da.cleanDelivery(W({ delivery_notes: "x".repeat(400) })).ok && (da.cleanDelivery(W({ delivery_notes: "x".repeat(400) })) as { value: { delivery_notes: string } }).value.delivery_notes.length === da.NOTES_MAX);
check("Section title and the line that it is not about shifts", da.SECTION_TITLE === "Deliveries and pickups" && /receiving supplies/.test(da.SECTION_LINE) && /not about working shifts/.test(da.SECTION_LINE));

// ----- 2. Saving, confirming, and who may -----
reset();
db.staff_profiles.push({ staff_id: "b1", dropoff_time: "Weekday evenings", email: "t@x.co" });
const s1 = await daDb.saveDelivery(taylor, "b1", W(), mon);
check("A bartender saves their own and that confirms the week", s1.ok && s1.delivery.status.confirmed && !!row("b1")!.availability_confirmed_at);
check("Saving replaces the old free text note and keeps the rest of the profile", row("b1")!.dropoff_time === null && row("b1")!.email === "t@x.co");
check("Days I never work is untouched", JSON.stringify(db.staff.find((s) => s.id === "b1")!.off_weekdays) === "[0]" && !src("lib/team/delivery-availability-db.ts").includes("off_weekdays") && !src("app/team/me/profile/delivery-form.tsx").includes("off_weekdays"));
check("Another bartender cannot change it", !(await daDb.saveDelivery(sam, "b1", W(), mon)).ok);
check("Another bartender cannot see it", (await daDb.viewDelivery(sam, "b1", mon)) === null);
reset();
const byAdmin = await daDb.saveDelivery(admin, "b2", W(), mon);
check("An admin can fill it in for someone, but that does not confirm for them", byAdmin.ok && !byAdmin.delivery.status.confirmed && !row("b2")!.availability_confirmed_at);
check("Only they can confirm: the admin view says so", byAdmin.ok && !byAdmin.delivery.self && byAdmin.delivery.asked);
const one = await daDb.confirmDelivery(sam, tue);
check("One tap: Still correct for this week", one.ok && one.delivery.status.confirmed && da.CONFIRM_BUTTON === "Still correct for this week");
reset();
check("One tap needs times filled in first", !(await daDb.confirmDelivery(taylor, mon)).ok);

// ----- 3. The week and the deadline -----
reset();
const d0 = await daDb.deliveryDeadline();
check("Default deadline: Wednesday 6 PM Central", d0.day === "wed" && d0.minutes === 1080 && da.deadlineText(mon, d0) === "Wednesday, Nov 25 at 6:00 PM Central");
check("The week starts Monday, Chicago", da.weekStart(at("2026-11-29", 23)) === "2026-11-23" && da.weekStart(at("2026-11-30", 0, 5)) === "2026-11-30");
await daDb.saveDelivery(taylor, "b1", W(), at("2026-11-20", 12)); // last Friday
check("Last week's confirmation does not count this week", !(await daDb.viewDelivery(taylor, "b1", mon))!.status.confirmed);
check("Before the deadline it is not overdue", !(await daDb.viewDelivery(taylor, "b1", tue))!.status.overdue);
check("After the deadline it is overdue", (await daDb.viewDelivery(taylor, "b1", at("2026-11-25", 18, 1)))!.status.overdue);
check("A manager cannot change the deadline", !(await daDb.saveDeliveryDeadline(manager, { day: "thu", time: "12:00" })).ok);
check("A bartender cannot change the deadline", !(await daDb.saveDeliveryDeadline(taylor, { day: "thu", time: "12:00" })).ok);
const nd = await daDb.saveDeliveryDeadline(admin, { day: "thu", time: "12:00" });
check("An admin changes the deadline in settings", nd.ok && nd.rule === "Every Thursday at 12:00 PM Central" && (await daDb.viewDelivery(taylor, "b1", mon))!.status.deadline === "Thursday, Nov 26 at 12:00 PM Central");
check("A bad deadline is refused", !(await daDb.saveDeliveryDeadline(admin, { day: "someday", time: "12:00" })).ok && !(await daDb.saveDeliveryDeadline(admin, { day: "wed", time: "25:00" })).ok);

// ----- 4. Home screen card -----
reset();
const card = await daDb.myDeliveryReminder(taylor, mon);
check("The home screen shows the deadline until confirmed", card !== null && card.deadline === "Wednesday, Nov 25 at 6:00 PM Central" && !card.set);
await daDb.saveDelivery(taylor, "b1", W(), mon);
check("Gone once confirmed", (await daDb.myDeliveryReminder(taylor, tue)) === null);
check("Back the next week", (await daDb.myDeliveryReminder(taylor, at("2026-11-30", 9))) !== null);
check("Admins and managers are not asked", (await daDb.myDeliveryReminder(admin, mon)) === null && (await daDb.myDeliveryReminder(manager, mon)) === null);
check("The card is on the home screen and the section on the profile", src("app/team/events/page.tsx").includes("DeliveryReminderCard") && src("app/team/me/profile/page.tsx").includes("DeliveryForm"));

// ----- 5. Who has and has not confirmed -----
reset();
await daDb.saveDelivery(taylor, "b1", W(), mon);
await daDb.saveDelivery(admin, "b2", W(), mon);
const list = await daDb.confirmationList(manager, tue);
check("Managers see who has and has not confirmed", list !== null && list.confirmed.map((p) => p.id).join() === "b1" && list.notConfirmed.map((p) => p.id).sort().join() === "b2,b3");
check("It says who never filled in their times", list!.notConfirmed.find((p) => p.id === "b3")!.set === false && list!.notConfirmed.find((p) => p.id === "b2")!.set === true);
check("Inactive staff and admins are not on it", !JSON.stringify(list).includes("Old Timer") && !JSON.stringify(list).includes("Kenneth"));
check("Bartenders cannot see the list", (await daDb.confirmationList(taylor, tue)) === null);
check("Nobody is reassigned automatically", !/event_assignments|offer_|unassign/.test(src("lib/team/delivery-availability-db.ts")));

// ----- 6. The Wednesday reminder -----
reset();
await daDb.saveDelivery(taylor, "b1", W(), mon); // confirmed
await daDb.saveDelivery(admin, "b2", W(), mon); // filled in, not confirmed (Austin)
// Lena (Los Angeles) never filled anything in.
check("No reminder on Tuesday", (await daDb.sendDeliveryReminders(tue)) === 0 && texts.length === 0);
check("No reminder Wednesday before 9 AM Central", (await daDb.sendDeliveryReminders(at("2026-11-25", 8, 55))) === 0 && texts.length === 0);
const sent9 = await daDb.sendDeliveryReminders(at("2026-11-25", 9));
check("Wednesday 9 AM: one text to each person not confirmed", sent9 === 1 && textsTo(sam).length === 1 && textsTo(taylor).length === 0);
check("Quiet hours kept: 7 AM in Los Angeles waits", textsTo(lena).length === 0);
await daDb.sendDeliveryReminders(at("2026-11-25", 9, 5));
await daDb.sendDeliveryReminders(at("2026-11-25", 9, 30));
check("Only one reminder a week", textsTo(sam).length === 1);
await daDb.sendDeliveryReminders(at("2026-11-25", 10, 0)); // 8 AM in Los Angeles
check("Los Angeles gets it at 8 AM their time", textsTo(lena).length === 1);
check("The text has the deadline and the link, no prices or client details", /by Wednesday, Nov 25 at 6:00 PM Central/.test(textsTo(sam)[0].message) && textsTo(sam)[0].message.includes("https://plan.test/team/me/profile#deliveries") && !/\$/.test(textsTo(sam)[0].message));
check("Admins and managers get no reminder", texts.every((t) => t.phone !== admin.phone && t.phone !== manager.phone));
check("The reminder runs from the team cron", src("app/api/cron/team/route.ts").includes("sendDeliveryReminders(now)"));

// ----- 7. Before the migration -----
reset();
missingTables.add("staff_profiles");
check("Before the migration the reminder sends nothing and nothing throws", (await daDb.sendDeliveryReminders(at("2026-11-25", 9)).catch(() => -1)) === 0 && texts.length === 0);
check("Before the migration the home card and section read empty, nothing throws", (await daDb.myDeliveryReminder(taylor, mon))?.set === false && (await daDb.viewDelivery(taylor, "b1", mon))?.windows === null);
missingTables.delete("staff_profiles");

// ----- 8. On the event -----
const ev = da.eventAvailability("b1", { delivery_windows: (da.cleanDelivery(W()) as { value: { delivery_windows: unknown } }).value.delivery_windows, home_type: "apartment", handoff_pref: "pickup", availability_confirmed_at: mon.toISOString() }, "2026-11-28", tue);
check("For a Saturday event: the day before and the day of", ev.receive === "Sat 10a–2p" && ev.pickup === "Fri 4p–8p, Sat 8a–11:30a");
check("With home, preference, and confirmed this week", ev.home === "Apartment" && ev.pref === "Prefers pickup" && ev.confirmed && ev.full.length === 7);
check("Nothing set reads not set", da.eventAvailability("b2", null, "2026-11-28", tue).receive === "not set" && !da.eventAvailability("b2", null, "2026-11-28", tue).set);

done("deliveries and pickups");
