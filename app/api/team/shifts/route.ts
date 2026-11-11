import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { requestShift, withdrawRequest } from "@/lib/team/shifts-db";

// A bartender requests a posted shift, or withdraws: { action: "request" | "withdraw", postId }.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { action, postId } = await request.json().catch(() => ({}));
    if (typeof postId !== "string" || (action !== "request" && action !== "withdraw")) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const r = action === "request" ? await requestShift(postId, staff) : await withdrawRequest(postId, staff);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, ...("overlap" in r ? { overlap: r.overlap, certWarning: "certWarning" in r ? r.certWarning : null } : {}) });
  } catch (err) {
    console.error("[team] shift request error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
