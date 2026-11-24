import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { confirmPriceCheck } from "@/lib/price-check-db";
import { isAdminRole } from "@/lib/team/roles";

// Price needs a check, admins only. POST { sessionId, model }: confirms the
// event's pricing model ("gratuity" or "service_fee") and clears the flag.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.sessionId !== "string" || !b.sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const r = await confirmPriceCheck(b.sessionId, b.model, { id: staff.id, name: staff.name });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, model: r.model });
  } catch (err) {
    console.error("[price-check] confirm failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
