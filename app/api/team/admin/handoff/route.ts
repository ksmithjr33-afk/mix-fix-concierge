import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { approveHandoff, declineHandoff } from "@/lib/team/shifts-db";

// An admin approves the teammate who accepted a handoff, or declines the handoff: { action, handoffId }.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const { action, handoffId } = await request.json().catch(() => ({}));
    if (typeof handoffId !== "string" || (action !== "approve" && action !== "decline")) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const r = action === "approve" ? await approveHandoff(handoffId, staff) : await declineHandoff(handoffId, staff);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] admin handoff error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
