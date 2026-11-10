// Hidden events: an admin can hide an event (a test session, say) from the team
// portal. A row in team_hidden_events is the only thing written: the session,
// its assignments, and everything on the client's side are left alone, and
// unhiding deletes that one row. Server only.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { hideError, type AssignmentStatus } from "@/lib/team/assignments";

/** Ids of every hidden event. Empty before the table exists. */
export async function hiddenEventIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from("team_hidden_events").select("session_id");
  if (error) return new Set();
  return new Set(((data as { session_id: string }[]) ?? []).map((r) => r.session_id));
}

export async function isHidden(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase.from("team_hidden_events").select("session_id").eq("session_id", sessionId).maybeSingle();
  return !error && !!data;
}

export type HideResult = { ok: true } | { ok: false; error: string; status: number };

/** Hide an event. Refused while anyone is assigned to it. */
export async function hideEvent(sessionId: string, admin: StaffMember): Promise<HideResult> {
  const { data, error } = await supabase.from("event_assignments").select("status").eq("session_id", sessionId);
  if (error) throw new Error(`event_assignments lookup failed: ${error.message}`);
  const refusal = hideError(((data as { status: AssignmentStatus }[]) ?? []).map((r) => r.status));
  if (refusal) return { ok: false, error: refusal, status: 409 };
  const { error: insErr } = await supabase
    .from("team_hidden_events")
    .upsert({ session_id: sessionId, hidden_by: admin.id, hidden_at: new Date().toISOString() }, { onConflict: "session_id" });
  if (insErr) throw new Error(`hide failed: ${insErr.message}`);
  return { ok: true };
}

export async function unhideEvent(sessionId: string): Promise<void> {
  const { error } = await supabase.from("team_hidden_events").delete().eq("session_id", sessionId);
  if (error) throw new Error(`unhide failed: ${error.message}`);
}
