import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { addUnavailable, removeUnavailable } from "@/lib/team/availability-db";

// A staff member's own unavailable dates.
//   POST   { start, end?, note? }  mark a date or range unavailable
//   DELETE { id }                  remove one (days before today are kept)
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const r = await addUnavailable(staff, body && typeof body === "object" ? body : {});
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, id: r.row.id, warnings: r.warnings });
  } catch (err) {
    console.error("[team] availability error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { id } = await request.json().catch(() => ({}));
    if (typeof id !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = await removeUnavailable(staff, id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] availability error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
