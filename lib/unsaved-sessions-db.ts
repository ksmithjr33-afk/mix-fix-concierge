// Reads for the admin save alerts (lib/unsaved-sessions.ts). Server only.
// Looks back 30 days; reads only the last message of each conversation.

import { supabase } from "@/lib/supabase";
import { hiddenEventIds } from "@/lib/team/hidden";
import { allClientRows } from "@/lib/client-history-db";
import { pricePendingList, type PricePendingAlert } from "@/lib/price-pending-db";
import { staleBookings, type ClientRow, type StaleBooking } from "@/lib/client-history";
import { guestCountFlag } from "@/lib/intake-guests";
import type { SessionRow } from "@/lib/event-updates";
import { bookedWithPastDate, finishedNotSaved, type LogTail, type PastDateSession, type SessionState, type UnsavedSession } from "@/lib/unsaved-sessions";

const LOOKBACK_DAYS = 30;

export interface SaveAlerts {
  unsaved: UnsavedSession[];
  pastDate: PastDateSession[];
  stale: StaleBooking[]; // new bookings whose date, package or guest count copies the client's earlier booking
  pricePending: PricePendingAlert[]; // saved changes waiting for an admin to set the new total
  guestCount: GuestCountAlert[]; // guest count differs from the booking with no price change applied or pending
}

export interface GuestCountAlert {
  sessionId: string;
  name: string;
  text: string;
}

/** `sharedRows` lets the Staffing page share its one read of every session with the repeat client tags. */
export async function saveAlerts(now: Date = new Date(), sharedRows?: Promise<ClientRow[]>): Promise<SaveAlerts> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const [logsRes, submittedRes, hidden, clientRows, pricePending] = await Promise.all([
    supabase.from("conversation_logs").select("session_id, client_name, status, updated_at, last:messages->-1").gte("updated_at", since),
    supabase.from("sessions").select("id, name, status, event_data, event_date, submitted_at, created_at, guest_count, price_pending").eq("status", "submitted").gte("submitted_at", since),
    hiddenEventIds(),
    sharedRows ?? allClientRows(),
    pricePendingList(),
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
    pricePending,
    guestCount: ((submittedRes.data as (SessionState & Pick<SessionRow, "guest_count" | "price_pending">)[]) ?? [])
      .filter((s) => !hidden.has(s.id))
      .flatMap((s) => {
        const flag = guestCountFlag({ ...s, status: "submitted", event_data: s.event_data as SessionRow["event_data"] });
        return flag ? [{ sessionId: s.id, name: String(s.event_data?.client_name ?? s.name ?? "Unknown client"), text: flag.text }] : [];
      }),
  };
}
