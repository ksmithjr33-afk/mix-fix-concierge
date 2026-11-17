import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { saveBusinessSettings } from "@/lib/team/business-settings-db";
import { isFullAdmin } from "@/lib/team/roles";

// Business settings: { which: "mileage" | "costs", ...fields }. Admins only, never managers.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff || !isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const r = await saveBusinessSettings(staff, body.which, body);
  return r.ok ? NextResponse.json({ ok: true, value: r.value }) : NextResponse.json({ error: r.error }, { status: r.status });
}
