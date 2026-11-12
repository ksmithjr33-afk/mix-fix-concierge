import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { chatInbox } from "@/lib/team/chat-db";

// The in-app chat check, called about every 20 seconds while a team page is
// open and visible: unread counts and the newest message per chat, nothing more.
export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const now = new Date();
    const inbox = await chatInbox(staff, now);
    return NextResponse.json({ ok: true, now: now.toISOString(), ...inbox }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[team-chat] inbox error:", err);
    return NextResponse.json({ error: "Could not check messages." }, { status: 500 });
  }
}
