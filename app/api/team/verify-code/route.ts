import { NextResponse } from "next/server";
import { sessionCookieOptions, verifyLoginCode } from "@/lib/team/auth";
import { SESSION_COOKIE } from "@/lib/team/codes";
import { profilePromptPath } from "@/lib/team/profile-db";

export async function POST(request: Request) {
  try {
    const { phone, code, next } = await request.json().catch(() => ({}));
    const result = await verifyLoginCode(phone, code);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
    // Asked once after sign in to fill in a profile with gaps. Never blocks signing in.
    const goTo = typeof next === "string" && next.startsWith("/team/") ? next : "/team/events";
    const redirect = await profilePromptPath(result.staffId, goTo).catch(() => null);
    const res = NextResponse.json({ ok: true, ...(redirect ? { redirect } : {}) });
    res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions);
    return res;
  } catch (err) {
    console.error("[team-auth] verify-code error:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
