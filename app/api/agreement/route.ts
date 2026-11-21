import { NextResponse } from "next/server";
import { getSession } from "@/lib/event-updates";
import { clientLinkBlocked } from "@/lib/partners/client-view";
import { agreementLink } from "@/lib/event-home-db";

// "Your agreement" on the client's event page: GET ?id=<their session>&file=<agreement id>&download=1.
// Their link is their key, the same as the page, and it always belongs to the
// person holding the booking (on a planner held event, the Lead planner, who
// sees the agreement on their own page too). Current agreements only. Sends
// the browser to a 10 minute signed link.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const id = q.get("id") ?? "";
  const file = q.get("file") ?? "";
  if (!id || !file) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const session = await getSession(id);
    if (!session || session.status !== "submitted" || (await clientLinkBlocked(session).catch(() => false))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const url = await agreementLink(id, file, q.get("download") === "1");
    if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const res = NextResponse.redirect(url, 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("[agreement] error:", err);
    return NextResponse.json({ error: "Could not open the agreement." }, { status: 500 });
  }
}
