// Reimbursements from the database. Server only.
//
// Rows live in payroll_reimbursements
// (supabase/migrations/20261219_payroll_reimbursements.sql). Until that
// migration runs, reads come back empty with ready false, so every page that
// shows pay still loads, and adding one says the migration is needed.
//
// Admins only (role admin, never managers) add, change, or remove them, and
// only while that person's line on the event is not marked paid. A staff
// member reads only their own (myReimbursements).

import { iceMachines } from "@/lib/team/ice-pickup-db";
import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { isFullAdmin } from "@/lib/team/roles";
import { FROM_RECEIPT_MESSAGE, LOCKED_MESSAGE, REIMBURSEMENTS_NOT_READY, validateReimbursement, type Reimbursement, type ReimbursementKind } from "@/lib/team/reimbursements";

export const REIMBURSEMENTS_TABLE = "payroll_reimbursements";
const PAID_TABLE = "payroll_paid";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const ADMINS_ONLY = { ok: false as const, error: "Admins only.", status: 403 };

interface Row {
  id: string;
  assignment_id: string;
  session_id: string;
  staff_id: string;
  kind: ReimbursementKind;
  amount_cents: number;
  note: string | null;
  created_at?: string;
  receipt_id?: string | null; // from 20261223_receipts.sql; missing before it runs
}

const toItem = (r: Row): Reimbursement => ({ id: r.id, assignmentId: r.assignment_id, sessionId: r.session_id, staffId: r.staff_id, kind: r.kind, cents: Number(r.amount_cents), note: r.note ?? "", receiptId: r.receipt_id ?? null });

export interface ReimbursementsRead {
  ready: boolean; // false until the migration runs
  byAssignment: Map<string, Reimbursement[]>;
}

/** Every reimbursement on these events, by assignment, oldest first. */
export async function reimbursementsFor(sessionIds: string[]): Promise<ReimbursementsRead> {
  const byAssignment = new Map<string, Reimbursement[]>();
  const ids = [...new Set(sessionIds)];
  const probe = ids.length ? ids : ["none"];
  const { data, error } = await supabase.from(REIMBURSEMENTS_TABLE).select("*").in("session_id", probe).order("created_at", { ascending: true });
  if (error) return { ready: false, byAssignment };
  for (const r of (data as Row[]) ?? []) byAssignment.set(r.assignment_id, [...(byAssignment.get(r.assignment_id) ?? []), toItem(r)]);
  return { ready: true, byAssignment };
}

/** A staff member's own reimbursements on these events, by session. Only ever their own rows. */
export async function myReimbursements(staffId: string, sessionIds: string[]): Promise<Map<string, Reimbursement[]>> {
  const out = new Map<string, Reimbursement[]>();
  if (!staffId || sessionIds.length === 0) return out;
  const { data, error } = await supabase.from(REIMBURSEMENTS_TABLE).select("*").eq("staff_id", staffId).in("session_id", [...new Set(sessionIds)]).order("created_at", { ascending: true });
  if (error) return out;
  for (const r of (data as Row[]) ?? []) out.set(r.session_id, [...(out.get(r.session_id) ?? []), toItem(r)]);
  return out;
}

/** Who did the ice and menu pickups on these events, by session: the staff ids. */
export async function pickupsDone(sessionIds: string[]): Promise<Map<string, { ice: Set<string>; menu: Set<string> }>> {
  const out = new Map<string, { ice: Set<string>; menu: Set<string> }>();
  const ids = [...new Set(sessionIds)];
  for (const id of ids) out.set(id, { ice: new Set(), menu: new Set() });
  if (ids.length === 0) return out;
  const [ice, menu] = await Promise.all([
    supabase.from("event_ice_pickup_people").select("session_id, staff_id, picked_up_at, covered_by").in("session_id", ids),
    supabase.from("event_menu_pickups").select("session_id, assignee_id, picked_up_at, not_needed").in("session_id", ids),
  ]);
  // Ice: the person on the row, or whoever covered for them ("I picked up the ice instead"). Never with an ice machine onsite.
  const machines = await iceMachines(ids);
  for (const r of (ice.error ? [] : (ice.data as { session_id: string; staff_id: string; picked_up_at: string | null; covered_by?: string | null }[]) ?? [])) {
    if (r.picked_up_at && !machines.has(r.session_id)) out.get(r.session_id)?.ice.add(r.covered_by || r.staff_id);
  }
  // Menus: the person assigned, once it is checked picked up (an admin may check it for them).
  for (const r of (menu.error ? [] : (menu.data as { session_id: string; assignee_id: string | null; picked_up_at: string | null; not_needed: boolean }[]) ?? [])) {
    if (r.picked_up_at && r.assignee_id && !r.not_needed) out.get(r.session_id)?.menu.add(r.assignee_id);
  }
  return out;
}

export async function lineIsPaid(assignmentId: string): Promise<boolean> {
  const { data, error } = await supabase.from(PAID_TABLE).select("assignment_id").eq("assignment_id", assignmentId).is("undone_at", null);
  return !error && ((data as unknown[]) ?? []).length > 0;
}

const saveError = (message: string) =>
  /does not exist|relation|schema cache/i.test(message) ? { error: REIMBURSEMENTS_NOT_READY, status: 503 } : { error: "Could not save. Try again.", status: 500 };

/** Add one to a person on an event: { assignmentId, kind, amount, note? }. */
export async function addReimbursement(admin: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ id: string }>> {
  if (!isFullAdmin(admin.role)) return ADMINS_ONLY;
  if (typeof body.assignmentId !== "string" || !body.assignmentId) return { ok: false, error: "Bad request", status: 400 };
  const v = validateReimbursement(body);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { data: a } = await supabase.from("event_assignments").select("id, session_id, staff_id, status").eq("id", body.assignmentId).maybeSingle();
  const asg = a as { id: string; session_id: string; staff_id: string; status: string } | null;
  if (!asg || asg.status !== "accepted") return { ok: false, error: "That person is not on this event.", status: 404 };
  if (await lineIsPaid(asg.id)) return { ok: false, error: LOCKED_MESSAGE, status: 409 };
  const { data, error } = await supabase
    .from(REIMBURSEMENTS_TABLE)
    .insert({ assignment_id: asg.id, session_id: asg.session_id, staff_id: asg.staff_id, kind: v.kind, amount_cents: v.cents, note: v.note, created_by: admin.id, created_by_name: admin.name, created_at: now.toISOString() })
    .select("id");
  if (error) return { ok: false, ...saveError(error.message) };
  return { ok: true, id: String(((data as { id: string }[]) ?? [])[0]?.id ?? "") };
}

async function existing(id: unknown): Promise<Row | null | "not_ready"> {
  if (typeof id !== "string" || !id) return null;
  const { data, error } = await supabase.from(REIMBURSEMENTS_TABLE).select("*").eq("id", id).maybeSingle();
  if (error) return /does not exist|relation|schema cache/i.test(error.message) ? "not_ready" : null;
  return (data as Row | null) ?? null;
}

/** Change one: { id, kind, amount, note? }. */
export async function editReimbursement(admin: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  if (!isFullAdmin(admin.role)) return ADMINS_ONLY;
  const v = validateReimbursement(body);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const row = await existing(body.id);
  if (row === "not_ready") return { ok: false, error: REIMBURSEMENTS_NOT_READY, status: 503 };
  if (!row) return { ok: false, error: "That reimbursement is gone. Reload the page.", status: 404 };
  if (row.receipt_id) return { ok: false, error: FROM_RECEIPT_MESSAGE, status: 409 };
  if (await lineIsPaid(row.assignment_id)) return { ok: false, error: LOCKED_MESSAGE, status: 409 };
  const { error } = await supabase
    .from(REIMBURSEMENTS_TABLE)
    .update({ kind: v.kind, amount_cents: v.cents, note: v.note, updated_by: admin.id, updated_by_name: admin.name, updated_at: now.toISOString() })
    .eq("id", row.id);
  if (error) return { ok: false, ...saveError(error.message) };
  return { ok: true };
}

/** Remove one: { id }. */
export async function removeReimbursement(admin: StaffMember, body: Record<string, unknown>): Promise<Result> {
  if (!isFullAdmin(admin.role)) return ADMINS_ONLY;
  const row = await existing(body.id);
  if (row === "not_ready") return { ok: false, error: REIMBURSEMENTS_NOT_READY, status: 503 };
  if (!row) return { ok: false, error: "That reimbursement is gone. Reload the page.", status: 404 };
  if (row.receipt_id) return { ok: false, error: FROM_RECEIPT_MESSAGE, status: 409 };
  if (await lineIsPaid(row.assignment_id)) return { ok: false, error: LOCKED_MESSAGE, status: 409 };
  const { error } = await supabase.from(REIMBURSEMENTS_TABLE).delete().eq("id", row.id);
  if (error) return { ok: false, ...saveError(error.message) };
  return { ok: true };
}
