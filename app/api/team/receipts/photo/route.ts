import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { receiptPhotoUrl } from "@/lib/team/receipts-db";

// One receipt photo full size: ?id=<receipt>&n=<photo number, from 0>.
// Admins and managers, or the staff member who paid; anyone else gets 404.
// Sends a short lived signed link made after that check, never a stored one.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const url = new URL(request.url);
  const n = Number(url.searchParams.get("n") ?? 0);
  const signed = Number.isInteger(n) && n >= 0 && n < 6 ? await receiptPhotoUrl(staff, url.searchParams.get("id"), n) : null;
  if (!signed) return NextResponse.json({ error: "That photo is not available." }, { status: 404 });
  return NextResponse.redirect(signed, { status: 302, headers: { "Cache-Control": "no-store" } });
}
