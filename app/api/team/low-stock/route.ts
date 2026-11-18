import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { openEvent } from "@/lib/team/events";
import { listReports, submitReport } from "@/lib/team/low-stock-db";

// Running low. GET: the reports this person may see (staff: only their own;
// admins and managers: everyone's). POST: a new report, from the event page
// (sessionId, checked: the person is on the event) or the Me page (no event).
export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  return NextResponse.json({ reports: await listReports(staff) });
}

export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const { sessionId, item, level, note } = body as Record<string, unknown>;
    let session = null;
    if (typeof sessionId === "string" && sessionId) {
      const access = await openEvent(sessionId, staff);
      if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });
      session = access.session;
    }
    const r = await submitReport(staff, session, { item, level, note });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, id: r.id, kind: r.kind, updated: r.updated });
  } catch (err) {
    console.error("[team] running low error:", err);
    return NextResponse.json({ error: "Could not send. Text us at 469 754 8512." }, { status: 500 });
  }
}
