import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { approveRequest, postAllUnstaffed, postSelected, postShift, unpostShift } from "@/lib/team/shifts-db";
import { isMarket } from "@/lib/team/markets";

// Admin open shift actions.
//   { action: "post", sessionId }      post the event's unfilled spots to its market
//   { action: "post_all", market? }    post every unstaffed upcoming event (in one market)
//   { action: "post_selected", sessionIds }  post the events ticked in Select mode
//   { action: "unpost", postId }
//   { action: "approve", postId, staffId }
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "post") {
      if (typeof body.sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
      const session = await getSubmittedSession(body.sessionId);
      if (!session) return NextResponse.json({ error: "We could not find that event." }, { status: 404 });
      const r = await postShift(session, staff);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, postId: r.postId, queued: r.plan.queued, sendAt: r.plan.sendAt, message: r.message });
    }
    if (body.action === "post_all") {
      return NextResponse.json({ ok: true, ...(await postAllUnstaffed(staff, isMarket(body.market) ? body.market : null)) });
    }
    if (body.action === "post_selected") {
      const r = await postSelected(staff, body.sessionIds);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json(r);
    }
    if (body.action === "unpost" || body.action === "approve") {
      if (typeof body.postId !== "string" || (body.action === "approve" && typeof body.staffId !== "string")) {
        return NextResponse.json({ error: "Bad request" }, { status: 400 });
      }
      const r = body.action === "unpost" ? await unpostShift(body.postId, staff) : await approveRequest(staff, body.postId, body.staffId);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[team] shifts error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
