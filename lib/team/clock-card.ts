// The Time clock card at the top of the manager view's Details tab: every
// person on the event with their role, a clear state, each clock in and out
// with its date in the event's time zone, who edited or approved it, and hours
// worked. Built from the same TimesheetRow the Time page and the payroll CSV
// use: minutes come from row.minutes (rowMinutes), the decimal from csvHours,
// and the combined total adds row minutes the way staffTotals does. Nothing
// here works out hours a second way. Pure, no database.

import { csvHours, type EditSummary, type TimesheetRow } from "@/lib/team/timesheet";
import { roleLabel } from "@/lib/team/roles";
import { TZ } from "@/lib/team/time";

export type ClockState = "not_in" | "in" | "out";

export interface ClockPair {
  assignmentId: string;
  inAt: string | null;
  outAt: string | null;
  minutes: number | null; // row.minutes: null until both punches exist
  inEditedBy: string | null; // the admin who last added or corrected the clock in
  outEditedBy: string | null;
  approvedBy: string | null;
}

export interface ClockPerson {
  staffId: string;
  name: string;
  role: string; // "Bartender", "Bar back"
  state: ClockState;
  stateText: string; // "Not clocked in", "Clocked in since Nov 11, 4:32 PM", "Clocked out"
  pairs: ClockPair[];
  totalMinutes: number | null; // every complete pair added up, null when none is complete
  open: number; // pairs missing a clock out
}

/** "Nov 11, 4:32 PM" in the event's time zone, always with the date. */
export function dateTimeLabel(iso: string | null | undefined, tz: string = TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(d)
    .replace(/[  ]/g, " ");
}

/** 342 as "5 h 42 m · 5.70": to the minute, then decimal hours exactly as the payroll CSV writes them. */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${m} m · ${csvHours(minutes)}`;
}

function lastEditor(edits: EditSummary[], type: "in" | "out"): string | null {
  const mine = edits.filter((e) => e.type === type);
  return mine.length ? mine[mine.length - 1].byName : null;
}

export function pairOf(row: TimesheetRow): ClockPair {
  return {
    assignmentId: row.assignmentId,
    inAt: row.clockIn?.at ?? null,
    outAt: row.clockOut?.at ?? null,
    minutes: row.minutes,
    inEditedBy: lastEditor(row.edits, "in"),
    outEditedBy: lastEditor(row.edits, "out"),
    approvedBy: row.approved?.byName ?? null,
  };
}

/**
 * One entry per person on the event (declined people left out), in the order
 * given, each with their timesheet rows for this event as in and out pairs.
 */
export function clockPeople(
  people: { staffId: string; name: string; role: string; status: string }[],
  rows: TimesheetRow[],
  tz: string = TZ
): ClockPerson[] {
  return people
    .filter((p) => p.status !== "declined")
    .map((p) => {
      const pairs = rows
        .filter((r) => r.staffId === p.staffId)
        .map(pairOf)
        .sort((a, b) => String(a.inAt ?? a.outAt ?? "").localeCompare(String(b.inAt ?? b.outAt ?? "")));
      const openPair = pairs.find((x) => x.inAt && !x.outAt);
      const state: ClockState = openPair ? "in" : pairs.some((x) => x.outAt) ? "out" : "not_in";
      const complete = pairs.filter((x) => x.minutes !== null);
      return {
        staffId: p.staffId,
        name: p.name,
        role: roleLabel(p.role),
        state,
        stateText: state === "in" ? `Clocked in since ${dateTimeLabel(openPair!.inAt, tz)}` : state === "out" ? "Clocked out" : "Not clocked in",
        pairs,
        totalMinutes: complete.length ? complete.reduce((n, x) => n + (x.minutes ?? 0), 0) : null,
        open: pairs.filter((x) => !x.outAt).length,
      };
    });
}

function punchText(label: "In" | "Out", at: string | null, editedBy: string | null, tz: string): string {
  if (!at) return `${label} missing`;
  return `${label} ${dateTimeLabel(at, tz)}${editedBy ? ` (edited by ${editedBy})` : ""}`;
}

/** One pair as a line: "In Nov 11, 4:32 PM · Out Nov 11, 10:14 PM (edited by Isabel) · 5 h 42 m · 5.70". */
export function pairText(pair: ClockPair, tz: string = TZ): string {
  return [
    punchText("In", pair.inAt, pair.inEditedBy, tz),
    pair.inAt && !pair.outAt ? "Still clocked in" : punchText("Out", pair.outAt, pair.outEditedBy, tz),
    pair.minutes !== null ? hoursLabel(pair.minutes) : "",
    pair.approvedBy ? `approved by ${pair.approvedBy}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The total line for a person, or "" when nothing is complete yet. */
export function totalText(p: ClockPerson): string {
  if (p.totalMinutes === null) return "";
  return `${p.pairs.length > 1 ? "Total" : "Hours"} ${hoursLabel(p.totalMinutes)}${p.open ? ` (${p.open} without a clock out)` : ""}`;
}

/** "Copy times": plain text, one block per person. */
export function clockCopyText(title: string, people: ClockPerson[], tz: string = TZ): string {
  const lines = [`${title} · times in ${tz === "America/Los_Angeles" ? "Pacific" : "Central"} time`];
  for (const p of people) {
    lines.push("");
    lines.push(`${p.name} (${p.role}): ${p.stateText}`);
    if (p.pairs.length === 1) lines.push(pairText(p.pairs[0], tz));
    else p.pairs.forEach((x, i) => lines.push(`${i + 1}. ${pairText(x, tz)}`));
    const t = totalText(p);
    if (t && p.pairs.length > 1) lines.push(t);
  }
  return lines.join("\n");
}

/** The Time page for the week of this event, showing just this event. */
export function timePageHref(sessionId: string, eventDay: string | null): string {
  const q = new URLSearchParams();
  if (eventDay) q.set("week", eventDay);
  q.set("event", sessionId);
  return `/team/admin/timesheets?${q.toString()}`;
}
