import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildEventFields } from "@/lib/ghl-payload";
import { createNoteByEmail } from "@/lib/ghl-api";

const anthropic = new Anthropic();

async function generateConversationSummary(
  transcript: string,
  eventData: Record<string, unknown>
): Promise<string | null> {
  if (!transcript || transcript.trim().length === 0) return null;

  const structured = JSON.stringify(
    {
      package: eventData.package ?? null,
      signature_drinks: eventData.signature_drinks ?? null,
      special_requests: eventData.special_requests ?? null,
      event_name: eventData.event_name ?? null,
      event_type: eventData.event_type ?? null,
      guest_count: eventData.guest_count ?? null,
      theme: eventData.theme ?? null,
    },
    null,
    2
  );

  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `Summarize this bar service planning conversation for internal team handoff. Focus on the key decisions: the package chosen, the 3 signature drinks (names only), any special requests, key preferences, and anything notable the client mentioned.

Write a clean short paragraph (not bullet points), 3 to 5 sentences max. Do not use hyphens, en dashes, or em dashes anywhere. Use commas or periods instead.

Structured event data:
${structured}

Full transcript:
${transcript}

Return only the summary paragraph, no preamble or labels.`,
        },
      ],
    });

    const block = res.content[0];
    if (block && block.type === "text") {
      return block.text.trim();
    }
    return null;
  } catch (err) {
    console.error("Conversation summary generation failed:", err);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const { eventData, conversationTranscript, clientEmail } = await request.json();

    const webhookUrl = process.env.GHL_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error("GHL_WEBHOOK_URL is not configured");
      return NextResponse.json(
        { error: "Webhook URL not configured" },
        { status: 500 }
      );
    }

    if (!eventData) {
      return NextResponse.json(
        { error: "eventData is required" },
        { status: 400 }
      );
    }

    const { cleanEventData, fields } = buildEventFields(eventData);

    const conversationSummary = await generateConversationSummary(
      conversationTranscript || "",
      eventData
    );

    const isabelSummary = fields.isabel_summary;

    const payload: Record<string, unknown> = {
      ...cleanEventData,
      conversation_transcript: conversationTranscript || null,
      conversation_summary: conversationSummary,
      ...fields,
    };

    // Ensure email is always present — use eventData.email if the AI included it,
    // otherwise fall back to the pre-filled email from the booking system URL params
    if (!payload.email && clientEmail) {
      payload.email = clientEmail;
    }

    // Debug: log the conversation summary and transcript in full before sending
    console.log("=== CONVERSATION SUMMARY (sent to GHL) ===");
    console.log(conversationSummary ?? "(null)");
    console.log("=== END CONVERSATION SUMMARY ===");
    console.log("=== CONVERSATION TRANSCRIPT (sent to GHL) ===");
    console.log(conversationTranscript ?? "(null)");
    console.log("=== END CONVERSATION TRANSCRIPT ===");

    // Debug: log every field name and value in the webhook payload
    console.log("=== WEBHOOK PAYLOAD FIELDS ===");
    for (const [key, value] of Object.entries(payload)) {
      const display = typeof value === "string" && value.length > 200
        ? value.substring(0, 200) + "... [truncated]"
        : JSON.stringify(value);
      console.log(`  ${key}: ${display}`);
    }
    console.log("=== END WEBHOOK PAYLOAD ===");

    // Fire both GHL webhook AND GHL Notes API in parallel.
    // The webhook triggers the existing intake workflow.
    // The Notes API creates an actual note on the contact in GHL Notes section.
    // Either can succeed/fail independently.

    const webhookPromise = fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const targetEmail = (payload.email as string) || clientEmail || "";
    const notePromise: Promise<{ success: boolean; contactId: string | null; reason?: string }> =
      isabelSummary && targetEmail
        ? createNoteByEmail(targetEmail, isabelSummary)
        : Promise.resolve({
            success: false,
            contactId: null,
            reason: !isabelSummary ? "no isabel summary (likely Beer and Wine package)" : "no email",
          });

    const [webhookResult, noteResult] = await Promise.allSettled([
      webhookPromise,
      notePromise,
    ]);

    // Log note result for debugging
    if (noteResult.status === "fulfilled") {
      const r = noteResult.value;
      if (r.success) {
        console.log(`✓ GHL Note created on contact ${r.contactId}`);
      } else {
        console.log(`✗ GHL Note skipped: ${r.reason}`);
      }
    } else {
      console.error("GHL Note promise rejected:", noteResult.reason);
    }

    // Check webhook result
    if (webhookResult.status === "rejected") {
      console.error("GHL webhook fetch rejected:", webhookResult.reason);
      return NextResponse.json(
        { error: "Webhook request failed" },
        { status: 502 }
      );
    }

    const res = webhookResult.value;
    if (!res.ok) {
      const text = await res.text();
      console.error("GHL webhook error:", res.status, text);
      return NextResponse.json(
        { error: "Webhook request failed", status: res.status },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      note_created: noteResult.status === "fulfilled" ? noteResult.value.success : false,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json(
      { error: "Failed to send webhook" },
      { status: 500 }
    );
  }
}
