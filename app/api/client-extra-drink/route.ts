import { NextResponse } from "next/server";
import { answerExtraDrinks, getSession } from "@/lib/event-updates";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { announceRequest } from "@/lib/change-requests";
import { textPricePending } from "@/lib/price-pending-db";
import { clientLinkBlocked } from "@/lib/partners/client-view";
import { clientAsks, clientEventData } from "@/lib/team-notes";
import { packageDrinkCount } from "@/lib/event-diff";

// The client, on their own event page, answers "Add it for $50?" for a drink
// they named past their package count. Yes saves it the way a confirmed change
// in the update chat saves (bartenders, GHL, a request inside six days); No
// drops it. Nothing here texts the client.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const session = sessionId ? await getSession(sessionId) : null;
    if (!session || session.status !== "submitted" || (await clientLinkBlocked(session).catch(() => false))) {
      return NextResponse.json({ error: "We could not find your event." }, { status: 404 });
    }
    if (typeof body.accept !== "boolean") return NextResponse.json({ error: "Bad request" }, { status: 400 });

    const answer = await answerExtraDrinks(sessionId, body.accept);
    if (!answer.ok) return NextResponse.json({ error: answer.error }, { status: answer.status });

    if (answer.kind !== "declined") {
      const r = answer.result;
      if (r.held?.fresh) await announceRequest(r.held.id);
      if (r.rows.length > 0) {
        if (r.pricePending?.fresh) await textPricePending((await getSession(sessionId)) ?? session, r.pricePending.info);
        await deliverEventUpdates(sessionId, r.rows, { staffOrigin: new URL(request.url).origin });
      }
    }
    const fresh = (await getSession(sessionId)) ?? session;
    const ed = fresh.event_data ?? answer.eventData;
    return NextResponse.json({
      kind: answer.kind,
      eventData: clientEventData(ed),
      asks: clientAsks(ed, packageDrinkCount(ed.package)),
      version: fresh.version,
      updatedAt: fresh.updated_at ?? null,
      pending: answer.kind === "requested",
    });
  } catch (err) {
    console.error("[client-extra-drink] error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
