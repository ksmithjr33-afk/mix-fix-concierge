import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { recalculateMileage } from "@/lib/team/pay-db";
import { isAdminRole } from "@/lib/team/roles";

// Work one person's stored miles out again: { sessionId, staffId }. Driving
// miles from the Routes API (one call), straight line if that fails. Admins and managers.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff || !isAdminRole(staff.role)) return NextResponse.json({ error: "Admins and managers only." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.sessionId !== "string" || typeof body.staffId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const r = await recalculateMileage(staff, body.sessionId, body.staffId);
  return r.ok ? NextResponse.json({ ok: true, miles: r.miles, source: r.source, changed: r.changed }) : NextResponse.json({ error: r.error }, { status: r.status });
}
