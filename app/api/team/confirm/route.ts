import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { confirmChecklist, openEvent } from "@/lib/team/events";

// "I have everything": saves the confirmed time once every checklist box is checked.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { sessionId } = await request.json().catch(() => ({}));
    if (typeof sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const access = await openEvent(sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });
    const confirmedAt = await confirmChecklist(access.session, staff);
    if (!confirmedAt) return NextResponse.json({ error: "Check every item first." }, { status: 409 });
    return NextResponse.json({ ok: true, confirmedAt });
  } catch (err) {
    console.error("[team] confirm error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
