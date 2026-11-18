import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { isAdminRole } from "@/lib/team/roles";
import { deactivatePartner, findOrCreatePlanner, reactivatePartner, updatePartner } from "@/lib/partners/db";
import { findPartnerByPhone } from "@/lib/partners/auth";
import { normalizePhone } from "@/lib/team/codes";

async function admin() {
  const staff = await getCurrentStaff();
  if (!staff) return { error: NextResponse.json({ error: "Sign in again." }, { status: 401 }) };
  if (!isAdminRole(staff.role)) return { error: NextResponse.json({ error: "Admins and managers only." }, { status: 403 }) };
  return { staff };
}

// Add a planner.
export async function POST(request: Request) {
  try {
    const a = await admin();
    if (a.error) return a.error;
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhone(body.phone);
    if (phone && (await findPartnerByPhone(phone))) return NextResponse.json({ error: "A partner with that phone number already exists." }, { status: 409 });
    const r = await findOrCreatePlanner(body, a.staff.name || "Our team");
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, id: r.partner.id });
  } catch (err) {
    console.error("[partners] add error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}

// Edit, deactivate, or reactivate.
export async function PATCH(request: Request) {
  try {
    const a = await admin();
    if (a.error) return a.error;
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    if (body.action === "deactivate") {
      const r = await deactivatePartner(id, { kind: "staff", name: a.staff.name || "Our team" });
      return r.ok ? NextResponse.json({ ok: true, alerted: r.alerted }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    if (body.action === "reactivate") {
      const r = await reactivatePartner(id);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    const r = await updatePartner(id, body);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (err) {
    console.error("[partners] edit error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
