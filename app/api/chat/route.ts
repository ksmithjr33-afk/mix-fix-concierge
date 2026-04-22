import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { supabase } from "@/lib/supabase";

const anthropic = new Anthropic();

interface ChatMessage {
  role: string;
  content: string;
}

async function upsertConversationLog(
  sessionId: string,
  clientName: string | null,
  email: string | null,
  messages: ChatMessage[]
) {
  const { data: existing, error: selectError } = await supabase
    .from("conversation_logs")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (selectError) {
    console.error("conversation_logs select error:", selectError);
    return;
  }

  const nowIso = new Date().toISOString();

  if (existing) {
    const { error } = await supabase
      .from("conversation_logs")
      .update({ messages, updated_at: nowIso })
      .eq("session_id", sessionId);
    if (error) console.error("conversation_logs update error:", error);
  } else {
    const { error } = await supabase.from("conversation_logs").insert({
      session_id: sessionId,
      client_name: clientName,
      email,
      messages,
    });
    if (error) console.error("conversation_logs insert error:", error);
  }
}

export async function POST(request: Request) {
  const { messages, sessionId, clientName, email } = await request.json();

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: messages.map((m: ChatMessage) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            const data = JSON.stringify({ text: event.delta.text });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        if (sessionId) {
          const jsonIndex = fullText.indexOf("EVENT_DATA_JSON:");
          const visibleText =
            jsonIndex === -1 ? fullText : fullText.slice(0, jsonIndex).trim();
          const updatedMessages: ChatMessage[] = [
            ...messages,
            { role: "assistant", content: visibleText },
          ];
          upsertConversationLog(
            sessionId,
            clientName ?? null,
            email ?? null,
            updatedMessages
          ).catch((err) =>
            console.error("Failed to save conversation log:", err)
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
