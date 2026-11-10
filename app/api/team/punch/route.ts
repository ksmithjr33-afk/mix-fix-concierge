import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { openEvent } from "@/lib/team/events";
import { recordPunch } from "@/lib/team/clock-db";

// Clock in or out. Body: { sessionId, type: "in" | "out", location, clientTime, clientId }.
// clientTime and clientId come from the phone, so a punch queued offline keeps
// its tap time (flagged sent late) and a retry is never saved twice.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.sessionId !== "string" || (body.type !== "in" && body.type !== "out")) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const access = await openEvent(body.sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });
    const result = await recordPunch({
      session: access.session,
      staff,
      type: body.type,
      location: body.location,
      clientTime: body.clientTime,
      clientId: body.clientId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, clock: result.view, duplicate: result.duplicate });
  } catch (err) {
    console.error("[team] punch error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
