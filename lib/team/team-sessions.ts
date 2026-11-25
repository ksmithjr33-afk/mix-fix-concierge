// The sessions the team side reads: every submitted event, and the unfinished
// bookings that show as "Planning not finished" (lib/planning.ts), with their
// event details built from the booking. Server only.
//
// Anything that must wait for the client to finish (the Shopping list, client
// list, supplies, recipes, menu, order window) keeps reading submitted rows only.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { asTeamRow, showsOnTeam } from "@/lib/planning";

/** Submitted rows as they are, unfinished bookings that show on the team side with built details. */
export function teamRows(rows: SessionRow[]): SessionRow[] {
  return rows.filter((s) => (s.status === "submitted" ? true : s.status === "in_progress" && showsOnTeam(s))).map((s) => asTeamRow(s));
}

/** Every event the team side lists. Throws when the read fails, like the reads it replaces. */
export async function teamSessions(): Promise<SessionRow[]> {
  const { data, error } = await supabase.from("sessions").select("*").in("status", ["submitted", "in_progress"]);
  if (error) throw new Error(`sessions read failed: ${error.message}`);
  return teamRows((data as SessionRow[]) ?? []);
}

/** The same as teamSessions, for a set of ids. */
export async function teamSessionsByIds(ids: string[]): Promise<SessionRow[]> {
  const out: SessionRow[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from("sessions").select("*").in("id", ids.slice(i, i + 150));
    if (error) throw new Error(`sessions read failed: ${error.message}`);
    out.push(...teamRows((data as SessionRow[]) ?? []));
  }
  return out;
}

/** One event for the team side: submitted with details, or an unfinished booking that shows. Null otherwise. */
export async function getTeamSession(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error || !data) return null;
  const row = data as SessionRow;
  if (row.status === "submitted") return row.event_data ? row : null;
  return row.status === "in_progress" && showsOnTeam(row) ? asTeamRow(row) : null;
}
