import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { endPartnerSession } from "@/lib/partners/auth";
import { PARTNER_COOKIE } from "@/lib/partners/rules";

export async function POST(request: Request) {
  const store = await cookies();
  await endPartnerSession(store.get(PARTNER_COOKIE)?.value).catch((err) => console.error("[partner-auth] logout error:", err));
  const res = NextResponse.redirect(new URL("/partners", request.url), 303);
  res.cookies.delete(PARTNER_COOKIE);
  return res;
}
