import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { canApproveReceipts, MANAGERS_CANNOT_APPROVE } from "@/lib/team/receipts";
import { isFullAdmin } from "@/lib/team/roles";
import { adminReceiptsView, reviewReceipt } from "@/lib/team/receipts-db";

// Reviewing a receipt: JSON { sessionId, action, id, reason? }. Admins only,
// never managers (checked here and again in reviewReceipt).
//   approve       staff paid: the linked reimbursement on Payroll; Company: a cost on the event
//   not_approve   reason required, shown to the staff member
//   reopen        back to Submitted, removing the linked reimbursement unless it is marked paid
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isFullAdmin(staff.role) || !canApproveReceipts(staff)) return NextResponse.json({ error: MANAGERS_CANNOT_APPROVE }, { status: 403 });
  try {
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const r = await reviewReceipt(staff, body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const session = typeof body.sessionId === "string" ? await getSubmittedSession(body.sessionId) : null;
    const receipts = session ? (await adminReceiptsView(session, staff, []))?.receipts : undefined;
    return NextResponse.json({ ok: true, ...(receipts ? { receipts } : {}) });
  } catch (err) {
    console.error("[receipts] review failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
