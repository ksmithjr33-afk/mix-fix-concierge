import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { assignStaff, removeStaff } from "@/lib/team/assignments-db";

async function setup(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return { error: NextResponse.json({ error: "Sign in again." }, { status: 401 }) };
  if (staff.role !== "admin") return { error: NextResponse.json({ error: "Admins only." }, { status: 403 }) };
  const { sessionId, staffId, confirmUnavailable } = await request.json().catch(() => ({}));
  if (typeof sessionId !== "string" || typeof staffId !== "string") return { error: NextResponse.json({ error: "Bad request" }, { status: 400 }) };
  const session = await getSubmittedSession(sessionId);
  if (!session) return { error: NextResponse.json({ error: "We could not find that event." }, { status: 404 }) };
  return { staff, session, staffId, confirmUnavailable: confirmUnavailable === true };
}

// Assign a staff member to an event. They get a text to accept or decline.
export async function POST(request: Request) {
  try {
    const s = await setup(request);
    if (s.error) return s.error;
    const result = await assignStaff(s.session, s.staffId, s.staff, new URL(request.url).origin, { confirmUnavailable: s.confirmUnavailable });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] assign error:", err);
    return NextResponse.json({ error: "Could not assign. Try again." }, { status: 500 });
  }
}

// Take a staff member off an event. They get a text.
export async function DELETE(request: Request) {
  try {
    const s = await setup(request);
    if (s.error) return s.error;
    const result = await removeStaff(s.session, s.staffId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] remove error:", err);
    return NextResponse.json({ error: "Could not remove. Try again." }, { status: 500 });
  }
}
