import { NextResponse } from "next/server";
import { getSession } from "@/lib/event-updates";
import { clientAddPlanner, clientRemovePlanner, clientSetPricing } from "@/lib/partners/actions";
import { resultResponse } from "@/lib/partners/route-helpers";
import type { EventSession } from "@/lib/partners/db";

// The client, in update mode on their own event link: add or remove a planner,
// or turn "Planner can see pricing" on or off. Client held events only (checked in lib/partners/actions.ts).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const s = typeof body.sessionId === "string" ? ((await getSession(body.sessionId)) as EventSession | null) : null;
    if (!s || s.status !== "submitted") return NextResponse.json({ error: "We could not find your event." }, { status: 404 });
    if (body.action === "add") return resultResponse(await clientAddPlanner(s, { name: body.name, company: body.company, phone: body.phone }));
    if (body.action === "remove") return resultResponse(await clientRemovePlanner(s, String(body.partnerId ?? "")));
    if (body.action === "pricing") return resultResponse(await clientSetPricing(s, body.on === true));
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[partners] client planners error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
