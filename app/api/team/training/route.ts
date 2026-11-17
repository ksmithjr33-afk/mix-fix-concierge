import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { acknowledgeTraining } from "@/lib/team/certs-db";

// Training: "Mark as read" on a package entry. { ackId: "package:full" }. Anyone signed in, for themselves.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { ackId } = await request.json().catch(() => ({}));
  if (typeof ackId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const r = await acknowledgeTraining(staff, ackId);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
