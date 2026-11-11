import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { acknowledgeItem } from "@/lib/team/certs-db";

// Tick an onboarding step: { itemId }.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { itemId } = await request.json().catch(() => ({}));
  if (typeof itemId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const r = await acknowledgeItem(staff, itemId);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
