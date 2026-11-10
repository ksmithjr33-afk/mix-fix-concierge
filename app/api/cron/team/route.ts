import { NextResponse } from "next/server";
import { sendClockOutReminders, sendLateSetupAlerts } from "@/lib/team/clock-db";
import { sendShortShiftAlerts } from "@/lib/team/shifts-db";
import { ensureMarkets } from "@/lib/team/markets-db";
import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";

/** Work out markets for new events and events whose address changed, a few per run. */
async function fillMarkets(): Promise<number> {
  const { data } = await supabase.from("sessions").select("*").eq("status", "submitted");
  return ensureMarkets((data as SessionRow[]) ?? [], 10);
}

export const maxDuration = 60; // up to 10 address lookups a run, one a second on OpenStreetMap

// Vercel cron, every 15 minutes (vercel.json). Vercel sends
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
  const [reminders, alerts, short] = await Promise.allSettled([sendClockOutReminders(now), sendLateSetupAlerts(now), sendShortShiftAlerts(now)]);
  const result = (r: PromiseSettledResult<number>) => (r.status === "fulfilled" ? r.value : `failed: ${String(r.reason)}`);
  const out = {
    marketsSet: result(markets[0]),
    clockOutReminders: result(reminders),
    lateSetupAlerts: result(alerts),
    shortShiftAlerts: result(short),
  };
  console.log("[team-cron]", JSON.stringify(out));
  return NextResponse.json({ ok: true, ...out });
}
