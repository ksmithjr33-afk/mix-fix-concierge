import { NextResponse } from "next/server";
import { partnerAccessFor, resultResponse } from "@/lib/partners/route-helpers";
import { leadSetSwitch } from "@/lib/partners/actions";

// The Lead's pricing switches: "Other planners can see pricing" and "Host can see pricing".
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const a = await partnerAccessFor(body.key);
    if ("error" in a) return a.error;
    return resultResponse(await leadSetSwitch(a.access, body.switch, body.on));
  } catch (err) {
    console.error("[partners] switch error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
