import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { previewAdminEdit, saveAdminEdit } from "@/lib/team/admin-edit-db";

async function admin() {
  const staff = await getCurrentStaff();
  if (!staff) return { error: NextResponse.json({ error: "Sign in again." }, { status: 401 }) };
  if (staff.role !== "admin") return { error: NextResponse.json({ error: "Admins only." }, { status: 403 }) };
  return { staff };
}

// Admin edit of event details. { sessionId, changes, preview: true } returns the
// engine's price for the edit without saving. Otherwise { sessionId, changes,
// price: { mode, total }, version } saves it.
export async function POST(request: Request) {
  const a = await admin();
  if (a.error) return a.error;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (body.preview === true) {
      const r = await previewAdminEdit(body.sessionId, body.changes);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, preview: r.preview });
    }
    const r = await saveAdminEdit({
      sessionId: body.sessionId,
      admin: a.staff,
      changes: body.changes,
      price: body.price,
      expectedVersion: body.version,
      origin: new URL(request.url).origin,
      sendList: body.sendList,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, version: r.version });
  } catch (err) {
    console.error("[team] event edit error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
