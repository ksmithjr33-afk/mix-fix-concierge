import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { setTeamSetting, setTeamText } from "@/lib/client-list-db";
import { isAdminRole } from "@/lib/team/roles";

// Team settings, admins and managers:
//   switches { key: "auto_send_client_shopping_list" | "order_sheet_store_suggestions", on }
//   wording  { key: "ice_rule", text } (empty puts the default back)
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.key === "string" && typeof body.text === "string") {
    const t = await setTeamText(staff, body.key, body.text);
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
    return NextResponse.json({ ok: true, value: t.value });
  }
  if (typeof body.key !== "string" || typeof body.on !== "boolean") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const r = await setTeamSetting(staff, body.key, body.on);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
