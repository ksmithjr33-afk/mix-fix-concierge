// Part 5: reliability record.
// Run: node --no-warnings scripts/test-reliability.mts

import { addDays, check, done, event, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const rel = await import("../lib/team/reliability.ts");
const relDb = await import("../lib/team/reliability-db.ts");
const asgDb = await import("../lib/team/assignments-db.ts");

const CT = "America/Chicago";
const today = time.todayIn(CT);
const NOW = time.zonedInstant(today, 12 * 60, CT);
const H = 3_600_000;

// ----- The math -----
const ev = (daysAgo: number, o: { late?: boolean; noClock?: boolean; barLate?: boolean; noBar?: boolean; closeout?: boolean } = {}) => {
  const start = new Date(NOW.getTime() - daysAgo * 24 * H);
  const arrival = new Date(start.getTime() - 2 * H);
  return {
    sessionId: `s${daysAgo}`,
    start,
    arrival,
    end: new Date(start.getTime() + 4 * H),
    clockIn: o.noClock ? null : new Date(arrival.getTime() + (o.late ? 10 * 60_000 : -5 * 60_000)),
    barReadyAt: o.noBar ? null : new Date(start.getTime() + (o.barLate ? 5 * 60_000 : -20 * 60_000)),
    closeout: o.closeout ?? true,
  };
};
const facts = {
  events: [ev(5), ev(10, { late: true }), ev(20, { barLate: true }), ev(30, { closeout: false }), ev(120, { noClock: true, noBar: true }), ev(200)],
  drops: [new Date(NOW.getTime() - 15 * 24 * H), new Date(NOW.getTime() - 150 * 24 * H)],
  handoffs: [{ at: new Date(NOW.getTime() - 3 * 24 * H), urgent: true }, { at: new Date(NOW.getTime() - 100 * 24 * H), urgent: false }],
  flaggedPunches: [new Date(NOW.getTime() - 10 * 24 * H)],
};
const r90 = rel.computeRecord(facts, rel.since90(NOW));
const all = rel.computeRecord(facts, null);
check("Events worked in 90 days and all time", r90.eventsWorked === 4 && all.eventsWorked === 6);
check("Clocked in at or before arrival counts as on time", r90.onTime === 3 && all.onTime === 4);
check("Clocking in exactly at arrival is on time", rel.computeRecord({ ...rel.emptyFacts(), events: [{ ...ev(1), clockIn: ev(1).arrival }] }, null).onTime === 1);
check("No clock in is not on time", rel.computeRecord({ ...rel.emptyFacts(), events: [ev(1, { noClock: true })] }, null).onTime === 0);
check("Bar ready only counts before service start", r90.barReadyOnTime === 3 && all.barReadyOnTime === 4);
check("Closeouts sent", r90.closeouts === 3 && all.closeouts === 5);
check("Late drops by window", r90.lateDrops === 1 && all.lateDrops === 2);
check("Handoffs and urgent ones", r90.handoffs === 1 && r90.urgentHandoffs === 1 && all.handoffs === 2 && all.urgentHandoffs === 1);
check("Location flags", r90.locationFlags === 1 && all.locationFlags === 1);
check("Percentages round", rel.pct(11, 12) === 92 && rel.pct(0, 0) === null && rel.pct(2, 3) === 67);
const twelve = { ...rel.emptyFacts(), events: Array.from({ length: 12 }, (_, i) => ev(i + 1, { late: i === 0 })), drops: [new Date(NOW.getTime() - 24 * H)] };
check("The compact line reads like the example", rel.compactLine(rel.computeRecord(twelve, null)) === "12 events · 92% on time · 1 late drop", rel.compactLine(rel.computeRecord(twelve, null)));
const two = rel.computeRecord({ ...rel.emptyFacts(), events: [ev(1), ev(2, { late: true })] }, null);
check("Fewer than 3 events shows New", two.isNew && rel.compactLine(two) === "New");
check("New has no percentages anywhere", !rel.compactLine(two).includes("%") && rel.recordRows(two).every((r) => !r.value.includes("%")));
check("Three events is no longer new", !rel.computeRecord({ ...rel.emptyFacts(), events: [ev(1), ev(2), ev(3)] }, null).isNew);
check("The full record shows percentages once not new", rel.recordRows(all).find((r) => r.label === "Clocked in on time")?.value === "4 (67%)");
check("Nothing at all is New", rel.compactLine(rel.computeRecord(rel.emptyFacts(), null)) === "New");

// ----- From the database -----
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const past = (id: string, daysAgo: number) => event(id, addDays(today, -daysAgo), "1 Elm St, Dallas, TX", { event_name: id }, { team_market: "dallas" });
const at = (day: string, min: number) => time.zonedInstant(day, min, CT).toISOString();
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [past("p1", 3), past("p2", 10), past("p3", 40), past("hid", 5), event("fut", addDays(today, 7), "1 Elm St, Dallas, TX", {}, { team_market: "dallas" })];
  db.staff = [admin, b1, b2].map((s) => ({ ...s, markets: ["dallas"] }));
  db.event_assignments = [
    { id: "x1", session_id: "p1", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "p2", staff_id: "b1", status: "accepted" },
    { id: "x3", session_id: "p3", staff_id: "b1", status: "accepted" },
    { id: "x4", session_id: "hid", staff_id: "b1", status: "accepted" },
    { id: "x5", session_id: "fut", staff_id: "b1", status: "accepted" },
    { id: "x6", session_id: "p1", staff_id: "b2", status: "declined", dropped_at: at(addDays(today, -4), 600) },
  ];
  db.team_hidden_events = [{ session_id: "hid" }];
  const d = (n: number) => addDays(today, -n);
  db.time_punches = [
    { staff_id: "b1", session_id: "p1", type: "in", punched_at: at(d(3), 15 * 60 + 55), flags: [] }, // arrival 4:00 PM: on time
    { staff_id: "b1", session_id: "p2", type: "in", punched_at: at(d(10), 16 * 60 + 20), flags: ["far"] }, // late, flagged
    { staff_id: "b1", session_id: "p3", type: "in", punched_at: at(d(40), 16 * 60), flags: ["sent_late"] }, // on the minute; not a location flag
  ];
  db.bar_ready_reports = [
    { staff_id: "b1", session_id: "p1", created_at: at(d(3), 17 * 60 + 30) },
    { staff_id: "b1", session_id: "p2", created_at: at(d(10), 18 * 60 + 15) },
  ];
  db.event_closeouts = [{ staff_id: "b1", session_id: "p1" }, { staff_id: "b1", session_id: "p3" }];
  db.shift_handoffs = [{ from_staff_id: "b1", created_at: at(d(20), 600), urgent: true }];
  db.team_notices = [];
}
reset();
const recs = await relDb.staffRecords(["b1", "b2"], NOW);
const b1r = recs.get("b1")!;
check("Hidden and future events are not counted as worked", b1r.allTime.eventsWorked === 3, JSON.stringify(b1r.allTime));
check("On time from punches", b1r.allTime.onTime === 2);
check("Bar ready before service start", b1r.allTime.barReadyOnTime === 1);
check("Closeouts from the closeout table", b1r.allTime.closeouts === 2);
check("Only location flags count", b1r.allTime.locationFlags === 1);
check("Handoffs from the handoff table", b1r.allTime.handoffs === 1 && b1r.allTime.urgentHandoffs === 1);
check("A late drop is counted for the person who dropped", recs.get("b2")!.allTime.lateDrops === 1 && recs.get("b2")!.allTime.eventsWorked === 0);
const lines = await relDb.compactLines(["b1", "b2"], NOW);
check("Compact lines for admin lists", lines.b1 === "3 events · 67% on time · 1 urgent handoff" && lines.b2 === "New · 1 late drop", JSON.stringify(lines));

// Declining an accepted shift records the drop; declining an offer does not.
reset();
db.sessions.push(event("up1", addDays(today, 14), "1 Elm St, Dallas, TX", {}, { team_market: "dallas" }));
db.event_assignments.push({ id: "y1", session_id: "up1", staff_id: "b1", status: "accepted" }, { id: "y2", session_id: "up1", staff_id: "b2", status: "offered" });
db.shift_handoffs = [];
await asgDb.respondToAssignment("up1", b1, "decline", "https://team.test");
await asgDb.respondToAssignment("up1", b2, "decline", "https://team.test");
check("Declining after accepting is a late drop", !!db.event_assignments.find((a) => a.id === "y1")?.dropped_at);
check("Declining an offer is not", !db.event_assignments.find((a) => a.id === "y2")?.dropped_at);

// ----- Wiring and privacy -----
check("The assign dropdown shows the line", src("app/team/admin/e/[id]/assign-panel.tsx").includes("s.record") && src("app/team/admin/e/[id]/page.tsx").includes("record: records[s.id]"));
check("Shift requests show the line", src("app/team/admin/e/[id]/shift-panel.tsx").includes("records[r.staffId]"));
check("Handoff approvals show the line", src("app/team/admin/e/[id]/shift-panel.tsx").includes("records[h.fromStaffId]") && src("app/team/admin/e/[id]/shift-panel.tsx").includes("records[h.teammateStaffId]"));
check("The staff page shows the full record", src("app/team/admin/staff/[id]/page.tsx").includes("<RecordCard") && src("app/team/admin/staff/page.tsx").includes("compactLines"));
const mine = src("app/team/record/page.tsx");
check("My record only ever loads the signed in person", mine.includes("staffRecord(staff.id)") && !/params|searchParams/.test(mine));
check("My record is linked from Me", src("app/team/me/page.tsx").includes('"/team/record"'));
check("Records are admin pages otherwise", src("app/team/admin/staff/[id]/page.tsx").includes("requireAdmin") && src("app/team/admin/e/[id]/page.tsx").includes("requireAdmin"));

done("reliability");
