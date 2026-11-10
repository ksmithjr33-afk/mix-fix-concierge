import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { openEvent, saveCheck } from "@/lib/team/events";

export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { sessionId, list, key, checked } = await request.json();
    if (typeof sessionId !== "string" || (list !== "checklist" && list !== "shopping") || typeof key !== "string") {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const access = await openEvent(sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });
    const saved = await saveCheck(access.session, staff, list, key, checked === true);
    if (!saved) return NextResponse.json({ error: "That item is no longer on the list. Reload the page." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] checks error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
