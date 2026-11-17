import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { setMileageOverride } from "@/lib/team/pay-db";
import { isAdminRole } from "@/lib/team/roles";

// Adjust mileage for one person on one event: { sessionId, staffId, miles, amount, note }.
// Miles are one way; amount is dollars. Both blank clears the adjustment. Admins and managers.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff || !isAdminRole(staff.role)) return NextResponse.json({ error: "Admins and managers only." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.sessionId !== "string" || typeof body.staffId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const r = await setMileageOverride(staff, body.sessionId, body.staffId, body);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
