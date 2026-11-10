import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getAssignment, openEvent } from "@/lib/team/events";
import { barReadyEntries, submitBarReady } from "@/lib/team/bar-ready-db";
import { canSubmitBarReady, validateBarReady } from "@/lib/team/bar-ready";
import { eventData } from "@/lib/team/markets";

// "Bar is ready": a photo of the bar setup (required) and an optional note.
// Only assigned staff and admins, from arrival time on the event day.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const form = await request.formData().catch(() => null);
    const sessionId = form?.get("sessionId");
    if (!form || typeof sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });

    const access = await openEvent(sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });
    const assignment = staff.role === "admin" ? null : await getAssignment(sessionId, staff.id);
    if (!canSubmitBarReady(staff, assignment, eventData(access.session))) {
      return NextResponse.json({ error: "The bar check in opens at arrival time on the event day." }, { status: 403 });
    }

    const photo = form.get("photo");
    const file = photo instanceof Blob ? photo : null;
    const valid = validateBarReady(file ? { type: file.type, size: file.size } : null, form.get("note"));
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

    await submitBarReady({
      session: access.session,
      staff,
      photo: file!,
      photoType: file!.type.toLowerCase(),
      note: valid.note,
      eventLink: new URL(`/team/e/${sessionId}`, request.url).toString(),
    });
    return NextResponse.json({ ok: true, entries: await barReadyEntries(sessionId, staff) });
  } catch (err) {
    console.error("[team] bar-ready error:", err);
    return NextResponse.json({ error: "The photo did not upload. Tap Retry." }, { status: 500 });
  }
}
