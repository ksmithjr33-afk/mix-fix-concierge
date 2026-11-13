import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { staffMenuLink } from "@/lib/team/approved-menu-db";

// The approved menu for staff: GET ?sessionId=&download=1. Admins, the staff
// on the event, and the person picking up the printed menu. Sends the browser
// to a 10 minute signed link; anyone else gets a 404.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const sessionId = q.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const url = await staffMenuLink(staff, sessionId, { download: q.get("download") === "1", fileId: q.get("fileId") ?? undefined });
    if (!url) return NextResponse.json({ error: "No menu to show." }, { status: 404 });
    const res = NextResponse.redirect(url, 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("[menu-file] error:", err);
    return NextResponse.json({ error: "Could not open the menu." }, { status: 500 });
  }
}
