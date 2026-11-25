import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { isAdminRole } from "@/lib/team/roles";
import { getTeamSession } from "@/lib/team/events";
import { startOffers } from "@/lib/team/scorecard-offers-db";
import { confirmHeld, pauseRun, releaseHeld, resumeRun, skipStep, stopRun } from "@/lib/team/offers-db";

// Shift offers on an event's Team tab: POST { action, ... }. Admins and managers.
//   start { sessionId }      send offers (Suggest's one tap)
//   pause { runId } / resume { runId } / stop { runId }
//   skip { stepId }          skip one person
//   confirm { stepId }       put someone who accepted and is waiting on the event
//   release { stepId }       let the spot go back to offers
// Assigning by hand is the existing Assign button; it ends offers for that spot.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins and managers only." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reply = (r: { ok: true } | { ok: false; error: string; status: number }) => (r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status }));
  try {
    if (body.action === "start") {
      const session = typeof body.sessionId === "string" ? await getTeamSession(body.sessionId) : null;
      if (!session) return NextResponse.json({ error: "We could not find that event." }, { status: 404 });
      return reply(await startOffers(staff, session));
    }
    if (body.action === "pause") return reply(await pauseRun(staff, body.runId));
    if (body.action === "resume") return reply(await resumeRun(staff, body.runId));
    if (body.action === "stop") return reply(await stopRun(staff, body.runId));
    if (body.action === "skip") return reply(await skipStep(staff, body.stepId));
    if (body.action === "confirm") return reply(await confirmHeld(staff, body.stepId));
    if (body.action === "release") return reply(await releaseHeld(staff, body.stepId));
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[offers] admin action failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
