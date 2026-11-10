import { NextResponse } from "next/server";
import { sessionCookieOptions, verifyLoginCode } from "@/lib/team/auth";
import { SESSION_COOKIE } from "@/lib/team/codes";

export async function POST(request: Request) {
  try {
    const { phone, code } = await request.json().catch(() => ({}));
    const result = await verifyLoginCode(phone, code);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions);
    return res;
  } catch (err) {
    console.error("[team-auth] verify-code error:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
