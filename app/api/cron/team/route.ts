import { NextResponse } from "next/server";
import { sendClockOutReminders, sendLateSetupAlerts } from "@/lib/team/clock-db";
import { deliverShiftNotices, sendShortShiftAlerts } from "@/lib/team/shifts-db";
import { ensureMarkets } from "@/lib/team/markets-db";
import { sendCloseoutReminders } from "@/lib/team/closeout-db";
import { sendCertReminders } from "@/lib/team/certs-db";
import { deliverAnnouncements } from "@/lib/team/announcements-db";
import { deliverChatNotices } from "@/lib/team/chat-db";
import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";

/** Work out markets for new events and events whose address changed, a few per run. */
async function fillMarkets(): Promise<number> {
  const { data } = await supabase.from("sessions").select("*").eq("status", "submitted");
  return ensureMarkets((data as SessionRow[]) ?? [], 10);
}

export const maxDuration = 60; // up to 10 address lookups a run, one a second on OpenStreetMap

// Vercel cron, every 5 minutes (vercel.json). Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; anything else is refused.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  // Each job runs on its own, so one failing never stops the others.
  // Markets first, so the time math below uses each event's time zone.
  const markets = await Promise.allSettled([fillMarkets()]);
  const [reminders, alerts, short, shiftTexts, announcementTexts, chatTexts, closeoutTexts, certTexts] = await Promise.allSettled([
    sendClockOutReminders(now),
    sendLateSetupAlerts(now),
    sendShortShiftAlerts(now),
    deliverShiftNotices(now), // held new shift texts: batched, and sent at 8:00 AM after quiet hours
    deliverAnnouncements(now), // announcement texts held for quiet hours
    deliverChatNotices(now), // team chat texts held by the 5 minute batch
    sendCloseoutReminders(now), // one text 2 hours after clock out with no closeout
    sendCertReminders(now), // certification expiry: 30 days, 7 days, and the day
  ]);
  const result = (r: PromiseSettledResult<number>) => (r.status === "fulfilled" ? r.value : `failed: ${String(r.reason)}`);
  const out = {
    marketsSet: result(markets[0]),
    clockOutReminders: result(reminders),
    lateSetupAlerts: result(alerts),
    shortShiftAlerts: result(short),
    newShiftTexts: result(shiftTexts),
    announcementTexts: result(announcementTexts),
    chatTexts: result(chatTexts),
    closeoutReminders: result(closeoutTexts),
    certReminders: result(certTexts),
  };
  console.log("[team-cron]", JSON.stringify(out));
  return NextResponse.json({ ok: true, ...out });
}
