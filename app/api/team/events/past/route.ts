import { timed } from "@/lib/timing";
import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { pastEventsFor } from "@/lib/team/past-events-db";

// The Past events tab: GET ?q=&offset= returns the next 30 rows this person may
// see (admins and managers every past event, everyone else only their own).
async function handleGet(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const url = new URL(request.url);
  try {
    const page = await pastEventsFor(staff, { q: url.searchParams.get("q") ?? "", offset: url.searchParams.get("offset") ?? 0 });
    return NextResponse.json({ ok: true, ...page }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[team-events] past error:", err);
    return NextResponse.json({ error: "Could not load past events." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return timed("events-past", () => handleGet(request));
}
