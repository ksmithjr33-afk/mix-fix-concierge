import { NextResponse } from "next/server";
import { getSignedInStaff } from "@/lib/team/auth";
import { VIEW_COOKIE, VIEW_COOKIE_DAYS } from "@/lib/team/view-mode";

// The Bartender view switch, from a form in the header. Only a real admin can
// turn it on; anyone can turn it off.
export async function POST(request: Request) {
  const staff = await getSignedInStaff();
  if (!staff) return NextResponse.redirect(new URL("/team", request.url), 303);
  const form = await request.formData().catch(() => null);
  const on = form?.get("mode") === "bartender" && staff.role === "admin";
  const res = NextResponse.redirect(new URL(on ? "/team/events" : staff.role === "admin" ? "/team/admin/events" : "/team/events", request.url), 303);
  if (on) {
    res.cookies.set(VIEW_COOKIE, "bartender", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: VIEW_COOKIE_DAYS * 86_400,
    });
  } else {
    res.cookies.delete(VIEW_COOKIE);
  }
  return res;
}
