import { NextResponse } from "next/server";
import { cleanName, getCurrentStaff, saveStaffName } from "@/lib/team/auth";
import { saveProfile } from "@/lib/team/profile-db";

// Saves the staff member's own first and last name.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { first, last } = await request.json().catch(() => ({}));
    const name = cleanName(first, last);
    if (!name) return NextResponse.json({ error: "Enter your first and last name." }, { status: 400 });
    await saveStaffName(staff.id, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] profile error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}

// Saves a profile: { staffId?, first, last, email, home_address, dropoff_time, max_miles }.
// A bartender saves their own; admins save anyone's. Home address and email
// only ever come back to admins and the person themself.
export async function PATCH(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const staffId = typeof body.staffId === "string" && body.staffId ? body.staffId : staff.id;
    const r = await saveProfile(staff, staffId, body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, profile: r.profile });
  } catch (err) {
    console.error("[team] profile save error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
