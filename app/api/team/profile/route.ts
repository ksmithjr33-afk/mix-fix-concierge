import { NextResponse } from "next/server";
import { cleanName, getCurrentStaff, saveStaffName } from "@/lib/team/auth";

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
