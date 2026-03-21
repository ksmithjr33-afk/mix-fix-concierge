import { NextResponse } from "next/server";
import { generateShoppingList, formatShoppingList, generateNatalieSupplyList } from "@/lib/shopping-list";

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

    let shoppingListText = "";
    try {
      const shoppingListItems = generateShoppingList(eventData);
      shoppingListText = formatShoppingList(shoppingListItems);
    } catch (err) {
      console.log("generateShoppingList/formatShoppingList failed:", err);
    }

    let natalieSupplyList = "";
    try {
      natalieSupplyList = generateNatalieSupplyList(eventData);
    } catch (err) {
      console.log("generateNatalieSupplyList failed:", err);
    }

    const guestCount = Number(eventData.guest_count) || 50;
    const iceLbs = guestCount * 1.5;
    const iceBags = Math.ceil(iceLbs / 18);
    const iceAmount = `${iceBags} x 18lb bags`;

    function parseEventDate(dateStr: string): string {
      if (!dateStr) return '';
      const cleaned = dateStr.replace(/(st|nd|rd|th)/gi, '');
      const parsed = new Date(cleaned);
      if (!isNaN(parsed.getTime())) {
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return dateStr;
    }

    const payload = {
      ...eventData,
      conversation_transcript: conversationTranscript || null,
      shopping_list: shoppingListText || null,
      natalie_supply_list: natalieSupplyList || null,
      menu_design_preference: `${eventData.menu_style || 'Not specified'}${eventData.menu_notes ? ' | ' + eventData.menu_notes : ''}`,
      ice_amount: iceAmount,
      actual_event_date: parseEventDate(eventData.event_date || ''),
    };

    // Ensure email is always present — use eventData.email if the AI included it,
    // otherwise fall back to the pre-filled email from the booking system URL params
    if (!payload.email && clientEmail) {
      payload.email = clientEmail;
    }

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
