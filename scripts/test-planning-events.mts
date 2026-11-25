// Bookings the client has not finished planning: the built details, which
// unfinished bookings show (on or after Nov 25, 2026), the "Planning not
// finished" tag, the "Waiting on the client" alert, the Team tab working on
// one (bartenders needed, roles, assigning, accepting), mileage waiting for the
// address, the finish (same record, nothing the team set lost, "Details are in"
// once per person, held in quiet hours, the date or start time change to staff
// and admins, mileage worked out), the staff view (banner, city, no prices),
// and what stays closed until planning is finished. Real code against the
// in-memory database.
// Run: node --no-warnings scripts/test-planning-events.mts

import { addDays, check, done, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const p = await import("../lib/planning.ts");
const pdb = await import("../lib/planning-db.ts");
const ts = await import("../lib/team/team-sessions.ts");
const ev = await import("../lib/team/events.ts");
const el = await import("../lib/team/event-list.ts");
const view = await import("../lib/team/event-view.ts");
const sfx = await import("../lib/team/staffing-fix-db.ts");
const adb = await import("../lib/team/assignments-db.ts");
const upd = await import("../lib/event-updates.ts");
const usd = await import("../lib/unsaved-sessions-db.ts");
const time = await import("../lib/team/time.ts");

const today = time.chicagoToday();
const NOW = new Date();
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const sam = { id: "b1", name: "Sam Lee", phone: "+12145550111", role: "bartender" as const, active: true, markets: ["dallas"], home_lat: 32.9, home_lng: -96.8 };
const jo = { id: "b2", name: "Jo Park", phone: "+12145550112", role: "bartender" as const, active: true, markets: ["dallas"] };

const booking = (id: string, day: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "in_progress",
  version: 0,
  event_data: null,
  name: "Justin Reyes",
  email: "justin@example.com",
  phone: "+19725550199",
  event_date: day,
  package_type: "Full Bar",
  guest_count: "50-75",
  hours_booked: "4",
  bar_service_start: "6:00 PM",
  event_type: "Birthday",
  event_city: "Dallas",
  event_state: "TX",
  bartender_count: 2,
  pricing_model: "service_fee",
  booked_price: { total: 2037, pricing_model: "service_fee" },
  created_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString().replace("Z", ""),
  ...extra,
});

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    booking("u1", addDays(today, 10)),
    booking("u2", addDays(today, 40), { name: "Maria Gomez", created_at: "2026-10-01T12:00:00" }),
    booking("old", "2026-11-01", { name: "Old Abandoned", created_at: "2026-09-01T12:00:00" }),
    booking("dr", addDays(today, 5), { status: "draft" }),
  ];
  db.staff = [admin, sam, jo].map((s) => ({ ...s }));
  for (const t of ["event_assignments", "team_notices", "team_hidden_events", "conversation_logs", "event_updates", "assignment_mileage", "conversation_logs", "event_messages", "event_message_reads", "shift_posts", "staff_unavailability", "team_settings"]) db[t] = [];
  texts.length = 0;
}

// ===== 1. Built details, pure =====
reset();
const row = db.sessions[0] as never;
const ed = p.planningEventData(row);
check("Built from the booking: name, email, phone, date, type, package, start and end, hours, guests (a range is its higher end), bartenders, city, model",
  ed.client_name === "Justin Reyes" && ed.email === "justin@example.com" && ed.client_phone === "+19725550199" && ed.event_type === "Birthday" && ed.package === "Full Bar" &&
  ed.bar_service_start === "6:00 PM" && ed.bar_service_end === "10:00 PM" && ed.hours_booked === 4 && ed.guest_count === 75 && ed.bartenders === 2 && ed.event_city === "Dallas, TX" && ed.pricing_model === "service_fee", JSON.stringify(ed));
check("No address and no drinks are made up", !("event_address" in ed) && !("signature_drinks" in ed));
check("asTeamRow leaves a submitted row alone", p.asTeamRow({ id: "x", status: "submitted", event_data: { a: 1 } }).event_data!.a === 1);
check("Shows: dated on or after Nov 25, 2026", p.showsOnTeam({ id: "a", status: "in_progress", event_date: "2026-11-25", created_at: "2026-01-01T00:00:00" } as never));
check("Shows: booked on or after Nov 25, 2026, whatever the date", p.showsOnTeam({ id: "a", status: "in_progress", event_date: "2026-11-20", created_at: "2026-11-25T09:00:00" } as never));
check("Hidden: an older unfinished booking dated before Nov 25, 2026", !p.showsOnTeam({ id: "a", status: "in_progress", event_date: "2026-11-24", created_at: "2026-10-01T00:00:00" } as never));
check("Hidden: any other status (a draft)", !p.showsOnTeam({ id: "a", status: "draft", event_date: addDays(today, 5) } as never));
check("Days since booked, from booked_on first", p.daysSinceBooked({ id: "a", booked_on: addDays(today, -6), created_at: "2020-01-01T00:00:00" } as never) === 6 && p.daysSinceBooked(row) === 3);
const ch = p.finishChanges(row, { event_date: addDays(today, 11), bar_service_start: "7:00 PM" });
check("Finish changes: the date and the start time, when they differ from the booking", !!ch.date && ch.start === "7:00 PM");
check("Finish changes: none when the client kept them", (() => { const c = p.finishChanges(row, { event_date: addDays(today, 10), bar_service_start: "6pm" }); return !c.date && !c.start; })());
check("The plain text: Details are in for [event].", p.detailsInText("Justin · Birthday", { date: null, start: null }, "L") === "Details are in for Justin · Birthday. L");
check("A changed date asks them to confirm", /Details are in for E\. The date changed to Monday, .*\. Please open the event and confirm you can still work it\. L$/.test(p.detailsInText("E", { date: "Monday, December 7, 2026", start: null }, "L")));
check("A changed start time", p.detailsInText("E", { date: null, start: "7:00 PM" }, "L").includes("The start time changed to 7:00 PM."));

// ===== 2. The team side lists =====
const all = await ts.teamSessions();
check("teamSessions: upcoming unfinished bookings, not the old one or the draft", all.map((s) => s.id).sort().join() === "u1,u2", all.map((s) => s.id).join());
check("Each comes with built details", all.every((s) => s.event_data && (s.event_data as Record<string, unknown>).package === "Full Bar"));
check("Nothing is written back to the session row", (db.sessions[0] as Record<string, unknown>).event_data === null);
check("getTeamSession opens one; not the old one", !!(await ts.getTeamSession("u1")) && !(await ts.getTeamSession("old")));
const item = el.eventListItem(all.find((s) => s.id === "u1")!, undefined, { admin: true });
check("List row: tagged Planning not finished, with the booked city", item.planning === true && item.detail.includes("Dallas, TX") && item.title.startsWith("Justin Reyes"), item.detail);
check("The tag shows on list rows and calendar chips", src("app/team/events/event-list.tsx").includes("Planning not finished") && src("app/team/calendar-view.tsx").includes('e.planning ? "Planning not finished"'));

// ===== 3. Waiting on the client =====
const w = p.waitingOnClient(db.sessions as never, new Set(), NOW);
check("Waiting on the client: both upcoming, soonest first, with days since booked", w.map((x) => x.sessionId).join() === "u1,u2" && w[0].daysSinceBooked === 3);
check("Red within 14 days, not after", w[0].red && !w[1].red);
check("Hidden events are left out", p.waitingOnClient(db.sessions as never, new Set(["u1"]), NOW).every((x) => x.sessionId !== "u1"));
const alerts = await usd.saveAlerts(NOW);
check("The admin events list alert carries them", alerts.waiting.map((x) => x.sessionId).join() === "u1,u2");
check("The alert reads Waiting on the client: N", src("app/team/admin/events/save-alerts.tsx").includes("Waiting on the client: {alerts.waiting.length}"));

// ===== 4. The Team tab works =====
const set = await sfx.setBartendersNeeded("u1", admin as never, 3);
check("Bartenders needed saves on an unfinished booking", set.ok && ((db.sessions[0] as Record<string, unknown>).package_extras as Record<string, unknown>).bartenders_needed === 3);
const role = await sfx.setRoleNeeded("u1", admin as never, "bar_back", 1);
check("Barbacks needed saves too", role.ok);
const u1 = (await ts.getTeamSession("u1"))!;
const asg = await adb.assignStaff(u1, "b1", admin as never, "https://plan.test", { role: "bartender" });
const asg2 = await adb.assignStaff(u1, "b2", admin as never, "https://plan.test", { role: "bar_back" });
check("Assigning with a role works", asg.ok && asg2.ok && (db.event_assignments as Record<string, unknown>[]).some((a) => a.staff_id === "b2" && a.role === "bar_back"), JSON.stringify(asg));
const acc = await adb.respondToAssignment("u1", sam as never, "accept", "https://plan.test");
check("Accepting works", acc.ok && (db.event_assignments as Record<string, unknown>[]).find((a) => a.staff_id === "b1")!.status === "accepted");
check("Mileage waits for the address: nothing stored on accept", (db.assignment_mileage as unknown[]).length === 0);
check("The staff pay estimate says mileage is worked out once the address arrives", src("lib/team/pay.ts").includes('"Mileage is worked out once the address arrives."') && src("lib/team/pay-db.ts").includes('reason: "awaiting_address"'));
const access = await ev.openEvent("u1", sam as never);
check("Someone assigned opens the event", access.ok);
const v = view.buildStaffEventView((access as { session: never }).session);
check("Staff view: the banner flag, date, time, city, package, guests", v.planning && !!v.date && v.serviceStart === "6:00 PM" && v.city === "Dallas, TX" && v.package === "Full Bar" && v.guestCount === "75" && v.address === "");
check("Staff view: no price, no email, no phone, no last name", !/2037|justin@example|9725550199|Reyes/.test(JSON.stringify(v)));
check("The banner text", src("lib/planning-text.ts").includes('"The client has not finished planning. Details will fill in here."') && src("app/team/e/[id]/event-details.tsx").includes("{PLANNING_BANNER}"));
check("Someone not assigned still cannot open it", !(await ev.openEvent("u1", { ...jo, id: "b9" } as never)).ok);

// ===== 5. Closed until planning is finished =====
for (const r of ["checks", "confirm", "supplies-confirm", "supplies-seen"]) {
  check(`/api/team/${r} refuses on an unfinished booking`, src(`app/api/team/${r}/route.ts`).includes("if (isPlanning(access.session)) return NextResponse.json({ error: PLANNING_PLACEHOLDER }, { status: 409 });"));
}
check("Shopping list, order window and menu routes stay on submitted events only", ["app/api/team/shopping-list/route.ts", "app/api/team/order-window/route.ts", "app/api/team/admin/order-sheet/route.ts"].every((f) => src(f).includes("getSubmittedSession(")));
const mgr = src("app/team/admin/e/[id]/page.tsx");
check("Manager view: Shopping list, Client list, Pickups and Business show the placeholder", /order: \(\) => planning \? placeholder/.test(mgr) && /client: \(\) => planning \? placeholder/.test(mgr) && mgr.includes("if (planning) return placeholder;") && mgr.includes("business: () => (planning ? placeholder"));
check("Manager view: no Edit event, read only details, the Planning card, no order windows", mgr.includes("{!hidden && !planning && <EditEvent") && mgr.includes("{hidden || planning ? (") && mgr.includes("<PlanningCard") && mgr.includes("!planning && (on(\"team\") || on(\"order\"))"));
check("Planning card: link with Copy, booked date, days since booked, started or not", src("app/team/admin/e/[id]/planning-card.tsx").includes("<CopyButton") && mgr.includes("daysSince: daysSinceBooked(session)") && mgr.includes("started: conciergeBegun"));
check("Staff view: Tools, Supplies and drinks show the placeholder, no order window or prep strip", src("app/team/e/[id]/event-tabs.tsx").includes("{!view.planning && orderWindow &&") && src("app/team/e/[id]/event-tabs.tsx").includes("{!view.planning && <PrepStrip") && src("app/team/e/[id]/event-details.tsx").includes("if (v.planning) {"));
check("Order window reminders count from the finish for someone who accepted before it", src("lib/team/order-window-db.ts").includes("[i.assignment.responded_at, i.session.submitted_at]"));

// ===== 6. The finish: same record, nothing lost, Details are in once =====
const extrasBefore = JSON.stringify((db.sessions[0] as Record<string, unknown>).package_extras);
const saved = await upd.recordSubmission("u1", { client_name: "Justin Reyes", event_date: addDays(today, 10), event_address: "1 Main St, Dallas, TX 75201", package: "Full Bar", guest_count: 75, signature_drinks: [] });
const after = db.sessions.find((s) => s.id === "u1") as Record<string, unknown>;
check("Saved on the same row, now submitted with the client's answers", saved && after.status === "submitted" && (after.event_data as Record<string, unknown>).event_address === "1 Main St, Dallas, TX 75201" && db.sessions.length === 4);
check("The booking fills what the client left blank (start time, phone)", (after.event_data as Record<string, unknown>).bar_service_start === "6:00 PM" && (after.event_data as Record<string, unknown>).client_phone === "+19725550199");
check("Bartenders and barbacks needed are kept", JSON.stringify(after.package_extras) === extrasBefore);
check("Assignments and roles are kept", (db.event_assignments as Record<string, unknown>[]).length === 2 && (db.event_assignments as Record<string, unknown>[]).find((a) => a.staff_id === "b2")!.role === "bar_back");
check("Everyone assigned is queued once", (db.team_notices as { key: string }[]).filter((n) => n.key.startsWith("details_due:u1:")).length === 2);
check("Mileage is worked out for who accepted, now the address is in", (db.assignment_mileage as Record<string, unknown>[]).some((m) => m.staff_id === "b1" && m.locked_at));
// Deterministic delivery: quiet hours first, then daytime.
const night = time.zonedInstant(today, 23 * 60, "America/Chicago");
const morning = time.zonedInstant(addDays(today, 1), 9 * 60, "America/Chicago");
(db.team_notices as { key: string }[]).splice(0, db.team_notices.length, ...(db.team_notices as { key: string }[]).filter((n) => !n.key.startsWith("details_in:")));
texts.length = 0;
check("Held in quiet hours", (await pdb.deliverDetailsIn(night)) === 0 && texts.length === 0);
const n = await pdb.deliverDetailsIn(morning);
check("Sent at 8 AM or later: one each to Sam and Jo", n === 2 && textsTo(sam).length === 1 && textsTo(jo).length === 1);
check("The text: Details are in for [event], with the link, no change line", /^Details are in for Justin · Birthday\. https:\/\/plan\.test\/team\/e\/u1$/.test(textsTo(sam)[0]?.message ?? ""), textsTo(sam)[0]?.message);
check("Never twice", (await pdb.deliverDetailsIn(morning)) === 0 && texts.length === 2);
check("No red card when nothing changed", (await pdb.finishChangeFor(after as never)) === null);

// ===== 7. The date changed at finish =====
reset();
db.event_assignments = [{ id: "x1", session_id: "u1", staff_id: "b1", status: "accepted" }];
const before7 = { ...(db.sessions[0] as Record<string, unknown>) };
await upd.recordSubmission("u1", { client_name: "Justin Reyes", event_date: addDays(today, 12), bar_service_start: "7:00 PM", event_address: "1 Main St, Dallas, TX 75201" });
(db.team_notices as { key: string }[]).splice(0, db.team_notices.length, ...(db.team_notices as { key: string }[]).filter((x) => !x.key.startsWith("details_in:") && !x.key.startsWith("finish_change_sent:")));
texts.length = 0;
await pdb.deliverDetailsIn(morning);
const msg = textsTo(sam)[0]?.message ?? "";
check("Staff text names the new date and start time and asks them to confirm", msg.startsWith("Details are in for Justin · Birthday. The date changed to") && msg.includes("The start time changed to 7:00 PM.") && msg.includes("Please open the event and confirm you can still work it."), msg);
check("Admins and managers with alerts on are texted too", textsTo(admin).length === 1 && textsTo(admin)[0].message.includes("changed the date to") && textsTo(admin)[0].message.includes("Nobody was removed."));
check("Nobody is removed", (db.event_assignments as Record<string, unknown>[]).find((a) => a.staff_id === "b1")!.status === "accepted");
const fc = await pdb.finishChangeFor(db.sessions[0] as never);
check("The red card on the event: the new date and start time", !!fc?.date && fc?.start === "7:00 PM" && mgr.includes("data-finish-change"));
check("The booking's own columns are unchanged", (db.sessions[0] as Record<string, unknown>).event_date === before7.event_date);

// ===== 8. An event added by hand as confirmed is not an unfinished booking =====
check("Save as a confirmed event skips the finish step", src("lib/manual-event-db.ts").includes("recordSubmission(id, v.eventData, { addedByAdmin: true })"));
check("Save and send link says the event shows now", src("app/team/admin/events/new/add-event-form.tsx").includes("marked Planning not finished"));
check("The price check text links straight to the event", src("lib/booking-webhook.ts").includes(" Event page: ${link}`"));

// ===== 9. Nothing new to the client or GHL =====
check("The client side still waits for submitted", src("app/s/page.tsx").includes('data.status === "submitted" && data.event_data') && src("app/api/agreement/route.ts").includes('session.status !== "submitted"'));
check("No GHL intake from planning code", !/GHL_WEBHOOK_URL|createNoteByEmail/.test(src("lib/planning-db.ts") + src("lib/planning.ts") + src("lib/team/team-sessions.ts")));

done("planning events");
