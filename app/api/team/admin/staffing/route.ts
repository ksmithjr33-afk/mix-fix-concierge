import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { isAdminRole } from "@/lib/team/roles";
import { setBarbackNotBooked, setBartendersNeeded, setRoleNeeded } from "@/lib/team/staffing-fix-db";

// Staffing corrections with no price change, admins and managers only:
// { sessionId, action: "bartenders", value: 1..4 | null }
// { sessionId, action: "role_needed", role: "bar_back" | "event_helper" | "server", value: 0..4 }
// { sessionId, action: "barback_not_booked" } "A barback was not part of this booking"
// { sessionId, action: "barback_add_free" }   "Add the barback at no charge"
// Nothing here writes an update, a change order, a client text or a GHL update.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r =
      body.action === "bartenders"
        ? await setBartendersNeeded(body.sessionId, staff, body.value ?? null)
        : body.action === "role_needed"
          ? await setRoleNeeded(body.sessionId, staff, body.role, body.value)
        : body.action === "barback_not_booked"
          ? await setBarbackNotBooked(body.sessionId, staff, true)
          : body.action === "barback_add_free"
            ? await setBarbackNotBooked(body.sessionId, staff, false)
            : { ok: false as const, error: "Bad request", status: 400 };
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] staffing fix error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
