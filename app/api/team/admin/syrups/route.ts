import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { deleteSyrup, listSyrups, saveSyrup } from "@/lib/syrups-db";
import { firstName } from "@/lib/team/event-view";
import { isAdminRole } from "@/lib/team/roles";

// Syrup recipes library, admins and managers only. Bartenders (and admins in
// Bartender view) get 403, signed out gets 401. { action: "save" | "delete" | "list", ... }
// returns the library as it now stands.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const r =
      body.action === "save"
        ? await saveSyrup({ id: staff.id, name: firstName(staff.name) }, body)
        : body.action === "delete"
          ? await deleteSyrup(body.id)
          : body.action === "list"
            ? { ok: true as const, syrups: await listSyrups() }
            : { ok: false as const, error: "Unknown action.", status: 400 };
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, syrups: r.syrups });
  } catch (err) {
    console.error("[team] syrups error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
