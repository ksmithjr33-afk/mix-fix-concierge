"use client";

import { useState } from "react";
import ChatThread, { type ChatProps } from "../../../e/[id]/chat-thread";
import { useActiveTab } from "./manager-tabs";

/**
 * The event team chat on the manager view's Chat tab: loads and marks read
 * while the tab is open. "Mute this chat" stops the chat icon count, pop ups
 * and texts for this event, for this admin only.
 */
export default function ManagerChat({ muted: initialMuted, ...props }: ChatProps & { muted: boolean }) {
  const active = useActiveTab() === "chat";
  const [muted, setMuted] = useState(initialMuted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/chat/mute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: props.sessionId, muted: !muted }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setMuted(d.muted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">
          Message team
          {props.unread > 0 && !active && <span className="ml-2 align-middle rounded-full bg-[#A0412D] px-1.5 text-[11px] font-bold text-white">{props.unread} unread</span>}
        </h2>
        <button type="button" onClick={toggle} disabled={busy} aria-pressed={muted} className="text-sm text-[#6B5D52] underline disabled:opacity-40">
          {muted ? "Unmute this chat" : "Mute this chat"}
        </button>
      </div>
      {muted && <p className="px-1 text-sm text-[#6B5D52]">Muted: no chat icon count, pop ups or texts for this event. You can still read and post here.</p>}
      {error && <p className="px-1 text-sm text-[#A0412D]">{error}</p>}
      <ChatThread {...props} active={active} />
    </section>
  );
}
