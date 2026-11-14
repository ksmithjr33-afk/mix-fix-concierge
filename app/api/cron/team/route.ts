import { NextResponse } from "next/server";
import { sendClockOutReminders, sendLateSetupAlerts } from "@/lib/team/clock-db";
import { deliverShiftNotices, sendShortShiftAlerts } from "@/lib/team/shifts-db";
import { ensureMarkets } from "@/lib/team/markets-db";
import { sendCloseoutReminders } from "@/lib/team/closeout-db";
import { sendSupplyNotices } from "@/lib/team/supplies-db";
import { sendCertReminders } from "@/lib/team/certs-db";
import { deliverAnnouncements } from "@/lib/team/announcements-db";
import { deliverChatNotices } from "@/lib/team/chat-db";
import { sendMenuPickupNotices } from "@/lib/team/menu-pickup-db";
import { sendIcePickupNotices } from "@/lib/team/ice-pickup-db";
import { sendRequestTexts } from "@/lib/change-requests";
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
  const [reminders, alerts, short, shiftTexts, announcementTexts, chatTexts, closeoutTexts, certTexts, supplyTexts, menuTexts, requestTexts, iceTexts] = await Promise.allSettled([
    sendClockOutReminders(now),
    sendLateSetupAlerts(now),
    sendShortShiftAlerts(now),
    deliverShiftNotices(now), // held new shift texts: batched, and sent at 8:00 AM after quiet hours
    deliverAnnouncements(now), // announcement texts held for quiet hours
    deliverChatNotices(now), // team chat texts held by the 5 minute batch
    sendCloseoutReminders(now), // one wrap up text 30 minutes after clock out, never in quiet hours
    sendCertReminders(now), // certification expiry: 30 days, 7 days, and the day
    sendSupplyNotices(now), // admin edits to the supplies list inside 48 hours, once the edits settle
    sendMenuPickupNotices(now), // menu pickup: held assignment texts, the morning reminder, and the 24 hour admin alert
    sendRequestTexts(now), // client change requests that came in during quiet hours, texted to admins at 8:00 AM
    sendIcePickupNotices(now), // ice pickup texts held for quiet hours
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
    supplyTexts: result(supplyTexts),
    menuPickupTexts: result(menuTexts),
    icePickupTexts: result(iceTexts),
    changeRequestTexts: result(requestTexts),
  };
  console.log("[team-cron]", JSON.stringify(out));
  return NextResponse.json({ ok: true, ...out });
}
