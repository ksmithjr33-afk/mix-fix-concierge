import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { staffCsv } from "@/lib/team/profile-db";
import { chicagoToday } from "@/lib/team/time";

// Download CSV on the Staff page: every staff profile, admins only.
export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  try {
    const csv = await staffCsv(staff);
    if (csv === null) return NextResponse.json({ error: "Admins only." }, { status: 403 });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mix-fix-staff-${chicagoToday()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[team] staff csv error:", err);
    return NextResponse.json({ error: "Could not build the file." }, { status: 500 });
  }
}
