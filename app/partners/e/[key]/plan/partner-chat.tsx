"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MenuCards from "@/app/menu-card";
import type { MenuKey } from "@/lib/menu-markers";

interface Message {
  role: string;
  content: string;
  menus?: unknown;
  byName?: string;
}

/**
 * The planner's chat. It sends only the new message: the server keeps the
 * history and marks every answer with who gave it. Event details are reloaded
 * from the server after a save, never taken from the stream.
 */
export default function PartnerChat({
  eventKey,
  mode,
  startVersion,
  heading,
  greeting,
  initial,
  holdsBooking,
  holderFirstName,
}: {
  eventKey: string;
  mode: "intake" | "update";
  startVersion: number;
  heading: string;
  greeting: string;
  initial: Message[];
  holdsBooking: boolean;
  holderFirstName: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initial.length > 0 ? initial : greeting ? [{ role: "assistant", content: greeting }] : []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (text: string, shown: Message[]) => {
    setStreaming(true);
    setMessages([...shown, { role: "assistant", content: "" }]);
    let full = "";
    let menus: MenuKey[] = [];
    try {
      const res = await fetch("/api/partners/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: eventKey, text, startVersion }) });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setMessages([...shown, { role: "assistant", content: data.error ?? "Something went wrong. Try again." }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (data: string) => {
        if (data === "[DONE]") return;
        let p: { text?: string; event?: string; menu?: MenuKey };
        try {
          p = JSON.parse(data);
        } catch {
          return;
        }
        if (p.event === "updated" || p.event === "held") router.refresh();
        else if (p.event === "complete") {
          setDone(true);
          router.refresh();
        } else if (p.event === "menu" && p.menu) menus = [...menus, p.menu];
        else if (typeof p.text === "string") full += p.text;
        setMessages([...shown, { role: "assistant", content: full, ...(menus.length > 0 ? { menus } : {}) }]);
      };
      while (true) {
        const { done: end, value } = await reader.read();
        if (end) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const f of frames) {
          const line = f.split("\n").find((l) => l.startsWith("data: "));
          if (line) handle(line.slice(6));
        }
      }
    } catch {
      setMessages([...shown, { role: "assistant", content: full || "Could not reach the server. Try again." }]);
    } finally {
      setStreaming(false);
    }
  };

  // A planning chat nobody started yet: the concierge opens it.
  useEffect(() => {
    if (started.current || mode !== "intake" || initial.length > 0) return;
    started.current = true;
    void send("", []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const shown = [...messages.filter((m) => m.content), { role: "user", content: text, byName: "You" }];
    await send(text, shown);
  };

  return (
    <section className="flex flex-col h-[72dvh] min-h-[380px] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#DDD5CC]">
        <h1 className="font-heading text-base font-bold text-[#2C2420]">{heading}</h1>
        <p className="text-xs text-[#6B5D52] mt-0.5 leading-snug">
          {holdsBooking
            ? "You hold the booking, so you can approve price changes here."
            : `A change that affects the price is sent to ${holderFirstName} to approve. Nothing changes until they say yes.`}
        </p>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages
          .filter((m) => m.content.length > 0 || (streaming && m.role === "assistant"))
          .map((m, i) => (
            <div key={i} className="space-y-1">
              {m.role === "user" && m.byName && <p className="text-[11px] text-right text-[#A39585]">{m.byName}</p>}
              <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] px-3.5 py-2.5 rounded-2xl text-[15px] leading-relaxed whitespace-pre-wrap break-words ${m.role === "user" ? "bg-[#B5845A] text-white rounded-br-md" : "bg-[#E8DDD5] text-[#2C2420] rounded-bl-md"}`}>
                  {m.content || <span className="inline-block w-1.5 h-4 bg-[#B5845A] animate-pulse rounded-sm align-text-bottom" />}
                </div>
              </div>
              <MenuCards menus={m.menus as MenuKey[] | undefined} className="w-[88%] max-w-md" />
            </div>
          ))}
        {done && <p className="text-center text-sm text-[#3F5F2A]">The planning is in. Thank you!</p>}
      </div>
      <div className="border-t border-[#DDD5CC] px-3 py-2.5 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          disabled={streaming || done}
          placeholder={mode === "update" ? "What would you like to change?" : "Type your answer"}
          className="flex-1 resize-none rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 py-2.5 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30"
        />
        <button type="button" onClick={() => void submit()} disabled={streaming || done || !input.trim()} className="rounded-xl bg-[#B5845A] text-white px-4 h-11 text-sm font-medium disabled:opacity-40">
          Send
        </button>
      </div>
    </section>
  );
}
