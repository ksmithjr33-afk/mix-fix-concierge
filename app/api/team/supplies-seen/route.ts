import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { openEvent } from "@/lib/team/events";
import { markSuppliesSeen, staffSupplies } from "@/lib/team/supplies-db";

// "Got it" on the Updated note: saves the supplies list as this person sees it
// now. Only staff assigned to the event (and admins).
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { sessionId } = await request.json().catch(() => ({}));
    if (typeof sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const access = await openEvent(sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });
    await markSuppliesSeen(staff.id, sessionId, (await staffSupplies(access.session)).list);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] supplies seen error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
