import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { markAllPaid, markPaid, markWeekPaid, undoPaid } from "@/lib/team/payroll-db";
import { addReimbursement, editReimbursement, removeReimbursement } from "@/lib/team/reimbursements-db";
import { rangePeriod } from "@/lib/team/payroll";
import { isFullAdmin } from "@/lib/team/roles";

// Payroll: POST { action, ... }. Admins only, never managers.
//   mark { assignmentId, paidOn?, note? }         one line
//   mark_all { staffId, from, to, paidOn?, note? } every payable line for a person
//   mark_week { from, to, note? }                  every payable line in a pay week, the Monday pay date
//   undo { assignmentId }
//   add_reimbursement { assignmentId, kind, amount, note? }
//   edit_reimbursement { id, kind, amount, note? }
//   remove_reimbursement { id }
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reply = (r: { ok: true } | { ok: false; error: string; status: number }, extra: Record<string, unknown> = {}) =>
    r.ok ? NextResponse.json({ ok: true, ...extra }) : NextResponse.json({ error: r.error }, { status: r.status });
  try {
    if (body.action === "mark") return reply(await markPaid(staff, body));
    if (body.action === "mark_all" || body.action === "mark_week") {
      const period = rangePeriod(body.from, body.to);
      if (!period) return NextResponse.json({ error: "Pick a pay period." }, { status: 400 });
      const r = body.action === "mark_all" ? await markAllPaid(staff, { staffId: body.staffId, period, paidOn: body.paidOn, note: body.note }) : await markWeekPaid(staff, { period, note: body.note });
      return r.ok ? NextResponse.json({ ok: true, marked: r.marked, skipped: r.skipped }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    if (body.action === "undo") return reply(await undoPaid(staff, body));
    if (body.action === "add_reimbursement") return reply(await addReimbursement(staff, body));
    if (body.action === "edit_reimbursement") return reply(await editReimbursement(staff, body));
    if (body.action === "remove_reimbursement") return reply(await removeReimbursement(staff, body));
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[payroll] save failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
