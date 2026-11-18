import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSession } from "@/lib/event-updates";
import { isAdminRole } from "@/lib/team/roles";
import { staffBookingAction } from "@/lib/partners/actions";
import type { EventSession } from "@/lib/partners/db";

// The event's Booking card: who holds the booking, the host, planners, and the client's pricing switch.
export async function POST(request: Request) {
  try {
    const staff = await getCurrentStaff();
    if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins and managers only." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const s = typeof body.sessionId === "string" ? ((await getSession(body.sessionId)) as EventSession | null) : null;
    if (!s) return NextResponse.json({ error: "We could not find that event." }, { status: 404 });
    const r = await staffBookingAction(staff, s, body);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (err) {
    console.error("[partners] booking card error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
