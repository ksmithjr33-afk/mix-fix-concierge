import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { catalogAction } from "@/lib/team/supply-costs-db";
import { isFullAdmin } from "@/lib/team/roles";

// The supply cost catalog: add, update, delete, and the CSV import (preview, then import). Admins only, never managers.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff || !isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await catalogAction(staff, body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, preview: r.preview ?? null, saved: r.saved ?? null });
  } catch (err) {
    console.error("[supply costs] save failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
