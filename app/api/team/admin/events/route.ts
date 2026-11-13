import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { addManualEvent } from "@/lib/manual-event-db";

// Add an event by hand, admins only. The body is the Add event form, with
// mode "confirmed" (Save as a confirmed event) or "link" (Save and send the
// client the concierge link), and confirm_duplicate after the same client
// email and date warning.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const r = await addManualEvent(staff, body);
    if (!r.ok) return NextResponse.json({ error: r.error, duplicate: r.duplicate ?? null }, { status: r.status });
    return NextResponse.json(r);
  } catch (err) {
    console.error("[team] add event error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
