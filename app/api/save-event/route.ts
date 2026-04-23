import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateShoppingList, formatShoppingList } from "@/lib/shopping-list";

async function markConversationCompleted(
  sessionId: string,
  cleanEventData: Record<string, unknown>
) {
  const { error: logError } = await supabase
    .from("conversation_logs")
    .update({
      status: "completed",
      event_data: cleanEventData,
      updated_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId);
  if (logError) {
    console.error("conversation_logs completion update error:", logError);
  } else {
    console.log(
      `conversation_logs marked completed for session_id=${sessionId}`
    );
  }
}

export async function POST(request: Request) {
  let cleanEventData: Record<string, unknown> = {};
  let sessionIdForLog: string | null = null;

  try {
    const { eventData, conversationTranscript, sessionId } =
      await request.json();
    sessionIdForLog = sessionId ?? null;

    if (!eventData) {
      return NextResponse.json(
        { error: "eventData is required" },
        { status: 400 }
      );
    }

    let shoppingListItems: ReturnType<typeof generateShoppingList> = [];
    let shoppingListText = "";
    try {
      shoppingListItems = generateShoppingList(eventData);
      shoppingListText = formatShoppingList(shoppingListItems);
    } catch (e) {
      console.error("Shopping list generation failed:", e);
    }

    // Remove age_range and old menu fields from eventData
    const { age_range: _age, menu_style: _ms, menu_notes: _mn, menu_design_preference: _mdp, ...rest } = eventData;
    cleanEventData = rest;

    const insertPayload = {
      ...cleanEventData,
      shopping_list: shoppingListItems.length > 0 ? shoppingListItems : null,
      shopping_list_text: shoppingListText || null,
      conversation_transcript: conversationTranscript || null,
      status: "new",
      ghl_webhook_sent: false,
      ghl_webhook_response: null,
      menu_colors: eventData.menu_colors || null,
      menu_reference_photos: eventData.menu_reference_photos || null,
    };

    // Debug: log every field being inserted into the events table
    console.log("=== EVENTS INSERT FIELDS ===");
    for (const [key, value] of Object.entries(insertPayload)) {
      const display =
        typeof value === "string" && value.length > 200
          ? value.substring(0, 200) + "... [truncated]"
          : JSON.stringify(value);
      console.log(`  ${key}: ${display}`);
    }
    console.log(
      `=== END EVENTS INSERT FIELDS (total ${Object.keys(insertPayload).length}) ===`
    );

    const { data, error } = await supabase
      .from("events")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      console.error("Supabase events insert error — full object:", error);
      console.error("Supabase events insert error — message:", error.message);
      console.error("Supabase events insert error — details:", error.details);
      console.error("Supabase events insert error — hint:", error.hint);
      console.error("Supabase events insert error — code:", error.code);
      console.error(
        "Supabase events insert error — JSON:",
        JSON.stringify(error, null, 2)
      );
      console.error(
        "Fields attempted:",
        Object.keys(insertPayload).join(", ")
      );

      // Still mark the conversation completed so the client is not stuck
      if (sessionIdForLog) {
        await markConversationCompleted(sessionIdForLog, cleanEventData);
      }

      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        },
        { status: 500 }
      );
    }

    if (sessionIdForLog) {
      await markConversationCompleted(sessionIdForLog, cleanEventData);
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    console.error("Save event error:", err);

    // Still try to mark the conversation completed so the client is not stuck
    if (sessionIdForLog) {
      try {
        await markConversationCompleted(sessionIdForLog, cleanEventData);
      } catch (markErr) {
        console.error(
          "Failed to mark conversation completed after save error:",
          markErr
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to save event" },
      { status: 500 }
    );
  }
}
