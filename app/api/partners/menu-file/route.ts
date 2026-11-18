import { NextResponse } from "next/server";
import { getCurrentPrincipal } from "@/lib/partners/auth";
import { eventAccess } from "@/lib/partners/db";
import { partnerMenuLink } from "@/lib/partners/event-page";

// The approved menu for a linked planner or host: checked here, then a 10 minute signed link.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const access = await eventAccess(await getCurrentPrincipal(), url.searchParams.get("key") ?? "");
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const link = await partnerMenuLink(access, url.searchParams.get("download") === "1");
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(link, 302);
}
