import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { payrollView } from "@/lib/team/payroll-db";
import { linesCsv, peopleCsv, periodFor } from "@/lib/team/payroll";
import { chicagoToday } from "@/lib/team/time";
import { isFullAdmin } from "@/lib/team/roles";

// Payroll CSVs for a period: ?kind=lines (one row per line) or ?kind=people
// (one row per person), &from=&to=. Admins only, never managers.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (kind !== "lines" && kind !== "people") return NextResponse.json({ error: "Pick lines or people." }, { status: 400 });
  const period = periodFor("custom", chicagoToday(), from, to);
  if (period.from !== from || period.to !== to) return NextResponse.json({ error: "Pick a start and end date, 92 days or less." }, { status: 400 });
  try {
    const view = await payrollView(staff, period);
    if (!view) return NextResponse.json({ error: "Admins only." }, { status: 403 });
    const csv = kind === "lines" ? linesCsv(view) : peopleCsv(view);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mix-fix-payroll-${kind}-${from}-to-${to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[payroll] export failed:", err);
    return NextResponse.json({ error: "Could not build the export. Try again." }, { status: 500 });
  }
}
