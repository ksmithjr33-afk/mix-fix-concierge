// Shared by the partner routes: the signed in partner or host, checked against
// the event on every call. Server only.

import { NextResponse } from "next/server";
import { getCurrentPrincipal } from "@/lib/partners/auth";
import { eventAccess, type EventAccess } from "@/lib/partners/db";

export async function partnerAccessFor(key: unknown): Promise<{ access: EventAccess } | { error: NextResponse }> {
  const principal = await getCurrentPrincipal();
  if (!principal) return { error: NextResponse.json({ error: "Sign in again." }, { status: 401 }) };
  const access = await eventAccess(principal, typeof key === "string" ? key : "");
  // Not linked (or removed): the same answer as an event that does not exist.
  if (!access) return { error: NextResponse.json({ error: "We could not find that event." }, { status: 404 }) };
  return { access };
}

export function resultResponse(r: { ok: true } | { ok: false; error: string; status: number }): NextResponse {
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
