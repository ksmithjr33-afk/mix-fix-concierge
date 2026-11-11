import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { setRate } from "@/lib/team/pay-db";

// Set or clear a staff member's hourly rate: { staffId, rate } in dollars. Admins only.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const { staffId, rate } = await request.json().catch(() => ({}));
  if (typeof staffId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const r = await setRate(staff, staffId, rate);
  return r.ok ? NextResponse.json({ ok: true, cents: r.cents }) : NextResponse.json({ error: r.error }, { status: r.status });
}
