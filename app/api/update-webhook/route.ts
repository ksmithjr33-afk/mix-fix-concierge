import { NextResponse } from "next/server";
import { deliverEventUpdates, getUndeliveredUpdates } from "@/lib/update-delivery";

// Manual retry. The chat route delivers every update itself right after it is
// applied; this resends any update for a session whose webhook_sent is still
// false. Pass updateIds to limit it to specific rows. Rows already sent are skipped.
export async function POST(request: Request) {
  try {
    const { sessionId, updateIds } = await request.json();
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    if (updateIds !== undefined && !Array.isArray(updateIds)) {
      return NextResponse.json({ error: "updateIds must be an array" }, { status: 400 });
    }

    const rows = await getUndeliveredUpdates(sessionId, updateIds);
    if (rows.length === 0) {
      console.log(`[update-webhook] retry for session ${sessionId}: nothing pending`);
      return NextResponse.json({ success: true, results: [], message: "No unsent updates" });
    }

    console.log(`[update-webhook] retry for session ${sessionId}: ${rows.length} unsent update(s)`);
    const results = await deliverEventUpdates(sessionId, rows);
    return NextResponse.json({ success: results.every((r) => r.webhook_sent), results });
  } catch (err) {
    console.error("[update-webhook] retry error:", err);
    return NextResponse.json({ error: "Failed to send update" }, { status: 500 });
  }
}
