import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { isAdminRole } from "@/lib/team/roles";
import { editRank, moveRank, rankHistory, setIncluded, setTier } from "@/lib/team/scorecard-ranks-db";
import { markOrderReviewed, saveOfferSettings } from "@/lib/team/offers-db";

// The offer order on the Scorecard: POST { action, ... }. Admins change it,
// managers only view it (403 on every change), and nobody sees or changes
// their own record (checked in scorecard-ranks-db).
//   move { staffId, dir: "up" | "down", market }
//   tier { staffId, tier }
//   edit { staffId, solo, weddings, note }
//   include { staffId, on }                     an admin or manager who bartends
//   reviewed { market }                         "Order reviewed", needed before Automatic
//   settings { headStartMin, windowMin, startDaysBefore, modes }
//   history { staffId }                         admins and managers may read
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins and managers only." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reply = (r: { ok: true } | { ok: false; error: string; status: number }) => (r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status }));
  try {
    if (body.action === "move") return reply(await moveRank(staff, body));
    if (body.action === "tier") return reply(await setTier(staff, body));
    if (body.action === "edit") return reply(await editRank(staff, body));
    if (body.action === "include") return reply(await setIncluded(staff, body));
    if (body.action === "reviewed") return reply(await markOrderReviewed(staff, body.market));
    if (body.action === "settings") return reply(await saveOfferSettings(staff, body));
    if (body.action === "history") return reply(await rankHistory(staff, String(body.staffId ?? "")));
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[offers] order save failed:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
