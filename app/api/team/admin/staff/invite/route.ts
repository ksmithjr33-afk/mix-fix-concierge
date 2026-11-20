import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { resendInvite } from "@/lib/team/invites-db";
import { isAdminRole } from "@/lib/team/roles";

// Resend invite: the welcome text with the sign in link, admins and managers only.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const { id } = await request.json().catch(() => ({}));
    if (typeof id !== "string" || !id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const result = await resendInvite(staff, id, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, line: result.line, sentAt: result.sentAt });
  } catch (err) {
    console.error("[team] resend invite error:", err);
    return NextResponse.json({ error: "Could not send the invite. Try again." }, { status: 500 });
  }
}
