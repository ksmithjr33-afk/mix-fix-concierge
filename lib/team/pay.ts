// Pay: estimates from an hourly rate. Pure, no database.
//
// Estimated pay = hourly rate × (arrival to service end + 1 hour of breakdown).
// Visible only to admins and to the staff member it belongs to. No rate, no pay.
// Payroll is the final record; everything here is labeled as an estimate.

import { BREAKDOWN_MIN } from "@/lib/team/clock";
import { eventSchedule } from "@/lib/team/time";

export const PAY_LABEL = "Estimated pay, before taxes and tips";
export const PAY_NOTE = "These are estimates, before taxes and tips. Payroll is the final record.";
export const MAX_RATE_CENTS = 200_00;

/** Arrival to service end plus an hour of breakdown, in minutes. Null without the times. */
export function scheduledMinutes(ed: Record<string, unknown>): number | null {
  const s = eventSchedule(ed);
  if (s.arrivalMin === null || s.endMin === null) return null;
  const m = s.endMin - s.arrivalMin + BREAKDOWN_MIN;
  return m > 0 ? m : null;
}

export function payCents(rateCents: number | null | undefined, minutes: number | null | undefined): number | null {
  if (!rateCents || rateCents <= 0 || minutes === null || minutes === undefined || minutes <= 0) return null;
  return Math.round((rateCents * minutes) / 60);
}

export function estimatedPayCents(rateCents: number | null | undefined, ed: Record<string, unknown>): number | null {
  return payCents(rateCents, scheduledMinutes(ed));
}

/** "$1,234.50" */
export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "5.50" hours. */
export function hoursText(minutes: number | null): string {
  return minutes === null ? "" : (minutes / 60).toFixed(2);
}

/** "$25.00/hr" */
export function rateText(cents: number | null): string {
  return cents ? `${money(cents)}/hr` : "";
}

/** A rate typed by an admin, in dollars. Blank clears it. */
export function validateRate(raw: unknown): { ok: true; cents: number | null } | { ok: false; error: string } {
  const s = String(raw ?? "").trim().replace(/^\$/, "");
  if (!s) return { ok: true, cents: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { ok: false, error: "Enter the hourly rate in dollars, like 25 or 27.50." };
  const cents = Math.round(Number(s) * 100);
  if (cents <= 0 || cents > MAX_RATE_CENTS) return { ok: false, error: "Enter a rate between $0.01 and $200 an hour." };
  return { ok: true, cents };
}

export interface PayRow {
  sessionId: string;
  day: string | null;
  title: string;
  scheduledMinutes: number | null;
  approvedMinutes: number | null; // clocked hours once an admin approved them
  payCents: number | null; // from approved hours, else the scheduled estimate
  fromApproved: boolean;
}

/** Monday of the week, YYYY-MM-DD. */
export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Totals by week (Monday) and by month (YYYY-MM). */
export function payTotals(rows: PayRow[]): { weeks: { week: string; cents: number; rows: number }[]; months: { month: string; cents: number; rows: number }[] } {
  const weeks = new Map<string, { cents: number; rows: number }>();
  const months = new Map<string, { cents: number; rows: number }>();
  const bump = (map: Map<string, { cents: number; rows: number }>, key: string, cents: number) => {
    const t = map.get(key) ?? { cents: 0, rows: 0 };
    t.cents += cents;
    t.rows += 1;
    map.set(key, t);
  };
  for (const r of rows) {
    if (!r.day) continue;
    bump(weeks, mondayOf(r.day), r.payCents ?? 0);
    bump(months, r.day.slice(0, 7), r.payCents ?? 0);
  }
  return {
    weeks: [...weeks].sort((a, b) => a[0].localeCompare(b[0])).map(([week, t]) => ({ week, ...t })),
    months: [...months].sort((a, b) => a[0].localeCompare(b[0])).map(([month, t]) => ({ month, ...t })),
  };
}
