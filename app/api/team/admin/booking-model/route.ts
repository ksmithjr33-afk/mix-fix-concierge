import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { setBookedOnAndModel } from "@/lib/booking-model-db";
import { isAdminRole } from "@/lib/team/roles";
import { todayIn, TZ } from "@/lib/team/time";

// Edit event, admins only. POST { sessionId, booked_on: "YYYY-MM-DD", pricing_model }.
// Changing the model changes staff pay and the price breakdown; the form confirms first.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.sessionId !== "string" || !b.sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const r = await setBookedOnAndModel(b.sessionId, b, { id: staff.id, name: staff.name }, todayIn(TZ));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (err) {
    console.error("[booking-model] save failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
