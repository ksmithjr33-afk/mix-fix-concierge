import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { attachmentLink } from "@/lib/team/media-db";

// One chat or announcement picture: GET ?id=. Only people who can see that
// chat or announcement; sends them to a 10 minute signed link.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const url = await attachmentLink(staff, id);
    if (!url) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const res = NextResponse.redirect(url, 302);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (err) {
    console.error("[media] file error:", err);
    return NextResponse.json({ error: "Could not open it." }, { status: 500 });
  }
}
