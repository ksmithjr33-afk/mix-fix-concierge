import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { isAdminRole } from "@/lib/team/roles";
import { photoTypeOf } from "@/lib/team/venue-photos";
import {
  addVenuePhoto,
  deleteVenuePhoto,
  hidePastPhoto,
  keepBarPhoto,
  reorderVenuePhotos,
  setVenueCaption,
  venuePhotosFor,
  VenuePhotoError,
} from "@/lib/team/venue-photos-db";

// Bar and venue photos on the Location card, admins and managers only.
// Form fields: sessionId, action (add, caption, reorder, delete, hide, show,
// keep), and per action: photo + caption, photoId + caption, ids (JSON list),
// photoId, or reportId. Answers with the card's photos after the change.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const form = await request.formData().catch(() => null);
    const sessionId = form?.get("sessionId");
    if (!form || typeof sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const session = await getSubmittedSession(sessionId);
    if (!session) return NextResponse.json({ error: "We could not find that event." }, { status: 404 });

    const action = String(form.get("action") ?? "");
    const photoId = form.get("photoId");
    switch (action) {
      case "add": {
        const photo = form.get("photo");
        if (!(photo instanceof Blob)) return NextResponse.json({ error: "Add a photo." }, { status: 400 });
        const name = photo instanceof File ? photo.name : "";
        await addVenuePhoto({ session, staff, file: { blob: photo, type: photoTypeOf(photo.type, name) }, caption: form.get("caption") });
        break;
      }
      case "caption":
        await setVenueCaption(sessionId, staff, photoId, form.get("caption"));
        break;
      case "reorder": {
        let ids: unknown = null;
        try {
          ids = JSON.parse(String(form.get("ids") ?? ""));
        } catch {
          ids = null;
        }
        await reorderVenuePhotos(sessionId, staff, ids);
        break;
      }
      case "delete":
        await deleteVenuePhoto(sessionId, staff, photoId);
        break;
      case "hide":
      case "show":
        await hidePastPhoto(session, staff, photoId, action === "hide");
        break;
      case "keep":
        await keepBarPhoto(session, staff, form.get("reportId"));
        break;
      default:
        return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, view: await venuePhotosFor(session, staff, null) });
  } catch (err) {
    if (err instanceof VenuePhotoError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[team] venue photos error:", err);
    return NextResponse.json({ error: "That did not save. Try again." }, { status: 500 });
  }
}
