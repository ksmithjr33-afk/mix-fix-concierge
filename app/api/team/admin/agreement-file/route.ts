import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { agreementLink } from "@/lib/team/agreements-db";
import { isAdminRole } from "@/lib/team/roles";

// One agreement file: GET ?id=&download=1. Admins and managers only; anyone
// else, Bartender view included, gets a 404. Sends the browser to a 10 minute
// signed link, so a copied link stops working.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const q = new URL(request.url).searchParams;
  const id = q.get("id");
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const url = await agreementLink(staff, id, q.get("download") === "1");
    if (!url) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const res = NextResponse.redirect(url, 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("[agreement-file] error:", err);
    return NextResponse.json({ error: "Could not open the file." }, { status: 500 });
  }
}
