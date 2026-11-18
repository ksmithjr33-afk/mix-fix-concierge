// Surprise events. Pure, no database, so the tests can check them.
//
// A surprise event has a guest of honor who can never be contacted or given
// access while the block is on: from when it is set until 30 days after the
// event date (it lifts on day 31). Every column is missing before
// supabase/migrations/20261226_surprise_events.sql runs, which reads as not a
// surprise, so every existing event is unchanged.

import { normalizePhone } from "@/lib/team/codes";
import { eventDay, todayIn, TZ } from "@/lib/team/time";

export const SURPRISE_LIFT_DAYS = 30;

export type PlanningRole = "guest_of_honor" | "someone_else" | "planner";
export const PLANNING_ROLES: PlanningRole[] = ["guest_of_honor", "someone_else", "planner"];

export interface SurpriseColumns {
  is_surprise?: boolean | null;
  honoree_name?: string | null;
  honoree_phone?: string | null;
  honoree_email?: string | null;
  surprise_set_by?: string | null;
  surprise_set_at?: string | null;
  planning_role?: string | null;
}

export interface Surprise {
  on: boolean; // is_surprise, whatever the date
  name: string;
  firstName: string;
  phone: string;
  email: string;
  setBy: string;
  setAt: string | null;
  answered: boolean; // the surprise question was answered (or an admin set it)
}

const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function surpriseOf(s: SurpriseColumns): Surprise {
  const name = str(s.honoree_name);
  return {
    on: s.is_surprise === true,
    name,
    firstName: name.split(" ")[0] ?? "",
    phone: normalizePhone(s.honoree_phone) ?? "",
    email: str(s.honoree_email).toLowerCase(),
    setBy: str(s.surprise_set_by),
    setAt: s.surprise_set_at ?? null,
    answered: s.is_surprise === true || !!s.surprise_set_at,
  };
}

export function planningRoleOf(s: SurpriseColumns): PlanningRole | null {
  return (PLANNING_ROLES as string[]).includes(String(s.planning_role)) ? (s.planning_role as PlanningRole) : null;
}

function plusDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The last day the block is in force (YYYY-MM-DD): 30 days after the event date. Null with no date. */
export function surpriseLastDay(s: { event_date?: string | null; event_data?: Record<string, unknown> | null }): string | null {
  const day = eventDay(s.event_data?.event_date ?? s.event_date ?? null);
  return day ? plusDays(day, SURPRISE_LIFT_DAYS) : null;
}

/**
 * True while the guest of honor must not be contacted: a surprise event, until
 * 30 days after the event date. With no date yet it stays in force.
 */
export function surpriseActive(
  s: SurpriseColumns & { event_date?: string | null; event_data?: Record<string, unknown> | null },
  now: Date = new Date(),
  tz: string = TZ
): boolean {
  if (s.is_surprise !== true) return false;
  const last = surpriseLastDay(s);
  return !last || todayIn(tz, now) <= last;
}

/** True when this phone or email is the guest of honor's. */
export function isHonoree(s: SurpriseColumns, o: { phone?: unknown; email?: unknown }): boolean {
  const h = surpriseOf(s);
  const phone = normalizePhone(o.phone);
  const email = str(o.email).toLowerCase();
  return (!!h.phone && !!phone && phone === h.phone) || (!!h.email && !!email && email === h.email);
}

/** The plain message when someone tries to save the guest of honor's phone or email somewhere it would reach them. */
export function honoreeRefusal(where: "client phone" | "day of contact" | "planner" | "host login"): string {
  const what =
    where === "client phone"
      ? "the client phone"
      : where === "day of contact"
        ? "the day of contact"
        : where === "planner"
          ? "a planner"
          : "a host login";
  return `That is the guest of honor's contact. This is a surprise event, so we never contact them, and it cannot be saved as ${what}. Use a different number.`;
}

export const HOST_SURPRISE_REFUSAL = "This is a surprise event, so the host cannot be given a login until after the event.";
export const PLANNER_SURPRISE_REFUSAL = "This is a surprise event, and that is the person the event is for, so they cannot be added as a planner.";

/** The staff banner. First name only. */
export function surpriseBanner(firstName: string): string {
  return `Surprise event. Do not contact ${firstName || "the guest of honor"} or mention the bar to them.`;
}

export const SURPRISE_LABEL = "Surprise event";
