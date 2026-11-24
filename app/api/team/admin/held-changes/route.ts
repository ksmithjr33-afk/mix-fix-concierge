import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { isAdminRole } from "@/lib/team/roles";
import { notifyTeam, skipNotify } from "@/lib/team/held-changes-db";

// Changes not sent to the team, admins and managers:
//   { sessionId, action: "notify" }  one text to everyone on the event listing every held change
//   { sessionId, action: "skip" }    Do not notify: the changes stay saved, nobody is texted
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins and managers only." }, { status: 403 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = body.action === "notify" ? await notifyTeam(staff, sessionId, new URL(request.url).origin) : body.action === "skip" ? await skipNotify(staff, sessionId) : null;
    if (!r) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (err) {
    console.error("[held changes] error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
