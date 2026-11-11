import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { setTeamSetting } from "@/lib/client-list-db";

// Team settings, admins only: { key: "auto_send_client_shopping_list" | "order_sheet_store_suggestions", on }.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.key !== "string" || typeof body.on !== "boolean") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const r = await setTeamSetting(staff, body.key, body.on);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
