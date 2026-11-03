// Database side of update mode: record the intake submission as version 1 and
// apply post submission changes as versioned event_updates rows.

import { supabase } from "@/lib/supabase";
import {
  computeDeadlines,
  planUpdate,
  snapshotChanges,
  type EventData,
  type FieldChange,
  type PlannedRow,
} from "@/lib/event-diff";

export const SESSION_COLUMNS =
  "id, name, email, event_date, package_type, guest_count, event_name, hours_booked, status, event_data, version, submitted_at, updated_at";

export interface SessionRow {
  id: string;
  name: string | null;
  email: string | null;
  event_date: string | null;
  package_type: string | null;
  guest_count: string | null;
  event_name: string | null;
  hours_booked: string | null;
  status: "in_progress" | "submitted";
  event_data: EventData | null;
  version: number;
  submitted_at: string | null;
  updated_at: string | null;
}

export interface EventUpdateRow {
  id: string;
  session_id: string;
  version: number;
  created_at: string;
  source: "concierge" | "manager";
  changes: FieldChange[];
  summary: string | null;
  within_deadline: boolean | null;
  applied: boolean;
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    console.error("sessions lookup error:", error);
    return null;
  }
  return (data as SessionRow | null) ?? null;
}

export async function getEventUpdates(sessionId: string): Promise<EventUpdateRow[]> {
  const { data, error } = await supabase
    .from("event_updates")
    .select("*")
    .eq("session_id", sessionId)
    .order("version", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("event_updates lookup error:", error);
    return [];
  }
  return (data as EventUpdateRow[]) ?? [];
}

/** Drop the old intake fields save-event already strips before storing. */
export function stripLegacyFields(eventData: EventData): EventData {
  const { age_range: _age, menu_style: _ms, menu_notes: _mn, menu_design_preference: _mdp, ...rest } =
    eventData;
  return rest;
}

/**
 * Save the full submit_event_data payload on the session row as version 1 and
 * write the version 1 history row. Does nothing if the session row does not
 * exist (chats started without a /s link) or was already submitted.
 */
export async function recordSubmission(sessionId: string, eventData: EventData): Promise<boolean> {
  const clean = stripLegacyFields(eventData);
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("sessions")
    .update({ event_data: clean, status: "submitted", submitted_at: nowIso, updated_at: nowIso, version: 1 })
    .eq("id", sessionId)
    .neq("status", "submitted")
    .select("id");
  if (error) {
    console.error("sessions submission update error:", error);
    return false;
  }
  if (!data || data.length === 0) return false;

  const { error: insertError } = await supabase.from("event_updates").insert({
    session_id: sessionId,
    version: 1,
    source: "concierge",
    changes: snapshotChanges(clean),
    summary: "Initial submission",
    within_deadline: true,
    applied: true,
  });
  if (insertError) console.error("event_updates version 1 insert error:", insertError);
  return true;
}

export interface ApplyResult {
  eventData: EventData;
  version: number;
  updatedAt: string | null;
  rows: EventUpdateRow[];
}

function toInsert(sessionId: string, row: PlannedRow, version: number, source: "concierge" | "manager") {
  return {
    session_id: sessionId,
    version,
    source,
    changes: row.changes,
    summary: row.summary,
    within_deadline: row.within_deadline,
    applied: row.applied,
  };
}

/**
 * Diff a partial event against the session's current event_data, merge what is
 * allowed now and bump the version, and record late drink changes and manager
 * requests as unapplied rows. Returns null if the session is not submitted.
 */
export async function applyEventUpdate(
  sessionId: string,
  partial: EventData,
  options: { managerRequest?: string | null; source?: "concierge" | "manager"; now?: Date } = {}
): Promise<ApplyResult | null> {
  const source = options.source ?? "concierge";

  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await getSession(sessionId);
    if (!session || session.status !== "submitted" || !session.event_data) return null;

    const current = session.event_data;
    const deadlines = computeDeadlines(current.event_date ?? session.event_date, options.now);
    const plan = planUpdate(current, partial, { managerRequest: options.managerRequest, deadlines });

    let version = session.version;
    let updatedAt = session.updated_at ?? session.submitted_at;

    if (plan.applied) {
      const nowIso = new Date().toISOString();
      // Only succeeds if nobody bumped the version since we read it.
      const { data, error } = await supabase
        .from("sessions")
        .update({ event_data: plan.next, version: version + 1, updated_at: nowIso })
        .eq("id", sessionId)
        .eq("version", version)
        .select("id");
      if (error) throw new Error(`sessions update failed: ${error.message}`);
      if (!data || data.length === 0) continue;
      version += 1;
      updatedAt = nowIso;
    }

    const inserts = [plan.applied, plan.late, plan.requests]
      .filter((r): r is PlannedRow => r !== null)
      .map((r) => toInsert(sessionId, r, version, source));

    let rows: EventUpdateRow[] = [];
    if (inserts.length > 0) {
      const { data, error } = await supabase.from("event_updates").insert(inserts).select("*");
      if (error) throw new Error(`event_updates insert failed: ${error.message}`);
      rows = (data as EventUpdateRow[]) ?? [];
    }

    return { eventData: plan.applied ? plan.next : current, version, updatedAt, rows };
  }

  throw new Error("event update kept conflicting with a concurrent update");
}
