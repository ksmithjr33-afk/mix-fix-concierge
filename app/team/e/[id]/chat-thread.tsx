"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/team/chat-db";

export interface ChatProps {
  sessionId: string;
  initial: ChatMessage[];
  unread: number;
  timeZone: string;
}

function when(iso: string, tz: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d).replace(/[  ]/g, " ");
  return `${day}, ${time}`;
}

/** The event's team thread. Loads fresh messages (and marks them read) while open. */
export default function ChatThread({ sessionId, initial, active, timeZone }: ChatProps & { active: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/team/chat?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      // Offline: keep what is shown.
    }
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [active, load]);

  useEffect(() => {
    if (active) end.current?.scrollIntoView({ block: "end" });
  }, [active, messages.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, body: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send.");
      setMessages((m) => [...m, data.message]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#DDD5CC]">
        <h2 className="font-heading text-lg font-bold text-[#2C2420]">Team chat</h2>
        <p className="text-xs text-[#6B5D52]">For the staff on this event and the Mix Fix office. The client never sees it. Client contact details are removed from messages.</p>
      </div>
      <ol className="px-3 py-3 space-y-2 max-h-[60dvh] overflow-y-auto">
        {messages.length === 0 && <li className="text-sm text-[#6B5D52] px-1">No messages yet. Say hi to your team.</li>}
        {messages.map((m) => (
          <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${m.mine ? "bg-[#B5845A] text-white" : "bg-[#E8DDD5] text-[#2C2420]"}`}>
              <p className={`text-[11px] ${m.mine ? "text-white/80" : "text-[#6B5D52]"}`}>
                {m.mine ? "You" : m.from}
                {m.fromAdmin && !m.mine ? " · Mix Fix" : ""} · {when(m.at, timeZone)}
              </p>
              <p className="text-[15px] whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          </li>
        ))}
        <div ref={end} />
      </ol>
      <form onSubmit={send} className="border-t border-[#DDD5CC] p-3 space-y-2">
        <label className="sr-only" htmlFor="chat-draft">
          Message
        </label>
        <textarea
          id="chat-draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Message the team"
          className="w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]"
        />
        <div className="flex items-center justify-between gap-3">
          {error ? <p className="text-sm text-[#A0412D]">{error}</p> : <span />}
          <button type="submit" disabled={busy || !draft.trim()} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
            {busy ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
