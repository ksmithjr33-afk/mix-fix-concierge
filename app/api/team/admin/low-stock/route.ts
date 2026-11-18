import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { isAdminRole } from "@/lib/team/roles";
import { resolveReport, takeReport } from "@/lib/team/low-stock-db";

// Running low, admins and managers only: "On it" (take it, text the person
// who reported it) and "Resolved" (close it).
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Only admins and managers can do that." }, { status: 403 });
  try {
    const { id, action } = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof id !== "string" || (action !== "on_it" && action !== "resolve")) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = action === "on_it" ? await takeReport(staff, id) : await resolveReport(staff, id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, report: r.report });
  } catch (err) {
    console.error("[team] running low action error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
