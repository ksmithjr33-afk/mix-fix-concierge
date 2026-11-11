import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { firstName } from "@/lib/team/event-view";
import { applySheetAction } from "@/lib/order-sheet-db";

// Order sheet edits, admins only. Bartenders (and admins in Bartender view)
// get 403, signed out gets 401. { sessionId, action, ... } returns the sheet as it now stands.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const session = await getSubmittedSession(body.sessionId);
    if (!session) return NextResponse.json({ error: "We could not find that event." }, { status: 404 });
    const r = await applySheetAction(session, { id: staff.id, name: firstName(staff.name) }, body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, view: r.view });
  } catch (err) {
    console.error("[team] order sheet error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
