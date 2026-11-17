import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { saveEventBusiness } from "@/lib/team/business-db";
import { isFullAdmin } from "@/lib/team/roles";

// The Business tab's entries for one event: { sessionId, action, ... }. Admins only, never managers.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.sessionId !== "string" || !body.sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const r = await saveEventBusiness(staff, body.sessionId, body);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (err) {
    console.error("[business] save failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
