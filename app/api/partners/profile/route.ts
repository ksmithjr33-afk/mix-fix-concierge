import { NextResponse } from "next/server";
import { getCurrentPrincipal } from "@/lib/partners/auth";
import { updateOwnProfile } from "@/lib/partners/db";

// A partner's own profile: name, company, email, website. Never the phone, which is their login.
export async function POST(request: Request) {
  try {
    const me = await getCurrentPrincipal();
    if (!me) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    if (me.kind !== "partner") return NextResponse.json({ error: "Only planners have a profile." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const result = await updateOwnProfile(me.partner.id, { name: body.name, company: body.company, email: body.email, website: body.website });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[partners] profile error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
