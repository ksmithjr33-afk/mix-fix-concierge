import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { respondToOffer } from "@/lib/team/offers-db";

// A staff member answers a shift offer sent to them: POST { stepId, response: "accept" | "decline" | "withdraw" }.
// "accept" requests the shift: it waits for an admin or manager to approve.
// The answer says only what happened to them, never anything about other people.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.stepId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = await respondToOffer(body.stepId, staff, body.response);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, state: r.state });
  } catch (err) {
    console.error("[offers] answer failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
