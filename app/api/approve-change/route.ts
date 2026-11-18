import { NextResponse } from "next/server";
import { clientDecideByToken } from "@/lib/partners/actions";

// The client approves or declines a price change a planner asked for.
export async function POST(request: Request) {
  try {
    const { token, yes } = await request.json().catch(() => ({}));
    const r = await clientDecideByToken(typeof token === "string" ? token : "", yes === true);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, status: r.status });
  } catch (err) {
    console.error("[partners] approve link error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
