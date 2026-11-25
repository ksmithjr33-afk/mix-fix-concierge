// Reads for the admin save alerts (lib/unsaved-sessions.ts). Server only.
// Looks back 30 days. Reads each conversation's messages to see whether the
// closing line went out anywhere in it, not only as the last message.

import { waitingOnClient, type WaitingOnClient } from "@/lib/planning";
import { supabase } from "@/lib/supabase";
import { hiddenEventIds } from "@/lib/team/hidden";
import { allClientRows } from "@/lib/client-history-db";
import { pricePendingList, type PricePendingAlert } from "@/lib/price-pending-db";
import { priceCheckList, type PriceCheckAlert } from "@/lib/price-check-db";
import { staleBookings, type ClientRow, type StaleBooking } from "@/lib/client-history";
import { guestCountFlag } from "@/lib/intake-guests";
import { orderWindowAlerts, type OrderWindowAlert } from "@/lib/team/order-window-db";
import type { SessionRow } from "@/lib/event-updates";
import { bookedWithPastDate, finishedNotSaved, sentClosing, type LogTail, type PastDateSession, type SessionState, type UnsavedSession } from "@/lib/unsaved-sessions";

const LOOKBACK_DAYS = 30;

export interface SaveAlerts {
  unsaved: UnsavedSession[];
  pastDate: PastDateSession[];
  stale: StaleBooking[]; // new bookings whose date, package or guest count copies the client's earlier booking
  pricePending: PricePendingAlert[]; // saved changes waiting for an admin to set the new total
  priceCheck: PriceCheckAlert[]; // bookings saved with "Price needs a check"
  guestCount: GuestCountAlert[]; // guest count differs from the booking with no price change applied or pending
  orderWindows: OrderWindowAlert[]; // upcoming events with someone's order window still needed
  waiting: WaitingOnClient[]; // upcoming bookings the client has not finished planning (lib/planning.ts)
}

export interface GuestCountAlert {
  sessionId: string;
  name: string;
  text: string;
}

/** `sharedRows` lets the Staffing page share its one read of every session with the repeat client tags. */
export async function saveAlerts(now: Date = new Date(), sharedRows?: Promise<ClientRow[]>): Promise<SaveAlerts> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const [logsRes, submittedRes, hidden, clientRows, pricePending, priceCheck, orderWindows, planningRes] = await Promise.all([
    supabase.from("conversation_logs").select("session_id, client_name, status, updated_at, messages").gte("updated_at", since),
    supabase.from("sessions").select("id, name, status, event_data, event_date, submitted_at, created_at, guest_count, price_pending").eq("status", "submitted").gte("submitted_at", since),
    hiddenEventIds(),
    sharedRows ?? allClientRows(),
    pricePendingList(),
    priceCheckList(),
    orderWindowAlerts(now).catch((err) => {
      console.error("[order window] alerts failed:", err);
      return [] as OrderWindowAlert[];
    }),
    supabase.from("sessions").select("id, name, email, status, event_date, created_at, booked_on").eq("status", "in_progress"),
  ]);
  if (logsRes.error) throw new Error(`conversation_logs read failed: ${logsRes.error.message}`);
  if (submittedRes.error) throw new Error(`sessions read failed: ${submittedRes.error.message}`);

  const logs = ((logsRes.data as unknown as (Omit<LogTail, "last"> & { messages?: LogTail["last"][] | null })[]) ?? []).map(({ messages, ...l }) => ({
    ...l,
    last: messages?.at(-1) ?? null,
    closed: sentClosing(messages as { role?: string; content?: unknown }[] | null),
  }));
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
    priceCheck: priceCheck.filter((p) => !hidden.has(p.sessionId)),
    guestCount: ((submittedRes.data as (SessionState & Pick<SessionRow, "guest_count" | "price_pending">)[]) ?? [])
      .filter((s) => !hidden.has(s.id))
      .flatMap((s) => {
        const flag = guestCountFlag({ ...s, status: "submitted", event_data: s.event_data as SessionRow["event_data"] });
        return flag ? [{ sessionId: s.id, name: String(s.event_data?.client_name ?? s.name ?? "Unknown client"), text: flag.text }] : [];
      }),
    orderWindows,
    waiting: planningRes.error ? [] : waitingOnClient((planningRes.data as { id: string }[]) ?? [], hidden, now),
  };
}
