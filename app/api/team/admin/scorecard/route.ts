import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { isAdminRole } from "@/lib/team/roles";
import { addReview, editReview, saveCall, saveLock, saveRating, saveTierSettings, setManualSigned, setPayrollDone } from "@/lib/team/scorecard-db";

// Scorecard saves: POST { action, ... }. Admins and managers only (403 for
// anyone else), and never about the person saving (checked in scorecard-db).
//   rate { sessionId, staffId, marks, markNotes, clientFeedback, adminNotes }
//   review_add { staffId, kind, date, body }
//   review_edit { id, kind, date, body }       the author, or an admin
//   call { sessionId, staffId, done, outcome, confidence, notes }
//   lock { sessionId, locked }
//   payroll { staffId, done }                   admins only
//   manual { staffId, done }                    admins only (Manual signed)
//   settings { window, aceAvg, ... }            admins only
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins and managers only." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reply = (r: { ok: true } | { ok: false; error: string; status: number }) => (r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status }));
  try {
    if (body.action === "rate") return reply(await saveRating(staff, body));
    if (body.action === "review_add") return reply(await addReview(staff, body));
    if (body.action === "review_edit") return reply(await editReview(staff, body));
    if (body.action === "call") return reply(await saveCall(staff, body));
    if (body.action === "lock") return reply(await saveLock(staff, body));
    if (body.action === "payroll") return reply(await setPayrollDone(staff, body));
    if (body.action === "manual") return reply(await setManualSigned(staff, body));
    if (body.action === "settings") return reply(await saveTierSettings(staff, body));
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[scorecard] save failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
