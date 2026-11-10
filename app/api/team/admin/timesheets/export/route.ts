import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { timesheetRows } from "@/lib/team/timesheet-db";
import { isYmd, timesheetCsv } from "@/lib/team/timesheet";

const MAX_DAYS = 366;

// CSV of timesheet rows for events dated from..to (YYYY-MM-DD, inclusive). Admins only.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isYmd(from) || !isYmd(to) || from > to) return NextResponse.json({ error: "Pick a start and end date." }, { status: 400 });
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > MAX_DAYS) return NextResponse.json({ error: "Pick a range of a year or less." }, { status: 400 });
  try {
    const csv = timesheetCsv(await timesheetRows(from, to));
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mix-fix-timesheets-${from}-to-${to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[team] timesheet export error:", err);
    return NextResponse.json({ error: "Could not build the export. Try again." }, { status: 500 });
  }
}
