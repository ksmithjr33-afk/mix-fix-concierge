// The one guard in the shared text path (lib/team/sms.ts sendStaffText, which
// every text from this app goes through, held partner texts included): a text
// to a number that is the guest of honor's on a surprise event, while the block
// is on, is dropped and logged, whatever sent it. Server only. Never throws:
// before supabase/migrations/20261226_surprise_events.sql runs the lookup
// fails and every text goes out as before.

import { supabase } from "@/lib/supabase";
import { normalizePhone } from "@/lib/team/codes";
import { surpriseActive, type SurpriseColumns } from "@/lib/partners/surprise";

type Row = SurpriseColumns & { id: string; event_date?: string | null; event_data?: Record<string, unknown> | null; team_market?: string | null };

const TZ_BY_MARKET: Record<string, string> = { los_angeles: "America/Los_Angeles" };

/** The surprise event this number is the guest of honor on, while the block is on. Null otherwise. */
export async function honoreeEventFor(phone: string, now: Date = new Date()): Promise<Row | null> {
  try {
    const p = normalizePhone(phone);
    if (!p) return null;
    const { data, error } = await supabase.from("sessions").select("id, event_date, event_data, team_market, is_surprise, honoree_phone").eq("honoree_phone", p).eq("is_surprise", true);
    if (error || !data) return null;
    return ((data as Row[]).find((s) => surpriseActive(s, now, TZ_BY_MARKET[String(s.team_market)] ?? "America/Chicago")) ?? null);
  } catch {
    return null;
  }
}

/** True when the text must be dropped. Logs it on the event's partner activity (and the server log). */
export async function dropTextToHonoree(phone: string, now: Date = new Date()): Promise<boolean> {
  const s = await honoreeEventFor(phone, now);
  if (!s) return false;
  console.warn(`[surprise] text to the guest of honor on ${s.id} dropped`);
  const { error } = await supabase.from("partner_activity").insert({
    session_id: s.id,
    partner_id: null,
    actor_kind: "system",
    actor_name: "Text guard",
    action: "Text to the guest of honor blocked",
    detail: "A text to the guest of honor's number was not sent. This is a surprise event.",
  });
  if (error) console.error(`[surprise] could not log the blocked text on ${s.id}:`, error.message);
  return true;
}
