import { NextResponse } from "next/server";
import { partnerAccessFor, resultResponse } from "@/lib/partners/route-helpers";
import { leadDecide } from "@/lib/partners/actions";

// The Lead on a planner held event approves or declines a price change.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const a = await partnerAccessFor(body.key);
    if ("error" in a) return a.error;
    return resultResponse(await leadDecide(a.access, String(body.id ?? ""), body.yes === true));
  } catch (err) {
    console.error("[partners] approval error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
