import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { generateShoppingList, formatShoppingList, generateNatalieSupplyList } from "@/lib/shopping-list";

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

    // Generate client shopping list
    let shoppingListText = "";
    try {
      const shoppingListItems = generateShoppingList(eventData);
      shoppingListText = formatShoppingList(shoppingListItems);
    } catch (err) {
      console.log("generateShoppingList/formatShoppingList failed:", err);
    }

    // Generate Natalie supply list
    let natalieSupplyList = "";
    const pkg = (eventData.package ?? "").toLowerCase();
    const isBeerAndWine = pkg.includes("beer") && pkg.includes("wine") && !pkg.includes("essentials") && !pkg.includes("full") && !pkg.includes("premium");
    const isBartenderOnly = pkg.includes("bartender");
    if (!isBeerAndWine && !isBartenderOnly) {
      try {
        natalieSupplyList = generateNatalieSupplyList(eventData);
      } catch (err) {
        console.log("generateNatalieSupplyList failed:", err);
      }
    }

    const guestCount = Number(eventData.guest_count) || 50;
    const iceLbs = guestCount * 1.5;
    const iceBags = Math.ceil(iceLbs / 18);
    const iceAmount = `${iceBags} x 18lb bags`;

    function parseEventDate(dateStr: string): string {
      if (!dateStr) return '';
      const cleaned = dateStr.replace(/(st|nd|rd|th)/gi, '').trim();
      let parsed = new Date(cleaned);
      if (isNaN(parsed.getTime())) {
        const withYear = cleaned + ' ' + new Date().getFullYear();
        parsed = new Date(withYear);
      }
      if (!isNaN(parsed.getTime())) {
        if (parsed.getFullYear() < 2000) {
          parsed.setFullYear(new Date().getFullYear());
        }
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      }
      return dateStr;
    }

    // Build signature drink summary (drink names and brief descriptions)
    let signatureDrinkSummary = "";
    if (Array.isArray(eventData.signature_drinks) && eventData.signature_drinks.length > 0) {
      signatureDrinkSummary = eventData.signature_drinks
        .map((drink: { name?: string; base_spirit?: string; description?: string; flavor_profile?: string; is_mocktail?: boolean }) => {
          const name = drink.name || "Unnamed Drink";
          const desc = drink.description || drink.flavor_profile || "";
          const mocktail = drink.is_mocktail ? " (Mocktail)" : "";
          return desc ? `${name}${mocktail}: ${desc}` : `${name}${mocktail}`;
        })
        .join(" | ");
    }

    // Remove fields that GHL does not need
    const { age_range: _age, menu_style: _ms, menu_notes: _mn, menu_design_preference: _mdp, ...cleanEventData } = eventData;

    const conversationSummary = await generateConversationSummary(
      conversationTranscript || "",
      eventData
    );

    const payload = {
      ...cleanEventData,
      conversation_transcript: conversationTranscript || null,
      conversation_summary: conversationSummary,
      shopping_list: shoppingListText || null,
      natalie_supply_list: natalieSupplyList || null,
      signature_drink_summary: signatureDrinkSummary || null,
      menu_colors: eventData.menu_colors || null,
      menu_reference_photos: eventData.menu_reference_photos || null,
      ice_amount: iceAmount,
      actual_event_date: parseEventDate(eventData.event_date || ''),
      event_start_time: eventData.bar_service_start || null,
      event_end_time: eventData.bar_service_end || null,
    };

    // Ensure email is always present — use eventData.email if the AI included it,
    // otherwise fall back to the pre-filled email from the booking system URL params
    if (!payload.email && clientEmail) {
      payload.email = clientEmail;
    }

    // Debug: log every field name and value in the webhook payload
    console.log("=== WEBHOOK PAYLOAD FIELDS ===");
    for (const [key, value] of Object.entries(payload)) {
      const display = typeof value === "string" && value.length > 200
        ? value.substring(0, 200) + "... [truncated]"
        : JSON.stringify(value);
      console.log(`  ${key}: ${display}`);
    }
    console.log("=== END WEBHOOK PAYLOAD ===");

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("GHL webhook error:", res.status, text);
      return NextResponse.json(
        { error: "Webhook request failed", status: res.status },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json(
      { error: "Failed to send webhook" },
      { status: 500 }
    );
  }
}
