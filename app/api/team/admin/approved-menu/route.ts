import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { finishMenuUpload, setApprovedOn, startMenuUpload } from "@/lib/team/approved-menu-db";

// The approved menu, admins only. POST { action }:
//   "start"  { sessionId, type, size, name }: returns a one time upload link
//   "finish" { fileId, approvedOn }: checks the stored file and makes it current
//   "date"   { sessionId, approvedOn }: changes "Client approved on"
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.action === "start") {
      if (typeof b.sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
      const r = await startMenuUpload(staff, b.sessionId, { type: String(b.type ?? ""), size: Number(b.size ?? 0), name: String(b.name ?? "") });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, fileId: r.id, uploadUrl: r.uploadUrl });
    }
    if (b.action === "finish" && typeof b.fileId === "string") {
      const r = await finishMenuUpload(staff, b.fileId, b.approvedOn);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, view: r.view });
    }
    if (b.action === "date" && typeof b.sessionId === "string") {
      const r = await setApprovedOn(staff, b.sessionId, b.approvedOn);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, view: r.view });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[approved-menu] error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
