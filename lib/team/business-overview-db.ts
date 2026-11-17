// Business overview from the database. Server only. Admins only (role admin,
// never managers): every function returns nothing for anyone else.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { isFullAdmin } from "@/lib/team/roles";
import { eventData, marketLabel, sessionMarket } from "@/lib/team/markets";
import { eventSchedule } from "@/lib/team/time";
import { adminEventTitle } from "@/lib/team/event-list";
import { hiddenEventIds } from "@/lib/team/hidden";
import { isCalendarOnly } from "@/lib/calendar-only";
import { eventBusinessFor } from "@/lib/team/business-db";
import { addDays } from "@/lib/team/business";
import type { OverviewEvent } from "@/lib/team/business-overview";

/** Submitted, not hidden, not calendar only, with an event day from..to. */
async function sessionsBetween(from: string, to: string): Promise<SessionRow[]> {
  const [{ data }, hidden] = await Promise.all([supabase.from("sessions").select("*").eq("status", "submitted"), hiddenEventIds()]);
  return ((data as SessionRow[]) ?? []).filter((s) => {
    if (hidden.has(s.id) || isCalendarOnly(s as { calendar_only?: boolean | null })) return false;
    const day = eventSchedule(eventData(s)).day;
    return !!day && day >= from && day <= to;
  });
}

/** Run with a few at a time, so a long range does not open hundreds of queries at once. */
async function inBatches<T, R>(items: T[], size: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(f))));
  return out;
}

async function toOverview(admin: StaffMember, s: SessionRow, now: Date): Promise<OverviewEvent | null> {
  const view = await eventBusinessFor(admin, s, now);
  if (!view) return null;
  const ed = eventData(s);
  return {
    sessionId: s.id,
    title: adminEventTitle(ed),
    day: eventSchedule(ed).day,
    package: String(ed.package ?? (s as { package_type?: string | null }).package_type ?? "").trim() || "Not set",
    market: marketLabel(sessionMarket(s)),
    leadSource: null, // not stored anywhere today
    business: view.business,
    payrollCents: view.payrollCents,
  };
}

export async function overviewEvents(admin: StaffMember, from: string, to: string, now: Date = new Date()): Promise<OverviewEvent[]> {
  if (!isFullAdmin(admin.role)) return [];
  const sessions = await sessionsBetween(from, to);
  return (await inBatches(sessions, 6, (s) => toOverview(admin, s, now))).filter((e): e is OverviewEvent => !!e);
}

/** Events from today to 74 days out, for the cash view (a balance due in 60 days is for an event 74 days out). */
export async function cashEvents(admin: StaffMember, today: string, now: Date = new Date()): Promise<OverviewEvent[]> {
  if (!isFullAdmin(admin.role)) return [];
  return overviewEvents(admin, today, addDays(today, 74), now);
}
