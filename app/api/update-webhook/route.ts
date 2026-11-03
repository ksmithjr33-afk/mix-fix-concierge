import { NextResponse } from "next/server";
import { createNoteByEmail } from "@/lib/ghl-api";
import { getEventUpdates, getSession } from "@/lib/event-updates";
import { buildUpdateNote, buildUpdatePayload } from "@/lib/update-notes";

export async function POST(request: Request) {
  try {
    const { sessionId, updateIds } = await request.json();
    if (!sessionId || !Array.isArray(updateIds) || updateIds.length === 0) {
      return NextResponse.json({ error: "sessionId and updateIds are required" }, { status: 400 });
    }

    const session = await getSession(sessionId);
    if (!session || !session.event_data) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const rows = (await getEventUpdates(sessionId)).filter((r) => updateIds.includes(r.id));

    // A separate GHL inbound webhook, so updates never retrigger the intake workflow.
    const webhookUrl = process.env.GHL_UPDATE_WEBHOOK_URL;
    if (!webhookUrl) console.error("GHL_UPDATE_WEBHOOK_URL is not configured, sending notes only");

    const email = (session.event_data.email as string) || session.email || "";
    const results = [];
    for (const row of rows) {
      const note = buildUpdateNote(row);
      const payload = buildUpdatePayload(session, row);

      const [noteResult, webhookResult] = await Promise.allSettled([
        email
          ? createNoteByEmail(email, note)
          : Promise.resolve({ success: false, contactId: null, reason: "no email" }),
        webhookUrl
          ? fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : Promise.resolve(null),
      ]);

      const noteOk = noteResult.status === "fulfilled" && noteResult.value.success;
      if (!noteOk) {
        console.error(
          `GHL update note failed for ${row.id}:`,
          noteResult.status === "fulfilled" ? noteResult.value.reason : noteResult.reason
        );
      }
      const webhookOk =
        webhookResult.status === "fulfilled" && webhookResult.value !== null && webhookResult.value.ok;
      if (webhookUrl && !webhookOk) {
        console.error(
          `GHL update webhook failed for ${row.id}:`,
          webhookResult.status === "fulfilled" ? webhookResult.value?.status : webhookResult.reason
        );
      }
      results.push({ id: row.id, note_created: noteOk, webhook_sent: webhookOk });
    }

    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error("Update webhook error:", err);
    return NextResponse.json({ error: "Failed to send update" }, { status: 500 });
  }
}
