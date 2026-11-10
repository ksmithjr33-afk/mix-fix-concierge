import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { cancelHandoff, respondHandoff, startHandoff } from "@/lib/team/shifts-db";

// Shift handoffs, bartender side.
//   { action: "start", sessionId, mode: "teammate" | "market", reason, teammateId? }
//   { action: "cancel", handoffId }                 the bartender giving it up
//   { action: "accept" | "decline", handoffId }     the named teammate
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "start") {
      if (typeof body.sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
      const session = await getSubmittedSession(body.sessionId);
      if (!session) return NextResponse.json({ error: "We could not find that event." }, { status: 404 });
      const r = await startHandoff(session, staff, { mode: body.mode, reason: body.reason, teammateId: body.teammateId });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, handoffId: r.handoffId });
    }
    if (typeof body.handoffId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (body.action === "cancel") {
      const r = await cancelHandoff(body.handoffId, staff);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "accept" || body.action === "decline") {
      const r = await respondHandoff(body.handoffId, staff, body.action);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[team] handoff error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
