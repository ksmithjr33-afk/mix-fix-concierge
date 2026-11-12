import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { markPickedUp, savePickup, undoPickedUp } from "@/lib/team/menu-pickup-db";

// The cocktail menu pickup. POST { sessionId, action }:
//   "save" (admins): store, store_other, location_note, order_number, assignee_id, not_needed
//   "picked_up": the assigned person, or an admin
//   "undo" (admins): undo "Picked up"
// Every rule is checked on the server; Bartender view counts as a bartender.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = body.sessionId;
    if (typeof sessionId !== "string" || !sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (body.action === "picked_up") {
      const r = await markPickedUp(sessionId, staff);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, line: r.line });
    }
    if (body.action !== "save" && body.action !== "undo") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
    const r = body.action === "undo" ? await undoPickedUp(sessionId, staff) : await savePickup(sessionId, staff, body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, view: r.view });
  } catch (err) {
    console.error("[menu-pickup] error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
