// Pay: rates and estimates from the database. Server only.
//
// Rates live in their own table (staff_pay_rates), never on the staff row, so
// no staff list, chat, or teammate lookup can carry them. Bartender pages only
// ever call the functions here with the signed in person's own id.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { eventData } from "@/lib/team/markets";
import { timesheetRows } from "@/lib/team/timesheet-db";
import { estimatedPayCents, money, payCents, scheduledMinutes, validateRate, type PayRow } from "@/lib/team/pay";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

interface SessionLite {
  id: string;
  event_date?: string | null;
  event_data: Record<string, unknown> | null;
  team_market?: string | null;
}

/** One person's hourly rate in cents, or null. */
export async function rateFor(staffId: string): Promise<number | null> {
  const { data, error } = await supabase.from("staff_pay_rates").select("hourly_rate_cents").eq("staff_id", staffId).maybeSingle();
  if (error || !data) return null;
  const c = (data as { hourly_rate_cents: number | null }).hourly_rate_cents;
  return c && c > 0 ? c : null;
}

/** Everyone's rates, for admin pages and the admin CSV only. */
export async function ratesFor(admin: StaffMember, staffIds: string[]): Promise<Map<string, number>> {
  if (admin.role !== "admin" || staffIds.length === 0) return new Map();
  const { data, error } = await supabase.from("staff_pay_rates").select("staff_id, hourly_rate_cents").in("staff_id", [...new Set(staffIds)]);
  if (error || !data) return new Map();
  return new Map((data as { staff_id: string; hourly_rate_cents: number }[]).filter((r) => r.hourly_rate_cents > 0).map((r) => [r.staff_id, r.hourly_rate_cents]));
}

/** Set or clear a rate. Admins only. */
export async function setRate(admin: StaffMember, staffId: string, raw: unknown, now: Date = new Date()): Promise<Result<{ cents: number | null }>> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const v = validateRate(raw);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { data: p } = await supabase.from("staff").select("id").eq("id", staffId).maybeSingle();
  if (!p) return { ok: false, error: "We could not find that person.", status: 404 };
  const { error } =
    v.cents === null
      ? await supabase.from("staff_pay_rates").delete().eq("staff_id", staffId)
      : await supabase.from("staff_pay_rates").upsert({ staff_id: staffId, hourly_rate_cents: v.cents, updated_by: admin.id, updated_at: now.toISOString() }, { onConflict: "staff_id" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, cents: v.cents };
}

/** "$187.50" for this person on one event, or null without a rate or times. */
export async function myEstimate(staffId: string, session: SessionLite): Promise<string | null> {
  const c = estimatedPayCents(await rateFor(staffId), eventData(session));
  return c === null ? null : money(c);
}

/** The same for many events at once, by session id. */
export async function myEstimates(staffId: string, sessionIds: string[]): Promise<Record<string, string>> {
  const rate = await rateFor(staffId);
  if (!rate || sessionIds.length === 0) return {};
  const { data } = await supabase.from("sessions").select("*").in("id", [...new Set(sessionIds)]);
  const out: Record<string, string> = {};
  for (const s of (data as SessionLite[]) ?? []) {
    const c = estimatedPayCents(rate, eventData(s));
    if (c !== null) out[s.id] = money(c);
  }
  return out;
}

/** The estimate on a posted shift, for the person looking at it. */
export async function myEstimateForPost(staffId: string, postId: string): Promise<string | null> {
  const rate = await rateFor(staffId);
  if (!rate) return null;
  const { data: post } = await supabase.from("shift_posts").select("session_id").eq("id", postId).maybeSingle();
  const sessionId = (post as { session_id?: string } | null)?.session_id;
  if (!sessionId) return null;
  const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!s) return null;
  const c = estimatedPayCents(rate, eventData(s as SessionLite));
  return c === null ? null : money(c);
}

/**
 * My pay: one row per event this person worked or is on in from..to, with
 * scheduled hours, approved clocked hours, and pay (approved hours once
 * approved, the scheduled estimate before that). Only ever their own rows.
 */
export async function myPayRows(staffId: string, from: string, to: string): Promise<{ rate: number | null; rows: PayRow[] }> {
  const rate = await rateFor(staffId);
  if (!rate) return { rate: null, rows: [] };
  const sheet = (await timesheetRows(from, to)).filter((r) => r.staffId === staffId);
  if (sheet.length === 0) return { rate, rows: [] };
  const { data } = await supabase.from("sessions").select("*").in("id", [...new Set(sheet.map((r) => r.sessionId))]);
  const sessions = new Map(((data as SessionLite[]) ?? []).map((s) => [s.id, s]));
  const rows = sheet.map((r): PayRow => {
    const s = sessions.get(r.sessionId);
    const sched = s ? scheduledMinutes(eventData(s)) : null;
    const approvedMinutes = r.approved && r.minutes !== null ? r.minutes : null;
    return {
      sessionId: r.sessionId,
      day: r.eventDay,
      title: r.eventTitle,
      scheduledMinutes: sched,
      approvedMinutes,
      payCents: approvedMinutes !== null ? payCents(rate, approvedMinutes) : payCents(rate, sched),
      fromApproved: approvedMinutes !== null,
    };
  });
  return { rate, rows: rows.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "")) };
}
