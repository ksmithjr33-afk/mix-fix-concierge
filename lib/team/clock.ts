// Time clock rules: when clock in opens, location flags, one in and one out per
// assignment, offline punches, hours, the cron reminders, and the rule that
// nobody edits or approves their own time. Pure, no database.

import { chicagoInstant, eventSchedule, formatClock } from "@/lib/team/time";

export const CLOCK_IN_LEAD_MIN = 30; // clock in opens 30 minutes before arrival
export const SITE_RADIUS_M = 300; // within 300 m of the event is clean
export const LATE_SEND_MS = 2 * 60 * 1000; // a punch that reaches us 2+ minutes after the tap was sent late
export const BREAKDOWN_MIN = 60; // an hour of breakdown after service ends
export const CLOCK_OUT_GRACE_MIN = 30; // then 30 more minutes before the reminder
export const LATE_SETUP_LEAD_MIN = 30; // bar ready check in expected 30 minutes before service
export const LATE_SETUP_WINDOW_MIN = 120; // stop looking 2 hours after service starts, so old events never alert

export type PunchType = "in" | "out";

export type PunchFlag =
  | "no_location" // the phone gave no location
  | "far" // more than 300 m from the event
  | "no_event_location" // the event address could not be found on a map
  | "sent_late" // queued on the phone and sent later
  | "admin_entry"; // added or corrected by an admin (phase 4)

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PhoneLocation extends LatLng {
  accuracy: number | null; // meters
}

/** Great circle distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A location from the phone, or null when it is missing or not a real coordinate. */
export function cleanLocation(raw: unknown): PhoneLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (r.lat === null || r.lng === null || r.lat === undefined || r.lng === undefined) return null;
  const acc = Number(r.accuracy);
  return { lat, lng, accuracy: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null };
}

/** When clock in opens: 30 minutes before arrival, or the start of the event day when there is no start time. */
export function clockInOpensAt(ed: Record<string, unknown>): Date | null {
  const s = eventSchedule(ed);
  if (s.arrival) return new Date(s.arrival.getTime() - CLOCK_IN_LEAD_MIN * 60_000);
  return s.day ? chicagoInstant(s.day, 0) : null;
}

/** The time a punch counts for: the tap time when it was queued on the phone, otherwise when we received it. */
export function punchTime(clientTime: unknown, receivedAt: Date): { punchedAt: Date; late: boolean } {
  const t = typeof clientTime === "string" || typeof clientTime === "number" ? new Date(clientTime) : null;
  if (!t || isNaN(t.getTime())) return { punchedAt: receivedAt, late: false };
  // A phone clock ahead of ours never puts a punch in the future.
  if (t.getTime() > receivedAt.getTime()) return { punchedAt: receivedAt, late: false };
  const late = receivedAt.getTime() - t.getTime() >= LATE_SEND_MS;
  return { punchedAt: late ? t : receivedAt, late };
}

/** Flags and distance for a punch. Every punch is recorded; flags tell the admin what to look at. */
export function punchFlags(opts: {
  phone: PhoneLocation | null;
  event: LatLng | null;
  late: boolean;
}): { flags: PunchFlag[]; distance: number | null } {
  const flags: PunchFlag[] = [];
  let distance: number | null = null;
  if (!opts.phone) flags.push("no_location");
  if (!opts.event) flags.push("no_event_location");
  if (opts.phone && opts.event) {
    distance = Math.round(distanceMeters(opts.phone, opts.event));
    if (distance > SITE_RADIUS_M) flags.push("far");
  }
  if (opts.late) flags.push("sent_late");
  return { flags, distance };
}

export const FLAG_LABELS: Record<PunchFlag, string> = {
  no_location: "No location",
  far: "Away from the event",
  no_event_location: "Event address not on the map",
  sent_late: "Sent late",
  admin_entry: "Entered by an admin",
};

export interface PunchLike {
  type: PunchType;
  punched_at: string;
}

export type PunchCheck = { ok: true } | { ok: false; error: string };

/**
 * One clock in and one clock out per assignment. No double punches, no clock
 * out before clock in, no clock in before the window opens, and the out never
 * before the in.
 */
export function checkPunch(type: PunchType, existing: PunchLike[], at: Date, opensAt: Date | null): PunchCheck {
  const hasIn = existing.find((p) => p.type === "in");
  const hasOut = existing.some((p) => p.type === "out");
  if (type === "in") {
    if (hasIn) return { ok: false, error: "You already clocked in for this event." };
    if (opensAt && at.getTime() < opensAt.getTime()) return { ok: false, error: `Clock in opens at ${formatInstant(opensAt)}.` };
    return { ok: true };
  }
  if (!hasIn) return { ok: false, error: "Clock in first." };
  if (hasOut) return { ok: false, error: "You already clocked out for this event." };
  if (at.getTime() < new Date(hasIn.punched_at).getTime()) return { ok: false, error: "Clock out cannot be before clock in." };
  return { ok: true };
}

/** Minutes between clock in and clock out, to the minute. Instants, so a shift past midnight just works. */
export function workedMinutes(inAt: string | Date, outAt: string | Date): number {
  const ms = new Date(outAt).getTime() - new Date(inAt).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

/** 330 as "5h 30m". */
export function formatWorked(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function formatInstant(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })
    .format(d)
    .replace(/[  ]/g, " ");
}

/** The clock out reminder goes out 30 minutes after service end plus an hour of breakdown. */
export function clockOutReminderAt(ed: Record<string, unknown>): Date | null {
  const s = eventSchedule(ed);
  return s.end ? new Date(s.end.getTime() + (BREAKDOWN_MIN + CLOCK_OUT_GRACE_MIN) * 60_000) : null;
}

export function clockOutReminderDue(ed: Record<string, unknown>, now: Date): boolean {
  const at = clockOutReminderAt(ed);
  return !!at && now.getTime() >= at.getTime();
}

/**
 * The late setup alert: from 30 minutes before service starts, while nobody has
 * sent a bar ready check in. Stops 2 hours after the start so events from
 * before the cron ran never alert.
 */
export function lateSetupDue(ed: Record<string, unknown>, now: Date, o: { hasStaff: boolean; hasBarReady: boolean }): boolean {
  if (!o.hasStaff || o.hasBarReady) return false;
  const s = eventSchedule(ed);
  if (!s.start) return false;
  const from = s.start.getTime() - LATE_SETUP_LEAD_MIN * 60_000;
  const until = s.start.getTime() + LATE_SETUP_WINDOW_MIN * 60_000;
  return now.getTime() >= from && now.getTime() < until;
}

export function clockOutReminderText(o: { firstName: string; title: string; link: string }): string {
  return `Hi ${o.firstName || "there"}, you are still clocked in for ${o.title}. Clock out here when you are done: ${o.link}`;
}

export function lateSetupText(o: { title: string; startTime: string; link: string }): string {
  return `No bar ready check in yet for ${o.title}, service starts at ${o.startTime}. ${o.link}`;
}

export function serviceStartLabel(ed: Record<string, unknown>): string {
  const s = eventSchedule(ed);
  return s.startMin === null ? "the scheduled time" : formatClock(s.startMin);
}

/**
 * Nobody edits or approves their own time, admins included. The database
 * enforces the same rule with check constraints on time_edits and
 * time_approvals; this is the check the app runs first.
 */
export function canChangeTime(actorId: string, punchStaffId: string): boolean {
  return !!actorId && actorId !== punchStaffId;
}

/** Keys for once only notices, so each reminder or alert is sent a single time. */
export const noticeKey = {
  clockOut: (assignmentId: string) => `clock_out:${assignmentId}`,
  lateSetup: (sessionId: string) => `late_setup:${sessionId}`,
};
