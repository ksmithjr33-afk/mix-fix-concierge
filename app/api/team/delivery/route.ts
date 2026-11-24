import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { saveDelivery } from "@/lib/team/delivery-availability-db";

// Usual order windows on the staff profile (optional; they prefill each event's Order window).
//   PATCH { staffId?, delivery_windows, home_type, handoff_pref, delivery_notes }  save
export async function PATCH(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const staffId = typeof body.staffId === "string" && body.staffId ? body.staffId : staff.id;
    const r = await saveDelivery(staff, staffId, body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, delivery: r.delivery });
  } catch (err) {
    console.error("[team] delivery save error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
