// Time clock and cron jobs, run through the real code against an in-memory
// database (scripts/fake-supabase.mts) with fetch stubbed: geocoding, staff
// texts, and alerts are captured instead of sent.
// Run: node --no-warnings scripts/test-clock.mts

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase") return nextResolve(new URL("./fake-supabase.mts", import.meta.url).href, context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

process.env.GHL_STAFF_SMS_WEBHOOK = "https://hooks.test/staff-sms";
process.env.TEAM_BASE_URL = "https://plan.test";
delete process.env.GOOGLE_MAPS_API_KEY;

const VENUE = { lat: 32.7767, lng: -96.797 };
const texts: { phone: string; message: string }[] = [];
let geocodeCalls = 0;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("nominatim.openstreetmap.org")) {
    geocodeCalls++;
    const found = !url.includes("Nowhere");
    return new Response(JSON.stringify(found ? [{ lat: String(VENUE.lat), lon: String(VENUE.lng) }] : []), { status: 200 });
  }
  if (url === process.env.GHL_STAFF_SMS_WEBHOOK) {
    const b = JSON.parse(String(init?.body ?? "{}"));
    texts.push({ phone: b.phone, message: b.message });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const out = console.log;
console.log = () => {};
console.warn = () => {};

const { db } = await import("./fake-supabase.mts");
const clockDb = await import("../lib/team/clock-db.ts");
const asgDb = await import("../lib/team/assignments-db.ts");
const time = await import("../lib/team/time.ts");

let failed = 0;
let total = 0;
function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  out(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}

// Today's event in Chicago, service 6:00 PM to 10:00 PM: arrival 4:00 PM, clock in opens 3:30 PM.
const today = time.chicagoToday();
const at = (minutes: number) => time.chicagoInstant(today, minutes);

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const quietAdmin = { id: "a2", name: "Pat Jones", phone: "+12145550102", role: "admin" as const, active: true, alerts: false };
const bart = { id: "b1", name: "Jordan Lee", phone: "+12145550101", role: "bartender" as const, active: true };
const offeredBart = { id: "b2", name: "Sam Diaz", phone: "+12145550103", role: "bartender" as const, active: true };

function reset(address = "123 Elm St, Dallas, TX 75201") {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    {
      id: "s1",
      status: "submitted",
      version: 1,
      event_date: today,
      event_data: { client_name: "Justin Reyes", event_type: "Birthday", event_date: today, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: address, guest_count: 80, package: "Full Bar" },
    },
  ];
  db.staff = [admin, quietAdmin, bart, offeredBart];
  db.event_assignments = [
    { id: "as1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "as2", session_id: "s1", staff_id: "b2", status: "offered" },
  ];
  db.time_punches = [];
  db.bar_ready_reports = [];
  db.team_notices = [];
  db.team_hidden_events = [];
  texts.length = 0;
  geocodeCalls = 0;
}

const session = () => db.sessions[0] as never;
const near = { lat: 32.7777, lng: -96.797, accuracy: 12 };
const farAway = { lat: 32.8, lng: -96.797, accuracy: 12 };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Punches are checked against the real clock, so run them as if it is 5:00 PM today.
const realNow = Date.now;
const setNow = (d: Date) => (Date.now = () => d.getTime());
const RealDate = Date;
function freeze(d: Date) {
  setNow(d);
  globalThis.Date = class extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      if (args.length === 0) super(d.getTime());
      else super(...args);
    }
    static now() {
      return d.getTime();
    }
  } as DateConstructor;
}
function unfreeze() {
  globalThis.Date = RealDate;
  Date.now = realNow;
}

// ----- Clock in and out -----
reset();
freeze(at(15 * 60 + 20)); // 3:20 PM, before the window
const early = await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: near, clientTime: null, clientId: uuid(1) });
check("Clock in before 30 minutes before arrival is refused", !early.ok && early.status === 409 && /opens at 3:30 PM/.test(early.error), JSON.stringify(early));

freeze(at(17 * 60)); // 5:00 PM
const first = await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: near, clientTime: new Date().toISOString(), clientId: uuid(2) });
check("Clock in in the window saves", first.ok && db.time_punches.length === 1);
const p1 = db.time_punches[0] as Record<string, unknown>;
check("Close to the event is clean", Array.isArray(p1.flags) && (p1.flags as string[]).length === 0 && p1.distance_m === 111, JSON.stringify(p1));
check("The punch stores the server time, the phone time, and the location", !!p1.received_at && !!p1.client_time && p1.lat === near.lat && p1.accuracy === 12);
check("The punch is the staff member's own", p1.source === "phone" && p1.created_by === "b1" && p1.staff_id === "b1");
check("The event address is geocoded and stored on the session", geocodeCalls === 1 && (db.sessions[0] as Record<string, unknown>).geo_address === "123 Elm St, Dallas, TX 75201");

const again = await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: near, clientTime: null, clientId: uuid(3) });
check("A second clock in is refused", !again.ok && again.status === 409 && db.time_punches.length === 1);
const retry = await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: near, clientTime: null, clientId: uuid(2) });
check("A retried punch is saved once and answers as saved", retry.ok && retry.duplicate && db.time_punches.length === 1);

freeze(at(23 * 60));
const outP = await clockDb.recordPunch({ session: session(), staff: bart, type: "out", location: farAway, clientTime: null, clientId: uuid(4) });
check("Clock out saves", outP.ok && db.time_punches.length === 2);
const p2 = db.time_punches[1] as Record<string, unknown>;
check("Away from the event is recorded with a flag", (p2.flags as string[]).includes("far") && (p2.distance_m as number) > 2000);
check("The event is geocoded only once", geocodeCalls === 1);
check("Hours show on the clock", outP.ok && outP.view.workedMinutes === 6 * 60, JSON.stringify(outP.ok && outP.view));
const outAgain = await clockDb.recordPunch({ session: session(), staff: bart, type: "out", location: near, clientTime: null, clientId: uuid(5) });
check("A second clock out is refused", !outAgain.ok && db.time_punches.length === 2);

// ----- No location, offline, and who can punch -----
reset();
freeze(at(17 * 60));
const noLoc = await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: null, clientTime: null, clientId: uuid(6) });
check("No phone location is recorded with a flag", noLoc.ok && (db.time_punches[0] as Record<string, string[]>).flags.join() === "no_location");

reset();
freeze(at(17 * 60 + 40)); // the queued punch reaches us at 5:40 PM
const tapped = at(17 * 60 + 5).toISOString(); // tapped at 5:05 PM with no signal
const queued = await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: near, clientTime: tapped, clientId: uuid(7) });
const qp = db.time_punches[0] as Record<string, unknown>;
check("A queued punch keeps its tap time", queued.ok && new RealDate(String(qp.punched_at)).toISOString() === tapped);
check("A queued punch is flagged sent late", (qp.flags as string[]).includes("sent_late"));

reset();
freeze(at(17 * 60));
const offered = await clockDb.recordPunch({ session: session(), staff: offeredBart, type: "in", location: near, clientTime: null, clientId: uuid(8) });
check("Staff who have not accepted cannot clock in", !offered.ok && offered.status === 403);
const notAssigned = await clockDb.recordPunch({ session: session(), staff: admin, type: "in", location: near, clientTime: null, clientId: uuid(9) });
check("An admin with no assignment cannot clock in", !notAssigned.ok && notAssigned.status === 403);

reset("Nowhere Lane, Atlantis");
freeze(at(17 * 60));
await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: near, clientTime: null, clientId: uuid(10) });
check("An address not on the map is recorded with a flag", (db.time_punches[0] as Record<string, string[]>).flags.join() === "no_event_location");

// ----- Remove and decline after clocking in -----
reset();
freeze(at(17 * 60));
await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: near, clientTime: null, clientId: uuid(11) });
const removed = await asgDb.removeStaff(session(), "b1");
check("Staff who clocked in cannot be removed", !removed.ok && db.event_assignments.length === 2);
const declined = await asgDb.respondToAssignment("s1", bart, "decline", "https://plan.test");
check("Staff who clocked in cannot decline", !declined.ok && (db.event_assignments[0] as Record<string, string>).status === "accepted");

// ----- Cron: clock out reminder -----
reset();
freeze(at(17 * 60));
await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: near, clientTime: null, clientId: uuid(12) });
texts.length = 0;
check("No reminder before end plus breakdown plus 30 minutes", (await clockDb.sendClockOutReminders(at(23 * 60 + 29))) === 0 && texts.length === 0);
const sentR = await clockDb.sendClockOutReminders(at(23 * 60 + 30));
check("One reminder to the person still clocked in", sentR === 1 && texts.length === 1 && texts[0].phone === bart.phone && texts[0].message.includes("still clocked in") && texts[0].message.includes("https://plan.test/team/e/s1"), JSON.stringify(texts));
check("The reminder is sent only once", (await clockDb.sendClockOutReminders(at(23 * 60 + 45))) === 0 && texts.length === 1);
reset();
freeze(at(17 * 60));
await clockDb.recordPunch({ session: session(), staff: bart, type: "in", location: near, clientTime: null, clientId: uuid(13) });
freeze(at(23 * 60));
await clockDb.recordPunch({ session: session(), staff: bart, type: "out", location: near, clientTime: null, clientId: uuid(14) });
texts.length = 0;
check("No reminder after clocking out", (await clockDb.sendClockOutReminders(at(23 * 60 + 40))) === 0 && texts.length === 0);

// ----- Cron: late setup alert -----
reset();
unfreeze();
check("No late setup alert before 30 minutes ahead", (await clockDb.sendLateSetupAlerts(at(17 * 60 + 29))) === 0 && texts.length === 0);
const ls = await clockDb.sendLateSetupAlerts(at(17 * 60 + 30));
check("Late setup alert texts admins with alerts on", ls === 1 && texts.length === 1 && texts[0].phone === admin.phone, JSON.stringify(texts));
check(
  "Late setup alert wording and admin link",
  texts[0]?.message === "No bar ready check in yet for Justin · Birthday, service starts at 6:00 PM. https://plan.test/team/admin/e/s1",
  texts[0]?.message,
);
check("Admins with alerts off are not texted", !texts.some((t) => t.phone === quietAdmin.phone));
check("The late setup alert is sent once per event", (await clockDb.sendLateSetupAlerts(at(17 * 60 + 45))) === 0 && texts.length === 1);
reset();
db.bar_ready_reports = [{ session_id: "s1", staff_id: "b1", created_at: at(17 * 60 + 10).toISOString() }];
check("No late setup alert when the bar ready check in is in", (await clockDb.sendLateSetupAlerts(at(17 * 60 + 35))) === 0 && texts.length === 0);
reset();
db.event_assignments = [{ id: "as1", session_id: "s1", staff_id: "b1", status: "declined" }];
check("No late setup alert without assigned staff", (await clockDb.sendLateSetupAlerts(at(17 * 60 + 35))) === 0);
reset();
db.team_hidden_events = [{ session_id: "s1" }];
check("No late setup alert for hidden events", (await clockDb.sendLateSetupAlerts(at(17 * 60 + 35))) === 0);

unfreeze();
console.log = out;
if (failed > 0) {
  console.error(`\n${failed} of ${total} clock checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} clock checks pass.`);
