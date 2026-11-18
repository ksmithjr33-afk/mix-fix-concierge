import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { assignmentRef } from "@/lib/team/clock-db";
import { photoTypeOf } from "@/lib/team/venue-photos";
import { canManageReceipts } from "@/lib/team/receipts";
import { adminReceiptsView, deleteReceipt, saveReceipt, staffReceiptsView, uploadReceiptPhoto, type Result } from "@/lib/team/receipts-db";

// Receipts on one event, for staff on it and for admins and managers.
//   multipart: sessionId, action "photo", photo      one photo; answers { path }
//   JSON { sessionId, action: "save", id?, kind, amount, note?, photos, payer?, confirmDuplicate? }
//   JSON { sessionId, action: "delete", id }
// Every rule (who, which event, only their own, only while Submitted, until
// 14 days after the event) is checked in lib/team/receipts-db.ts. Answers with
// the receipts this person may see on the event after the change.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const multipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");
    const form = multipart ? await request.formData().catch(() => null) : null;
    const body = multipart ? null : ((await request.json().catch(() => null)) as Record<string, unknown> | null);
    const sessionId = form ? form.get("sessionId") : body?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const session = await getSubmittedSession(sessionId);
    if (!session) return NextResponse.json({ error: "We could not find that event." }, { status: 404 });
    const assignment = await assignmentRef(sessionId, staff.id);

    const fail = (r: Extract<Result, { ok: false }>) => NextResponse.json({ error: r.error, duplicate: r.duplicate ?? false }, { status: r.status });
    if (form) {
      if (form.get("action") !== "photo") return NextResponse.json({ error: "Bad request" }, { status: 400 });
      const photo = form.get("photo");
      if (!(photo instanceof Blob)) return NextResponse.json({ error: "Add a photo of the receipt." }, { status: 400 });
      const name = photo instanceof File ? photo.name : "";
      const r = await uploadReceiptPhoto(session, staff, assignment, { blob: photo, type: photoTypeOf(photo.type, name) });
      return r.ok ? NextResponse.json({ ok: true, path: r.path }) : fail(r);
    }

    const action = body?.action;
    const r = action === "save" ? await saveReceipt(session, staff, assignment, body!) : action === "delete" ? await deleteReceipt(session, staff, assignment, body!.id) : null;
    if (!r) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (!r.ok) return fail(r);
    const receipts = canManageReceipts(staff) ? (await adminReceiptsView(session, staff, []))?.receipts : (await staffReceiptsView(session, staff, assignment))?.receipts;
    return NextResponse.json({ ok: true, receipts: receipts ?? [] });
  } catch (err) {
    console.error("[receipts] save failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
