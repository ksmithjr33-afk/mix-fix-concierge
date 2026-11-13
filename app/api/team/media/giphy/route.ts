import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { searchGiphy } from "@/lib/team/media-db";

// GIF search, rated G only: GET ?q=. Off (404) when GIPHY_API_KEY is not set.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const r = await searchGiphy(staff, new URL(request.url).searchParams.get("q"));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, results: r.results });
}
