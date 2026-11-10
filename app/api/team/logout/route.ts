import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { endSession } from "@/lib/team/auth";
import { SESSION_COOKIE } from "@/lib/team/codes";
import { VIEW_COOKIE } from "@/lib/team/view-mode";

export async function POST(request: Request) {
  const store = await cookies();
  await endSession(store.get(SESSION_COOKIE)?.value).catch((err) => console.error("[team-auth] logout error:", err));
  const res = NextResponse.redirect(new URL("/team", request.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(VIEW_COOKIE);
  return res;
}
