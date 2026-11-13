// Reads for the admin save alerts (lib/unsaved-sessions.ts). Server only.
// Looks back 30 days; reads only the last message of each conversation.

import { supabase } from "@/lib/supabase";
import { hiddenEventIds } from "@/lib/team/hidden";
import { allClientRows } from "@/lib/client-history-db";
import { staleBookings, type ClientRow, type StaleBooking } from "@/lib/client-history";
import { bookedWithPastDate, finishedNotSaved, type LogTail, type PastDateSession, type SessionState, type UnsavedSession } from "@/lib/unsaved-sessions";

const LOOKBACK_DAYS = 30;

export interface SaveAlerts {
  unsaved: UnsavedSession[];
  pastDate: PastDateSession[];
  stale: StaleBooking[]; // new bookings whose date, package or guest count copies the client's earlier booking
}

/** `sharedRows` lets the Staffing page share its one read of every session with the repeat client tags. */
export async function saveAlerts(now: Date = new Date(), sharedRows?: Promise<ClientRow[]>): Promise<SaveAlerts> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const [logsRes, submittedRes, hidden, clientRows] = await Promise.all([
    supabase.from("conversation_logs").select("session_id, client_name, status, updated_at, last:messages->-1").gte("updated_at", since),
    supabase.from("sessions").select("id, name, status, event_data, event_date, submitted_at, created_at").eq("status", "submitted").gte("submitted_at", since),
    hiddenEventIds(),
    sharedRows ?? allClientRows(),
  ]);
  if (logsRes.error) throw new Error(`conversation_logs read failed: ${logsRes.error.message}`);
  if (submittedRes.error) throw new Error(`sessions read failed: ${submittedRes.error.message}`);

  // The test database returns whole rows, so fall back to the last of messages there.
  const logs = ((logsRes.data as unknown as (LogTail & { messages?: LogTail["last"][] })[]) ?? []).map((l) => ({ ...l, last: l.last ?? l.messages?.at(-1) ?? null }));
  const ids = [...new Set(logs.map((l) => l.session_id))];
  const sessions: SessionState[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from("sessions").select("id, name, status, event_data, event_date").in("id", ids.slice(i, i + 150));
    if (error) throw new Error(`sessions read failed: ${error.message}`);
    sessions.push(...((data as SessionState[]) ?? []));
  }
  return {
    unsaved: finishedNotSaved(logs, sessions),
    pastDate: bookedWithPastDate((submittedRes.data as SessionState[]) ?? [], hidden),
    stale: staleBookings(clientRows, since, hidden),
  };
}
