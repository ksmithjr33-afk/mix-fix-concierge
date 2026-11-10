import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { approveRows, editPunch, reopenRow } from "@/lib/team/timesheet-db";
import { parseChicagoLocal } from "@/lib/team/timesheet";

// Admin timesheet actions.
//   { action: "edit", assignmentId, type: "in" | "out", at: "2026-12-12T17:05", reason }
//   { action: "approve", assignmentIds: [...] }
//   { action: "reopen", assignmentId, reason }
// Nobody edits, approves or reopens their own time: refused with a clear message.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "edit") {
      if (typeof body.assignmentId !== "string" || (body.type !== "in" && body.type !== "out")) {
        return NextResponse.json({ error: "Bad request" }, { status: 400 });
      }
      const r = await editPunch(staff, body.assignmentId, body.type, parseChicagoLocal(body.at), String(body.reason ?? ""));
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, rows: r.rows });
    }
    if (body.action === "approve") {
      const ids = Array.isArray(body.assignmentIds) ? body.assignmentIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 500) : [];
      if (ids.length === 0) return NextResponse.json({ error: "Nothing to approve." }, { status: 400 });
      const r = await approveRows(staff, ids);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, rows: r.rows, message: r.message });
    }
    if (body.action === "reopen") {
      if (typeof body.assignmentId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
      const r = await reopenRow(staff, body.assignmentId, String(body.reason ?? ""));
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, rows: r.rows, message: r.message });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[team] timesheet error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
