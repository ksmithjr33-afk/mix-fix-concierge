import { NextResponse } from "next/server";
import { partnerAccessFor, resultResponse } from "@/lib/partners/route-helpers";
import { leadAddPlanner, leadRemovePlanner } from "@/lib/partners/actions";

// The Lead on a planner held event adds or removes other planners.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const a = await partnerAccessFor(body.key);
    if ("error" in a) return a.error;
    if (body.action === "add") return resultResponse(await leadAddPlanner(a.access, { name: body.name, company: body.company, phone: body.phone, email: body.email }));
    if (body.action === "remove") return resultResponse(await leadRemovePlanner(a.access, String(body.partnerId ?? "")));
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[partners] planners error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
