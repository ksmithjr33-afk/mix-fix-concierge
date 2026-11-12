import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { savePrefs } from "@/lib/team/prefs-db";

// Remember the signed in person's calendar choices: POST { wideView?, phoneView?, market?, eventsLayout?, staffingLayout? }.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const k of ["wideView", "phoneView", "market", "eventsLayout", "staffingLayout"]) if (k in body) patch[k] = body[k];
  const prefs = await savePrefs(staff.id, patch);
  return NextResponse.json({ ok: true, prefs });
}
