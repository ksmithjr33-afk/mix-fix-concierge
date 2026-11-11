import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { addStore, listStores, moveStore, updateStore } from "@/lib/order-sheet-stores";

// Manage stores, admins only. Bartenders (and admins in Bartender view) get
// 403, signed out gets 401. { action: "add" | "update" | "move", ... } returns the list as it now stands.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const r =
      body.action === "add"
        ? await addStore(body)
        : body.action === "update"
          ? await updateStore(body.id, { name: body.name, color: body.color, retired: body.retired })
          : body.action === "move"
            ? await moveStore(body.id, body.direction)
            : body.action === "list"
              ? { ok: true as const, stores: await listStores() }
              : { ok: false as const, error: "Unknown action.", status: 400 };
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, stores: r.stores });
  } catch (err) {
    console.error("[team] stores error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
