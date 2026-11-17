import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { finishAgreementUpload, labelAgreement, removeAgreement, startAgreementUpload } from "@/lib/team/agreements-db";
import { isAdminRole } from "@/lib/team/roles";

// Client agreements, admins and managers only (they carry pricing). POST { action }:
//   "start"  { sessionId, type, size, name, label?, replaces? }: a one time upload link
//   "finish" { fileId }: checks the stored file and makes it current
//   "label"  { fileId, label }
//   "remove" { fileId }
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.action === "start" && typeof b.sessionId === "string") {
      const r = await startAgreementUpload(staff, b.sessionId, { type: String(b.type ?? ""), size: Number(b.size ?? 0), name: String(b.name ?? "") }, { label: b.label, replaces: b.replaces });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, fileId: r.id, uploadUrl: r.uploadUrl });
    }
    const fileId = typeof b.fileId === "string" ? b.fileId : "";
    const r =
      b.action === "finish" && fileId ? await finishAgreementUpload(staff, fileId)
      : b.action === "label" && fileId ? await labelAgreement(staff, fileId, b.label)
      : b.action === "remove" && fileId ? await removeAgreement(staff, fileId)
      : null;
    if (!r) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, agreements: r.agreements });
  } catch (err) {
    console.error("[agreements] error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
