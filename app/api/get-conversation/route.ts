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
    return NextResponse.json({ status: "completed" });
  }

  return NextResponse.json({
    status: "in_progress",
    messages: data.messages ?? [],
  });
}
