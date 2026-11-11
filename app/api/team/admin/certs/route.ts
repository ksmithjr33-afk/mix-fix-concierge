import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { reviewCert, setCertsEnforced } from "@/lib/team/certs-db";

// Admins: { action: "review", id, decision: "approve" | "reject", note } or { action: "enforce", on }.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "enforce" && typeof body.on === "boolean") {
      const r = await setCertsEnforced(staff, body.on);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    if (body.action === "review" && typeof body.id === "string" && (body.decision === "approve" || body.decision === "reject")) {
      const r = await reviewCert(staff, body.id, body.decision, body.note);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[team] admin certs error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
