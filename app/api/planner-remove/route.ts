import { NextResponse } from "next/server";
import { removeByToken } from "@/lib/partners/actions";

// The client's one tap remove link. A POST, so a link preview in a text app can never remove anyone.
export async function POST(request: Request) {
  try {
    const { token } = await request.json().catch(() => ({}));
    const r = await removeByToken(typeof token === "string" ? token : "");
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, plannerName: r.plannerName });
  } catch (err) {
    console.error("[partners] remove link error:", err);
    return NextResponse.json({ error: "Could not remove. Try again." }, { status: 500 });
  }
}
