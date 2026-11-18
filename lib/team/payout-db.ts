// The payout sheet from the database. Server only. Admins and managers only:
// anyone else gets nothing back.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { isAdminRole } from "@/lib/team/roles";
import { crewEstimates } from "@/lib/team/pay-db";
import { eventTimesheetRows } from "@/lib/team/timesheet-db";
import type { TimesheetRow } from "@/lib/team/timesheet";
import { payoutRow, payoutTotals, tipMismatchNote, type PayoutRow, type PayoutTotals } from "@/lib/team/payout";

export interface PayoutSheet {
  sessionId: string;
  rows: PayoutRow[];
  totals: PayoutTotals;
  tipNote: string | null; // booked tip per bartender against the split, when they differ by more than a dollar
}

/** Build the sheet from estimates and timesheet rows already loaded. */
export async function payoutFrom(viewer: StaffMember, session: SessionRow, sheet: TimesheetRow[]): Promise<PayoutSheet | null> {
  if (!isAdminRole(viewer.role)) return null;
  const crew = await crewEstimates(viewer, session);
  const bySheet = new Map(sheet.map((r) => [r.staffId, r]));
  const names = new Map(sheet.map((r) => [r.staffId, r.staffName]));
  const missing = crew.filter((c) => !names.has(c.staffId)).map((c) => c.staffId);
  if (missing.length) {
    const { data } = await supabase.from("staff").select("id, name").in("id", missing);
    for (const s of (data as { id: string; name: string }[]) ?? []) names.set(s.id, s.name);
  }
  const rows = crew
    .map((c) => payoutRow({ staffId: c.staffId, assignmentId: c.assignmentId, name: names.get(c.staffId) || "Unknown staff member", role: c.role, estimate: c.estimate, sheet: bySheet.get(c.staffId) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const split = crew.map((c) => c.estimate.tips).find((t) => t.state === "on_file");
  const tipNote = tipMismatchNote(session.booked_price?.tip_per_bartender, split?.state === "on_file" ? split.cents : null);
  return { sessionId: session.id, rows, totals: payoutTotals(rows), tipNote };
}

export async function payoutSheet(viewer: StaffMember, session: SessionRow): Promise<PayoutSheet | null> {
  if (!isAdminRole(viewer.role)) return null;
  return payoutFrom(viewer, session, await eventTimesheetRows(session.id));
}

/** Mileage and tips per timesheet row (by assignment), for the payroll CSV. Admins and managers. */
export async function payoutExtras(viewer: StaffMember, rows: TimesheetRow[]): Promise<Map<string, { mileageMiles: number; mileageCents: number; tipsCents: number | null }>> {
  const out = new Map<string, { mileageMiles: number; mileageCents: number; tipsCents: number | null }>();
  if (!isAdminRole(viewer.role) || rows.length === 0) return out;
  const ids = [...new Set(rows.map((r) => r.sessionId))];
  const { data } = await supabase.from("sessions").select("*").in("id", ids);
  const sessions = (data as SessionRow[]) ?? [];
  const sheets = await Promise.all(sessions.map((s) => payoutFrom(viewer, s, rows.filter((r) => r.sessionId === s.id))));
  for (const sh of sheets) for (const r of sh?.rows ?? []) out.set(r.assignmentId, { mileageMiles: r.mileageMiles, mileageCents: r.mileageCents, tipsCents: r.tipsCents });
  return out;
}
