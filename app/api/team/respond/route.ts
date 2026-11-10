import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { respondToAssignment } from "@/lib/team/assignments-db";

// Accept or decline an event. Only the staff member it was offered to.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { sessionId, response } = await request.json().catch(() => ({}));
    if (typeof sessionId !== "string" || (response !== "accept" && response !== "decline")) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const result = await respondToAssignment(sessionId, staff, response, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, status: response === "accept" ? "accepted" : "declined" });
  } catch (err) {
    console.error("[team] respond error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
