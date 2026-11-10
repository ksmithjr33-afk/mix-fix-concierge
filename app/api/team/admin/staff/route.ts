import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { createStaff, updateStaff } from "@/lib/team/assignments-db";

async function admin() {
  const staff = await getCurrentStaff();
  if (!staff) return { error: NextResponse.json({ error: "Sign in again." }, { status: 401 }) };
  if (staff.role !== "admin") return { error: NextResponse.json({ error: "Admins only." }, { status: 403 }) };
  return { staff };
}

// Add a staff member.
export async function POST(request: Request) {
  const a = await admin();
  if (a.error) return a.error;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await createStaff(body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, staff: result.staff });
  } catch (err) {
    console.error("[team] staff create error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}

// Edit, deactivate, reactivate, or turn alerts on or off.
export async function PATCH(request: Request) {
  const a = await admin();
  if (a.error) return a.error;
  try {
    const { id, ...patch } = await request.json().catch(() => ({}));
    if (typeof id !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const result = await updateStaff(a.staff, id, patch);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, staff: result.staff });
  } catch (err) {
    console.error("[team] staff update error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
