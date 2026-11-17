import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { openEvent } from "@/lib/team/events";
import { allSupplies } from "@/lib/team/supplies";
import { staffSupplies } from "@/lib/team/supplies-db";
import { reportMissing } from "@/lib/team/missing-db";

// "Something is missing": texts every admin and manager the event date and the items.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { sessionId, keys, note } = await request.json();
    if (typeof sessionId !== "string" || !Array.isArray(keys)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const noteText = typeof note === "string" ? note.trim().slice(0, 500) : "";
    if (keys.length === 0 && !noteText) return NextResponse.json({ error: "Pick an item or add a note." }, { status: 400 });

    const access = await openEvent(sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });

    const items = allSupplies((await staffSupplies(access.session)).list).filter((i) => keys.includes(i.key));
    await reportMissing(access.session, staff, items, noteText, new URL(`/team/e/${sessionId}`, request.url).toString());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] missing error:", err);
    return NextResponse.json({ error: "Could not send. Text us at 469 754 8512." }, { status: 500 });
  }
}
