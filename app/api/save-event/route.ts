import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const { eventData, shoppingList, shoppingListText, conversationTranscript } =
      await request.json();

    if (!eventData) {
      return NextResponse.json(
        { error: "eventData is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("events")
      .insert({
        ...eventData,
        shopping_list: shoppingList || null,
        shopping_list_text: shoppingListText || null,
        conversation_transcript: conversationTranscript || null,
        status: "new",
        ghl_webhook_sent: false,
        ghl_webhook_response: null,
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
