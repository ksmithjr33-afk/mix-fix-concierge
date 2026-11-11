import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { certFileLink } from "@/lib/team/certs-db";

// Open a certification file: a short signed link, only for admins and the owner.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const link = id ? await certFileLink(staff, id) : null;
  if (!link) return NextResponse.json({ error: "We could not find that file." }, { status: 404 });
  return NextResponse.redirect(link, { headers: { "Cache-Control": "no-store" } });
}
