import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing session_id parameter" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("conversation_logs")
    .select("messages, status")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("conversation_logs lookup error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(null);
  }

  if (data.status === "completed") {
    // Submitted sessions open in update mode at /s. Chats started without a
    // session row (no /s link) keep going to the complete page.
    const { data: session } = await supabase
      .from("sessions")
      .select("status")
      .eq("id", sessionId)
      .maybeSingle();
    return NextResponse.json({
      status: "completed",
      submitted: session?.status === "submitted",
    });
  }

  return NextResponse.json({
    status: "in_progress",
    messages: data.messages ?? [],
  });
}
