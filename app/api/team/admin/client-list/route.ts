import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { approveHold, declineHold, reviewAndSend } from "@/lib/client-list-actions";

// Held client shopping lists, admins only:
// { action: "approve" | "decline", sessionId, holdId } for a change held inside six days,
// { action: "review", sessionId, holdId } to send the first list of an event with a custom recipe.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const origin = new URL(request.url).origin;
    const r =
      body.action === "approve"
        ? await approveHold(staff, body.sessionId, body.holdId, origin)
        : body.action === "decline"
          ? await declineHold(staff, body.sessionId, body.holdId)
          : body.action === "review"
            ? await reviewAndSend(staff, body.sessionId, body.holdId)
            : { ok: false as const, error: "Bad request", status: 400 };
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, message: r.message });
  } catch (err) {
    console.error("[team] client list action error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
