import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { setEventMarket } from "@/lib/team/markets-db";

// An admin sets an event's market: { sessionId, market }.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const { sessionId, market } = await request.json().catch(() => ({}));
    if (typeof sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = await setEventMarket(sessionId, market, staff);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, market: r.market });
  } catch (err) {
    console.error("[team] market error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
