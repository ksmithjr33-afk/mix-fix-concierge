import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { confirmDelivery, saveDelivery, saveDeliveryDeadline } from "@/lib/team/delivery-availability-db";

// Deliveries and pickups on the staff profile.
//   PATCH { staffId?, delivery_windows, home_type, handoff_pref, delivery_notes }  save (your own also confirms the week)
//   POST  { action: "confirm" }                                                     "Still correct for this week"
//   POST  { action: "deadline", day, time }                                         admins: the weekly deadline
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

export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "confirm") {
      const r = await confirmDelivery(staff);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, delivery: r.delivery });
    }
    if (body.action === "deadline") {
      const r = await saveDeliveryDeadline(staff, body);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, deadline: r.deadline, rule: r.rule });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[team] delivery error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
