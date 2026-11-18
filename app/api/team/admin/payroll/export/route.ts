import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { payrollView } from "@/lib/team/payroll-db";
import { linesCsv, payoutSheetCsv, peopleCsv, rangePeriod } from "@/lib/team/payroll";
import { isFullAdmin } from "@/lib/team/roles";

// Payroll CSVs for a period, &from=&to=. Admins only, never managers.
//   ?kind=sheet   one row per event in the payout sheet's own column order (paste into the Google Sheet)
//   ?kind=lines   one row per line
//   ?kind=people  one row per person (the Pay Out table)
const BUILD = { sheet: payoutSheetCsv, lines: linesCsv, people: peopleCsv } as const;

export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as keyof typeof BUILD | null;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!kind || !(kind in BUILD)) return NextResponse.json({ error: "Pick sheet, lines or people." }, { status: 400 });
  const period = rangePeriod(from, to);
  if (!period) return NextResponse.json({ error: "Pick a start and end date, 92 days or less." }, { status: 400 });
  try {
    const view = await payrollView(staff, period);
    if (!view) return NextResponse.json({ error: "Admins only." }, { status: 403 });
    return new NextResponse(BUILD[kind](view), {
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
