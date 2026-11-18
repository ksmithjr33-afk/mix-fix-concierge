import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { deleteDraft, saveDraft, sendDraft, testDraft } from "@/lib/team/announcement-drafts-db";
import { isAdminRole } from "@/lib/team/roles";

// Announcement drafts, admins and managers only. POST { action, ... }:
//   "save"   { id, title, body, audience, markets, bartendersOnly, sendNow, attachmentId, baseUpdatedAt, force }
//   "send"   { id, baseUpdatedAt, confirmOthers }
//   "test"   { id }  texts the person asking, nobody else
//   "delete" { id }
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const raw = await request.json().catch(() => ({}));
    const b: Record<string, unknown> = raw && typeof raw === "object" ? raw : {};
    const r =
      b.action === "save"
        ? await saveDraft(staff, b)
        : b.action === "send"
          ? await sendDraft(staff, b)
          : b.action === "test"
            ? await testDraft(staff, b.id)
            : b.action === "delete"
              ? await deleteDraft(staff, b.id)
              : ({ ok: false, error: "Bad request", status: 400 } as const);
    if (!r.ok) {
      const { ok: _ok, status, ...rest } = r;
      void _ok;
      return NextResponse.json(rest, { status });
    }
    const { ok: _ok, ...rest } = r;
    void _ok;
    return NextResponse.json({ ok: true, ...rest });
  } catch (err) {
    console.error("[team] announcement draft error:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
