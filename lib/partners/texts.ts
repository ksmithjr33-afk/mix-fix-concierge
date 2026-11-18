// Partner, host and client texts about planners. They go through the existing
// text path (the staff text webhook) and respect quiet hours: from 9 PM to
// 8 AM in the event's time zone a text waits in partner_texts and the team
// cron sends it at 8 AM. Each text is about one event only. Never throws.
// Server only.

import { supabase } from "@/lib/supabase";
import { sendStaffText } from "@/lib/team/sms";
import { inQuietHours, sendableAt } from "@/lib/team/shifts";
import { eventData } from "@/lib/team/markets";
import { eventTz } from "@/lib/team/time";
import { dropTextToHonoree } from "@/lib/surprise-guard";

interface SessionLike {
  id: string;
  event_date?: string | null;
  event_data: Record<string, unknown> | null;
  team_market?: string | null;
}

/** Send now, or hold it for 8 AM in the event's time zone. True when it went out or was held. */
export async function sendPartnerText(session: SessionLike, phone: string, name: string, message: string, now: Date = new Date()): Promise<boolean> {
  try {
    if (!phone) return false;
    const tz = eventTz(eventData(session));
    if (!inQuietHours(now, tz)) return await sendStaffText(phone, name, message); // the surprise guard is in there
    // Never held for the guest of honor either: dropped and logged now.
    if (await dropTextToHonoree(phone, now)) return false;
    const { error } = await supabase.from("partner_texts").insert({
      session_id: session.id,
      phone,
      name,
      message,
      send_after: sendableAt(now, tz).toISOString(),
    });
    if (error) {
      console.error(`[partner-texts] could not hold a text for ${phone}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[partner-texts] text to ${phone} failed:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Cron: the texts held through quiet hours, once their time comes. Returns texts sent. */
export async function sendHeldPartnerTexts(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from("partner_texts").select("*").is("sent_at", null).lte("send_after", now.toISOString());
  if (error || !data) return 0; // before the migration
  let sent = 0;
  for (const t of data as { id: string; phone: string; name: string; message: string }[]) {
    // Claimed first so two overlapping runs never send it twice.
    const { data: claimed } = await supabase.from("partner_texts").update({ sent_at: now.toISOString() }).eq("id", t.id).is("sent_at", null).select("id");
    if (!claimed || (claimed as unknown[]).length === 0) continue;
    if (await sendStaffText(t.phone, t.name, t.message)) sent++;
  }
  return sent;
}
