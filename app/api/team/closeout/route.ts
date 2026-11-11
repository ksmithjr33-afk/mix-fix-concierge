import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { openEvent } from "@/lib/team/events";
import { submitCloseout } from "@/lib/team/closeout-db";

// Post event closeout from a bartender on the event: how it went, guests,
// issues, broken or missing gear, leftovers, and a required photo.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const form = await request.formData().catch(() => null);
    const sessionId = form?.get("sessionId");
    if (!form || typeof sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const access = await openEvent(sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });

    const photo = form.get("photo");
    const file = photo instanceof Blob && photo.size > 0 ? photo : null;
    const r = await submitCloseout({
      sessionId,
      staff,
      raw: {
        rating: form.get("rating"),
        guests: form.get("guests"),
        issues: form.get("issues"),
        gear: form.getAll("gear").map(String),
        gearNote: form.get("gearNote"),
        leftover: form.get("leftover"),
      },
      photo: file,
      photoType: file ? file.type.toLowerCase() : "",
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, closeout: r.closeout });
  } catch (err) {
    console.error("[team] closeout error:", err);
    return NextResponse.json({ error: "Could not save. Tap Retry." }, { status: 500 });
  }
}
