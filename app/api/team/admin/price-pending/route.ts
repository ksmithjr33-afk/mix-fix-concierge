import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { setPendingPrice } from "@/lib/price-pending-db";

// Price needed, admins only. POST { sessionId, total }: sets the new total for
// an event whose saved change could not be priced, clears price pending, and
// sends the normal change order update to GHL.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.sessionId !== "string" || !b.sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const r = await setPendingPrice(b.sessionId, b.total, staff);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, total: r.total, amount: r.amount });
  } catch (err) {
    console.error("[price-pending] set price failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
