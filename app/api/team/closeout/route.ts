import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { openEvent } from "@/lib/team/events";
import { submitCloseout } from "@/lib/team/closeout-db";

// The wrap up from a bartender on the event: how it went, guests, the supplies
// and equipment inventory, the leftover alcohol, anything we should know, and
// a required photo. Equipment photos come as equipPhoto:<item>. Every check,
// including that the sender is on the event, runs on the server.
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
        supplies: form.get("supplies"),
        equipment: form.get("equipment"),
        alcoholLeft: form.get("alcoholLeft"),
        alcoholNote: form.get("alcoholNote"),
      },
      photo: file,
      photoType: file ? file.type.toLowerCase() : "",
      equipmentPhotos: Object.fromEntries(
        [...form.entries()].filter(([k, v]) => k.startsWith("equipPhoto:") && v instanceof Blob && v.size > 0).map(([k, v]) => [k.slice("equipPhoto:".length), v as Blob])
      ),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, closeout: r.closeout });
  } catch (err) {
    console.error("[team] closeout error:", err);
    return NextResponse.json({ error: "Could not save. Tap Retry." }, { status: 500 });
  }
}
