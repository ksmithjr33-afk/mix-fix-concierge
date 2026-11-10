import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { createAnnouncement } from "@/lib/team/announcements-db";

// An admin sends an announcement: { title, body, markets: string[], bartendersOnly, sendNow }.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const raw = await request.json().catch(() => ({}));
    const r = await createAnnouncement(staff, raw && typeof raw === "object" ? raw : {});
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, id: r.id, recipients: r.recipients, texted: r.texted, held: r.held });
  } catch (err) {
    console.error("[team] announcement error:", err);
    return NextResponse.json({ error: "Could not send. Try again." }, { status: 500 });
  }
}
