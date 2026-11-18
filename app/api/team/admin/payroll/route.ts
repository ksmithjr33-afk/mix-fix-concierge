import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { markAllPaid, markPaid, undoPaid } from "@/lib/team/payroll-db";
import { periodFor } from "@/lib/team/payroll";
import { chicagoToday } from "@/lib/team/time";
import { isFullAdmin } from "@/lib/team/roles";

// Payroll paid marks: POST { action: "mark" | "mark_all" | "undo", ... }. Admins only, never managers.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "mark") {
      const r = await markPaid(staff, body);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    if (body.action === "mark_all") {
      const period = periodFor("custom", chicagoToday(), body.from, body.to);
      if (period.from !== body.from || period.to !== body.to) return NextResponse.json({ error: "Pick a pay period." }, { status: 400 });
      const r = await markAllPaid(staff, { staffId: body.staffId, period, paidOn: body.paidOn, note: body.note });
      return r.ok ? NextResponse.json({ ok: true, marked: r.marked, skipped: r.skipped }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    if (body.action === "undo") {
      const r = await undoPaid(staff, body);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[payroll] save failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
