import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { overviewEvents } from "@/lib/team/business-overview-db";
import { eventsCsv } from "@/lib/team/business-overview";
import { isYmd } from "@/lib/team/business";
import { isFullAdmin } from "@/lib/team/roles";

// The Business event table as CSV, events dated from..to. Admins only, never managers.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff || !isFullAdmin(staff.role)) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isYmd(from) || !isYmd(to) || from > to) return NextResponse.json({ error: "Pick a start and end date." }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 731) return NextResponse.json({ error: "Pick a range of two years or less." }, { status: 400 });
  try {
    const csv = eventsCsv(await overviewEvents(staff, from, to));
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mix-fix-business-${from}-to-${to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[business] export failed:", err);
    return NextResponse.json({ error: "Could not build the export. Try again." }, { status: 500 });
  }
}
