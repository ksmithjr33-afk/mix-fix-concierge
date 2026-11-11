import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { markReviewed } from "@/lib/team/closeout-db";

// Mark a wrap up reviewed, admins only. Bartenders (and admins in Bartender
// view) get 403, signed out gets 401. { sessionId, closeoutId } returns the wrap up.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.sessionId !== "string" || typeof body.closeoutId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = await markReviewed(body.sessionId, body.closeoutId, staff);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, closeout: r.closeout });
  } catch (err) {
    console.error("[team] wrap up review error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
