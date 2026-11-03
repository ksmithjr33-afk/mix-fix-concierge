"use client";

import { useEffect, useRef, useState } from "react";
import EventSummary from "./event-summary";
import { UPDATE_OPENER, updateGreeting } from "@/lib/update-mode-shared";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type EventData = Record<string, unknown>;

function formatUpdated(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function UpdateMode({
  sessionId,
  clientName,
  initialEventData,
  initialVersion,
  initialUpdatedAt,
  initialMessages,
}: {
  sessionId: string;
  clientName: string | null;
  initialEventData: EventData;
  initialVersion: number;
  initialUpdatedAt: string | null;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(
    initialMessages.length > 0
      ? initialMessages
      : [{ role: "assistant", content: updateGreeting(clientName) }]
  );
  const [eventData, setEventData] = useState<EventData>(initialEventData);
  const [version, setVersion] = useState(initialVersion);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Scroll the chat panel only, not the whole page.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const streamResponse = async (visible: Message[]) => {
    setIsStreaming(true);
    setMessages([...visible, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: UPDATE_OPENER }, ...visible],
          sessionId,
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      const processFrame = (data: string) => {
        if (data === "[DONE]") return;
        let parsed: {
          text?: string;
          error?: string;
          event?: string;
          eventData?: EventData;
          version?: number;
          updatedAt?: string | null;
        };
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        if (parsed.error) {
          console.error("Stream error:", parsed.error);
          return;
        }
        if (parsed.event === "updated") {
          if (parsed.eventData) setEventData(parsed.eventData);
          if (typeof parsed.version === "number") setVersion(parsed.version);
          if (parsed.updatedAt) setUpdatedAt(parsed.updatedAt);
          return;
        }
        if (typeof parsed.text === "string") {
          fullText += parsed.text;
          setMessages([...visible, { role: "assistant", content: fullText }]);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (line) processFrame(line.slice(6));
        }
      }
      const last = buffer.split("\n").find((l) => l.startsWith("data: "));
      if (last) processFrame(last.slice(6));
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    await streamResponse([...messages.filter((m) => m.content), { role: "user", content: text }]);
  };

  const lastUpdated = formatUpdated(updatedAt);

  return (
    <div className="min-h-dvh bg-[#E8DDD5]">
      <header className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 bg-[#F5F0EB] border-b border-[#DDD5CC]">
        <img src="/logo.png" alt="The Mix Fix" className="h-8 sm:h-10" />
        <a href="sms:4697548512" className="text-xs text-[#6B5D52] hover:text-[#B5845A]">
          Text us (469) 754-8512
        </a>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
        {/* Chat panel */}
        <section className="flex flex-col h-[60dvh] min-h-[360px] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#DDD5CC]">
            <h1 className="font-heading text-base font-bold text-[#2C2420]">Update your event</h1>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages
              .filter((m) => m.content.length > 0 || (isStreaming && m.role === "assistant"))
              .map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[88%] px-3.5 py-2.5 rounded-2xl text-[15px] leading-relaxed whitespace-pre-wrap break-words ${
                      msg.role === "user"
                        ? "bg-[#B5845A] text-white rounded-br-md"
                        : "bg-[#E8DDD5] text-[#2C2420] rounded-bl-md"
                    }`}
                  >
                    {msg.content || (
                      <span className="inline-block w-1.5 h-4 bg-[#B5845A] animate-pulse rounded-sm align-text-bottom" />
                    )}
                  </div>
                </div>
              ))}
          </div>
          <div className="border-t border-[#DDD5CC] px-3 py-2.5 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onInput={() => {
                const el = inputRef.current;
                if (el) {
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }
              }}
              placeholder="What would you like to change?"
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]"
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              aria-label="Send"
              className="flex items-center justify-center w-11 h-11 rounded-xl bg-[#B5845A] text-white disabled:opacity-40 hover:bg-[#9A7049] transition-colors shrink-0"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
        </section>

        {/* Read only summary */}
        <div>
          <div className="flex items-baseline justify-between mb-2 px-1">
            <h2 className="font-heading text-lg font-bold text-[#2C2420]">Your event details</h2>
            {lastUpdated && (
              <span className="text-xs text-[#A39585]">
                Last updated {lastUpdated} (version {version})
              </span>
            )}
          </div>
          <EventSummary data={eventData} />
        </div>
      </main>
    </div>
  );
}
