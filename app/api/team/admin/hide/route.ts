import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { hideEvent, unhideEvent } from "@/lib/team/hidden";

async function setup(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return { error: NextResponse.json({ error: "Sign in again." }, { status: 401 }) };
  if (staff.role !== "admin") return { error: NextResponse.json({ error: "Admins only." }, { status: 403 }) };
  const { sessionId } = await request.json().catch(() => ({}));
  if (typeof sessionId !== "string") return { error: NextResponse.json({ error: "Bad request" }, { status: 400 }) };
  const session = await getSubmittedSession(sessionId);
  if (!session) return { error: NextResponse.json({ error: "We could not find that event." }, { status: 404 }) };
  return { staff, sessionId };
}

// Hide an event from the team portal. Nothing is deleted.
export async function POST(request: Request) {
  try {
    const s = await setup(request);
    if (s.error) return s.error;
    const result = await hideEvent(s.sessionId, s.staff);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] hide error:", err);
    return NextResponse.json({ error: "Could not hide. Try again." }, { status: 500 });
  }
}

// Unhide it.
export async function DELETE(request: Request) {
  try {
    const s = await setup(request);
    if (s.error) return s.error;
    await unhideEvent(s.sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] unhide error:", err);
    return NextResponse.json({ error: "Could not unhide. Try again." }, { status: 500 });
  }
}
