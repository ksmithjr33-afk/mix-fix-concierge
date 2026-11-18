import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { allReceipts } from "@/lib/team/receipts-db";
import { filterReceipts, parseFilters, receiptsCsv } from "@/lib/team/receipts";
import { siteOrigin } from "@/lib/team/clock-db";
import { isFullAdmin } from "@/lib/team/roles";
import { chicagoToday } from "@/lib/team/time";

// The receipts CSV for the filters in the address (the same ones the
// Receipts page uses). Admins only, never managers or staff. Each photo is an
// app link that checks access again before it opens.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const all = await allReceipts(staff);
    if (!all) return NextResponse.json({ error: "Admins only." }, { status: 403 });
    const filters = parseFilters(Object.fromEntries(new URL(request.url).searchParams));
    return new NextResponse(receiptsCsv(filterReceipts(all.items, filters), siteOrigin()), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mix-fix-receipts-${chicagoToday()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[receipts] export failed:", err);
    return NextResponse.json({ error: "Could not build the export. Try again." }, { status: 500 });
  }
}
