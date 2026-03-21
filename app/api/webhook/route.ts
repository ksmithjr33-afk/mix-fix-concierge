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

    const payload = {
      ...eventData,
      conversation_transcript: conversationTranscript || null,
      shopping_list: shoppingListText || null,
      natalie_supply_list: natalieSupplyList || null,
      menu_design_preference: `${eventData.menu_style || 'Not specified'}${eventData.menu_notes ? ' | ' + eventData.menu_notes : ''}`,
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
