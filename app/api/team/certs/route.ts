import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { uploadCert } from "@/lib/team/certs-db";

// Upload a certification: a photo or PDF and the expiry date. A bartender
// uploads their own; an admin may pass staffId to enter one for someone else.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const target = form.get("staffId");
    const file = form.get("file");
    const blob = file instanceof Blob && file.size > 0 ? file : null;
    const r = await uploadCert({
      actor: staff,
      staffId: typeof target === "string" && target ? target : staff.id,
      raw: { certType: form.get("certType"), expiresOn: form.get("expiresOn") },
      file: blob,
      fileType: blob ? blob.type.toLowerCase() : "",
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, status: r.row.status });
  } catch (err) {
    console.error("[team] cert upload error:", err);
    return NextResponse.json({ error: "The file did not upload. Tap Retry." }, { status: 500 });
  }
}
