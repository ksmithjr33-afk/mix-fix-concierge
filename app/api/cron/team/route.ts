import { NextResponse } from "next/server";
import { sendClockOutReminders, sendLateSetupAlerts } from "@/lib/team/clock-db";

// Vercel cron, every 15 minutes (vercel.json). Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; anything else is refused.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  // Each job runs on its own, so one failing never stops the other.
  const [reminders, alerts] = await Promise.allSettled([sendClockOutReminders(now), sendLateSetupAlerts(now)]);
  const out = {
    clockOutReminders: reminders.status === "fulfilled" ? reminders.value : `failed: ${String(reminders.reason)}`,
    lateSetupAlerts: alerts.status === "fulfilled" ? alerts.value : `failed: ${String(alerts.reason)}`,
  };
  console.log("[team-cron]", JSON.stringify(out));
  return NextResponse.json({ ok: true, ...out });
}
