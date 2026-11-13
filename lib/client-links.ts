// The client's links for the manager view's Details tab: their concierge link
// and their event page link, whether they finished the concierge, and when
// they last opened or updated it. Admins only: clientLinks returns null for
// anyone else, and only the admin manager view calls it. Server only.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { siteOrigin } from "@/lib/team/clock-db";
import { chicagoStamp } from "@/lib/team/time";

export interface ClientLinks {
  conciergeUrl: string; // /s?id=<id>: the concierge chat, update mode once they finished
  eventUrl: string; // the same page, opened at their event details
  openConcierge: string; // the Open buttons add admin=1, so an admin opening it never counts as the client
  openEvent: string;
  finished: boolean;
  finishedAt: string | null;
  addedByHand: boolean;
  lastOpenedAt: string | null;
  lastUpdatedAt: string | null;
}

/** The concierge link and event page link for a session. */
export function clientUrls(base: string, sessionId: string) {
  const q = `/s?id=${encodeURIComponent(sessionId)}`;
  return {
    conciergeUrl: `${base}${q}`,
    eventUrl: `${base}${q}#event-details`,
    openConcierge: `${base}${q}&admin=1`,
    openEvent: `${base}${q}&admin=1#event-details`,
  };
}

/** "Finished the concierge Nov 3, 2026, 4:12 PM. Last opened Nov 10, 2026, 9:00 AM. Last updated Nov 9, 2026, 2:00 PM." */
export function clientStatusLine(l: Pick<ClientLinks, "finished" | "finishedAt" | "addedByHand" | "lastOpenedAt" | "lastUpdatedAt">, tz?: string): string {
  const at = (iso: string | null) => chicagoStamp(iso, tz);
  const parts = [
    l.finished
      ? `Finished the concierge${l.finishedAt ? ` ${at(l.finishedAt)}` : ""}.`
      : l.addedByHand
        ? "Added by hand, the client has not done the concierge."
        : "Has not finished the concierge.",
    l.lastOpenedAt ? `Last opened ${at(l.lastOpenedAt)}.` : "Has not opened their link yet.",
    l.lastUpdatedAt ? `Last updated ${at(l.lastUpdatedAt)}.` : "No updates from the client.",
  ];
  return parts.join(" ");
}

/** The client links card data. Null unless the viewer is an admin. */
export async function clientLinks(session: SessionRow, viewer: { role: string }): Promise<ClientLinks | null> {
  if (viewer.role !== "admin") return null;
  const s = session as SessionRow & { created_by?: string | null; client_opened_at?: string | null };
  const addedByHand = s.created_by === "admin";
  // The client's own updates: concierge rows after the first submission.
  const { data } = await supabase.from("event_updates").select("version, created_at, source").eq("session_id", session.id);
  const clientRows = ((data as { version: number; created_at: string; source: string }[]) ?? []).filter((r) => r.source === "concierge" && r.version > 1);
  const lastUpdatedAt = clientRows.map((r) => r.created_at).sort().at(-1) ?? null;
  // An event added by hand as confirmed has no concierge chat. One added with the
  // concierge link counts as finished once the client completed the chat.
  let finished = session.status === "submitted";
  if (finished && addedByHand) {
    const { data: log } = await supabase.from("conversation_logs").select("status").eq("session_id", session.id).maybeSingle();
    finished = (log as { status?: string } | null)?.status === "completed";
  }
  return {
    ...clientUrls(siteOrigin(), session.id),
    finished,
    finishedAt: finished ? session.submitted_at : null,
    addedByHand,
    lastOpenedAt: s.client_opened_at ?? null,
    lastUpdatedAt,
  };
}

/** The client opened their link. Admins opening it from the manager view (admin=1) are not counted. Never throws. */
export async function recordClientOpen(sessionId: string, now: Date = new Date()): Promise<void> {
  const { error } = await supabase.from("sessions").update({ client_opened_at: now.toISOString() }).eq("id", sessionId);
  if (error && !/client_opened_at/.test(error.message)) console.error("[client-links] open not recorded:", error.message);
}
