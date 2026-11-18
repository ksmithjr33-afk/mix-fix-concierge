import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { isAdminRole } from "@/lib/team/roles";
import { ratingsCsvFor, rosterCsvFor } from "@/lib/team/scorecard-db";
import { chicagoToday } from "@/lib/team/time";

// Scorecard CSVs: ?kind=roster or ?kind=ratings. Admins and managers only, never
// with the downloader's own rows.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!isAdminRole(staff.role)) return NextResponse.json({ error: "Admins and managers only." }, { status: 403 });
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "roster" && kind !== "ratings") return NextResponse.json({ error: "Pick roster or ratings." }, { status: 400 });
  try {
    const csv = kind === "roster" ? await rosterCsvFor(staff) : await ratingsCsvFor(staff);
    if (csv === null) return NextResponse.json({ error: "Admins and managers only." }, { status: 403 });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mix-fix-scorecard-${kind}-${chicagoToday()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[scorecard] export failed:", err);
    return NextResponse.json({ error: "Could not build the CSV." }, { status: 500 });
  }
}
