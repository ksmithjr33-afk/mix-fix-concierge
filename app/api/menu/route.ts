import { NextResponse } from "next/server";
import { clientMenuLink } from "@/lib/team/approved-menu-db";

// "Your menu" on the client's event page: GET ?id=<their session>&download=1.
// Their link is their key, the same as the page itself. Sends the browser to
// a 10 minute signed link to the approved menu.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const id = q.get("id");
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const url = await clientMenuLink(id, q.get("download") === "1");
    if (!url) return NextResponse.json({ error: "No menu yet." }, { status: 404 });
    const res = NextResponse.redirect(url, 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("[menu] error:", err);
    return NextResponse.json({ error: "Could not open the menu." }, { status: 500 });
  }
}
