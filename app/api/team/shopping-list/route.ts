import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { saveAnswer } from "@/lib/team/staff-list-db";

// The staff "Shopping list for this event": { sessionId, ref, answer?, note? }.
// answer "have" or "out", null to undo; note up to 80 characters. Only people
// who accepted the event, until it is over. Never changes the line itself.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const session = await getSubmittedSession(body.sessionId);
    if (!session) return NextResponse.json({ error: "We could not find that event." }, { status: 404 });
    const r = await saveAnswer(session, staff, { ref: body.ref, answer: body.answer, note: body.note });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, view: r.view });
  } catch (err) {
    console.error("[team] shopping list answer error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
