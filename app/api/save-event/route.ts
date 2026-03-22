import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateShoppingList, formatShoppingList } from "@/lib/shopping-list";

export async function POST(request: Request) {
  try {
    const { eventData, conversationTranscript } =
      await request.json();

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
    const { age_range: _age, menu_style: _ms, menu_notes: _mn, menu_design_preference: _mdp, ...cleanEventData } = eventData;

    const { data, error } = await supabase
      .from("events")
      .insert({
        ...cleanEventData,
        shopping_list: shoppingListItems.length > 0 ? shoppingListItems : null,
        shopping_list_text: shoppingListText || null,
        conversation_transcript: conversationTranscript || null,
        status: "new",
        ghl_webhook_sent: false,
        ghl_webhook_response: null,
        menu_colors: eventData.menu_colors || null,
        menu_reference_photos: eventData.menu_reference_photos || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    console.error("Save event error:", err);
    return NextResponse.json(
      { error: "Failed to save event" },
      { status: 500 }
    );
  }
}
