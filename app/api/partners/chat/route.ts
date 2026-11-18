import { NextResponse } from "next/server";
import { POST as conciergeChat } from "@/app/api/chat/route";
import { partnerAccessFor } from "@/lib/partners/route-helpers";
import { attachPartnerChat } from "@/lib/partners/chat-bridge";
import { partnerChatMessages, intakeMessages } from "@/lib/partners/event-page";
import { plannerChatContext } from "@/lib/partners/planning";
import { hideMoney, type TaggedMessage } from "@/lib/partners/chat";
import { moneyAccess } from "@/lib/partners/rules";
import { UPDATE_OPENER } from "@/lib/update-mode-shared";
import { bookingContextMessage } from "@/lib/partners/intake-context";

export const maxDuration = 60;

/**
 * A linked planner's turn in the planning chat or update mode. The chat
 * history comes from the server, never the browser, and every answer is marked
 * with who gave it. The concierge chat route does the rest with the planner
 * attached in process. Hosts are read only and never chat.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const a = await partnerAccessFor(body.key);
  if ("error" in a) return a.error;
  const { access } = a;
  if (access.viewer.kind !== "planner" || !access.actor.partnerId) return NextResponse.json({ error: "Hosts can view the plans but not change them." }, { status: 403 });
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  const by = { kind: "planner" as const, name: access.actor.name, partnerId: access.actor.partnerId };
  const s = access.session;
  const ed = s.event_data ?? {};

  let messages: TaggedMessage[];
  if (s.status === "submitted" && s.event_data) {
    if (!text) return NextResponse.json({ error: "Type a message." }, { status: 400 });
    const stored = await partnerChatMessages(s.id, access.actor.partnerId);
    messages = [{ role: "user", content: UPDATE_OPENER }, ...stored, { role: "user", content: text, by }];
  } else {
    const stored = await intakeMessages(s.id);
    if (stored.length === 0) {
      // The first turn: the booking context and an opening hello, the way the client's chat starts.
      const context = bookingContextMessage(s);
      messages = [...(context ? [{ role: "user", content: context }] : []), { role: "user", content: `Hi! I am ${access.actor.name}, the planner for this event, and I am ready to plan the bar service.`, by }];
    } else {
      if (!text) return NextResponse.json({ error: "Type a message." }, { status: 400 });
      messages = [...stored, { role: "user", content: text, by }];
    }
  }

  const inner = attachPartnerChat(
    new Request(new URL("/api/chat", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        sessionId: s.id,
        clientName: typeof ed.client_name === "string" ? ed.client_name : s.name,
        email: typeof ed.email === "string" ? ed.email : s.email,
        chatStartVersion: typeof body.startVersion === "number" ? body.startVersion : s.version,
      }),
    }),
    { access, ctx: await plannerChatContext(access), money: moneyAccess(access.booking, access.viewer) }
  );
  const res = await conciergeChat(inner);
  if (!res.body) return res;
  // The planner's page reloads its details itself: event data never streams back, and money is hidden for anyone who does not see it.
  const showMoney = moneyAccess(access.booking, access.viewer).total;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const frame = (raw: string): string => {
    const line = raw.split("\n").find((l) => l.startsWith("data: "));
    if (!line) return "";
    const data = line.slice(6);
    if (data === "[DONE]") return "data: [DONE]\n\n";
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (parsed.event === "updated" || parsed.event === "complete" || parsed.event === "held") return `data: ${JSON.stringify({ event: parsed.event })}\n\n`;
      if (typeof parsed.text === "string" && !showMoney) parsed.text = hideMoney(parsed.text);
      return `data: ${JSON.stringify(parsed)}\n\n`;
    } catch {
      return "";
    }
  };
  const filtered = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const f of frames) {
          const out = frame(f);
          if (out) controller.enqueue(encoder.encode(out));
        }
      },
      flush(controller) {
        const out = frame(buffer);
        if (out) controller.enqueue(encoder.encode(out));
      },
    })
  );
  return new Response(filtered, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
