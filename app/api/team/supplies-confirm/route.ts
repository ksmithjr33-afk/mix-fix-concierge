import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { isPlanning, PLANNING_PLACEHOLDER } from "@/lib/planning";
import { openEvent } from "@/lib/team/events";
import { confirmSupplies } from "@/lib/team/prep-db";

// "I have gone through the supplies list" (step 2). Any time, Tools done or not;
// anything left unchecked is reported missing to admins and managers.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { sessionId } = await request.json().catch(() => ({}));
    if (typeof sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const access = await openEvent(sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });
    if (isPlanning(access.session)) return NextResponse.json({ error: PLANNING_PLACEHOLDER }, { status: 409 });
    const r = await confirmSupplies(access.session, staff, new URL(request.url).origin);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, confirmedAt: r.confirmedAt, missing: r.missing });
  } catch (err) {
    console.error("[team] supplies confirm error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
