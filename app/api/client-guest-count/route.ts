import { NextResponse } from "next/server";
import { getSession, setInternal } from "@/lib/event-updates";
import { clientLinkBlocked } from "@/lib/partners/client-view";
import { clientEventData } from "@/lib/team-notes";
import { GUEST_CONFIRMED_FIELD } from "@/lib/event-home";

// "Yes, 120 is final" on the client's event page: records that the guest count
// on file is their final count. It changes nothing about the event itself (no
// new version, no price, no GHL, no texts); a later guest count change makes it
// unconfirmed again. Their link is their key, the same as the page.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const count = typeof body.count === "string" || typeof body.count === "number" ? String(body.count).trim() : "";
    const session = sessionId ? await getSession(sessionId) : null;
    if (!session?.event_data || session.status !== "submitted" || (await clientLinkBlocked(session).catch(() => false))) {
      return NextResponse.json({ error: "We could not find your event." }, { status: 404 });
    }
    // Only the count they are looking at: if it changed since the page loaded, they confirm the new one.
    if (!count || String(session.event_data.guest_count ?? "").trim() !== count) {
      return NextResponse.json({ error: "Your guest count changed. Refresh the page and check it again." }, { status: 409 });
    }
    const next = await setInternal(sessionId, (ed) =>
      String(ed.guest_count ?? "").trim() === count ? { ...ed, [GUEST_CONFIRMED_FIELD]: { count, at: new Date().toISOString() } } : ed
    );
    if (!next) return NextResponse.json({ error: "Could not save. Try again." }, { status: 409 });
    return NextResponse.json({ eventData: clientEventData(next) });
  } catch (err) {
    console.error("[client-guest-count] error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
