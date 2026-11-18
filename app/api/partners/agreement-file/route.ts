import { NextResponse } from "next/server";
import { getCurrentPrincipal } from "@/lib/partners/auth";
import { eventAccess } from "@/lib/partners/db";
import { partnerAgreementLink } from "@/lib/partners/event-page";

// The agreement, for the Lead planner on a planner held event only.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const access = await eventAccess(await getCurrentPrincipal(), url.searchParams.get("key") ?? "");
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const link = await partnerAgreementLink(access, url.searchParams.get("id") ?? "", url.searchParams.get("download") === "1");
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(link, 302);
}
