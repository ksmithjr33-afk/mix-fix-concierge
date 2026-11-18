import { NextResponse } from "next/server";
import { partnerCookieOptions, verifyPartnerCode } from "@/lib/partners/auth";
import { PARTNER_COOKIE } from "@/lib/partners/rules";

export async function POST(request: Request) {
  try {
    const { phone, code } = await request.json().catch(() => ({}));
    const result = await verifyPartnerCode(phone, code);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(PARTNER_COOKIE, result.token, partnerCookieOptions);
    return res;
  } catch (err) {
    console.error("[partner-auth] verify-code error:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
