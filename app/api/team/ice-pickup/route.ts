import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { assignIce, iceInstead, markIce, removeIce, saveIce, undoIce } from "@/lib/team/ice-pickup-db";

// The ice pickup. POST { sessionId, action }:
//   "save" (admins): location_name, location_address, total_bags, notes
//   "assign" (admins): staffId, bags (adds the person, or changes their bags)
//   "remove" (admins): staffId
//   "undo" (admins): staffId
//   "picked_up": location, bags; the person themselves, or an admin with staffId
//   "instead": location, bags, coveringFor (a staff id still not picked up, or
//     blank for "Nobody, this is extra"); someone on the event who is not
//     picking up ice
// Every rule is checked on the server; Bartender view counts as a bartender.
const ADMIN_ACTIONS = new Set(["save", "assign", "remove", "undo"]);

export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = body.sessionId;
    const action = String(body.action ?? "");
    if (typeof sessionId !== "string" || !sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (ADMIN_ACTIONS.has(action) && staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
    const r =
      action === "save" ? await saveIce(sessionId, staff, body)
      : action === "assign" ? await assignIce(sessionId, staff, body.staffId, body.bags)
      : action === "remove" ? await removeIce(sessionId, staff, body.staffId)
      : action === "undo" ? await undoIce(sessionId, staff, body.staffId)
      : action === "picked_up" ? await markIce(sessionId, staff, body)
      : action === "instead" ? await iceInstead(sessionId, staff, body)
      : null;
    if (!r) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, view: r.view });
  } catch (err) {
    console.error("[ice-pickup] error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
