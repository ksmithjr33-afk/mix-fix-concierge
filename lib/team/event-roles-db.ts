// Writing an assignment with its event role. Server only. The rules are in
// lib/team/event-roles.ts.

import { supabase } from "@/lib/supabase";
import { eventRoleOf, type EventRole } from "@/lib/team/event-roles";

/** The database said the role column is not there yet (20270106_assignment_roles.sql not run). */
export const missingRoleColumn = (message: string | undefined): boolean => /role/i.test(message ?? "") && /column|schema cache|does not exist/i.test(message ?? "");

export const ROLE_NOT_READY = "Roles on events are not set up yet. Run the 20270106_assignment_roles.sql migration.";

/**
 * Upsert an assignment row (on session and staff). With a role, and the
 * column not there yet, it is saved without the role so assigning never
 * breaks before the migration: the profile role stands in until then.
 */
export async function upsertAssignment(row: Record<string, unknown>): Promise<{ error: { message: string } | null }> {
  const first = await supabase.from("event_assignments").upsert(row, { onConflict: "session_id,staff_id" });
  if (first.error && "role" in row && missingRoleColumn(first.error.message)) {
    const { role: _role, ...rest } = row;
    void _role;
    return supabase.from("event_assignments").upsert(rest, { onConflict: "session_id,staff_id" });
  }
  return first;
}

/**
 * Every assignment on an event with the role worked on it: the row's, else
 * the default from the person's profile. Throws on a read error.
 */
export async function assignmentsWithRoles(sessionId: string): Promise<{ id: string; session_id: string; staff_id: string; status: "offered" | "accepted" | "declined"; role: EventRole }[]> {
  const { data, error } = await supabase.from("event_assignments").select("*, staff:staff_id (role)").eq("session_id", sessionId);
  if (error) throw new Error(`event_assignments lookup failed: ${error.message}`);
  return ((data as { id: string; session_id: string; staff_id: string; status: "offered" | "accepted" | "declined"; role?: string | null; staff: unknown }[]) ?? []).map((r) => {
    const st = (Array.isArray(r.staff) ? r.staff[0] : r.staff) as { role?: string } | null;
    return { id: r.id, session_id: r.session_id, staff_id: r.staff_id, status: r.status, role: eventRoleOf(r, st?.role) };
  });
}
