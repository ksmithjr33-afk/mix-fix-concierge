import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { saveOrderWindow } from "@/lib/team/order-window-db";

// The Order window item on an event: the person's own answer.
//   POST { sessionId, method: "delivery" | "pickup", windows: [{ date, from, to }], note }
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.sessionId !== "string" || !body.sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const session = await getSubmittedSession(body.sessionId);
    if (!session) return NextResponse.json({ error: "We could not find that event." }, { status: 404 });
    const r = await saveOrderWindow(session, staff, body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, view: r.view });
  } catch (err) {
    console.error("[team] order window error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
