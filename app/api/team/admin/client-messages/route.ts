import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { turnOnClientMessages } from "@/lib/manual-event-db";
import { isAdminRole } from "@/lib/team/roles";

// "Turn on client messages" on a calendar only event, admins and managers only.
// POST { sessionId }: clears calendar_only and sends the normal intake payload once.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.sessionId !== "string" || !body.sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = await turnOnClientMessages(staff, body.sessionId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (err) {
    console.error("[team] client messages error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
