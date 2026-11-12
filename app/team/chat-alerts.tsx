"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InboxChat } from "@/lib/team/chat-db";
import { CHAT_INBOX, CHAT_READ, getOpenChat, openChatInPlace } from "./chat-focus";

// The chat icon in the header: a count of unread messages, a list of chats
// with unread messages, and a short pop up when a new message comes in. It
// checks about every 20 seconds, only while the page is open and visible, with
// one small request. The server decides what counts: never your own messages,
// bartenders only for their events, admins for every event they have not
// muted, and never client contact details.

const POLL_MS = 20_000;
const TOAST_MS = 6_000;
const SEEN_KEY = "mf-chat-seen";

function readSeen(): string | null {
  try {
    return window.sessionStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function writeSeen(v: string) {
  try {
    window.sessionStorage.setItem(SEEN_KEY, v);
  } catch {
    // Private mode: the pop up may repeat after a page change, nothing worse.
  }
}

function ago(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const sameDay = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat("en-US", sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }).format(d);
}

function Bubble() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}

export default function ChatAlerts() {
  const router = useRouter();
  const [chats, setChats] = useState<InboxChat[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<InboxChat | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const stopped = useRef(false);

  const check = useCallback(async () => {
    if (stopped.current || document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/team/chat/inbox", { cache: "no-store" });
      if (res.status === 401) {
        stopped.current = true;
        return;
      }
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || !Array.isArray(d.chats)) return;
      const onScreen = getOpenChat();
      const list = (d.chats as InboxChat[]).filter((c) => c.sessionId !== onScreen);
      setChats(list);
      window.dispatchEvent(new CustomEvent(CHAT_INBOX, { detail: Object.fromEntries(list.map((c) => [c.sessionId, c.unread])) }));
      // A pop up for the newest message that came in since the last check. Not on first load.
      const newest = list.reduce((m, c) => (c.latest.at > m ? c.latest.at : m), "");
      const seen = readSeen();
      if (seen === null) {
        writeSeen(newest || String(d.now));
        return;
      }
      const fresh = list.find((c) => c.latest.at > seen);
      if (fresh) setToast(fresh);
      if (newest > seen) writeSeen(newest);
    } catch {
      // Offline: try again next time.
    }
  }, []);

  // Check now and every 20 seconds while visible; stop in the background.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      check();
      timer = setInterval(check, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    onVis();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(CHAT_READ, check);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(CHAT_READ, check);
    };
  }, [check]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const go = (c: InboxChat, e?: React.MouseEvent) => {
    setOpen(false);
    setToast(null);
    setChats((cur) => cur.filter((x) => x.sessionId !== c.sessionId));
    if (openChatInPlace(c.sessionId)) {
      e?.preventDefault();
      return;
    }
    if (!e) router.push(c.href);
  };

  const total = chats.reduce((n, c) => n + c.unread, 0);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center text-[#9A7049] hover:text-[#B5845A] p-1"
        aria-label={total ? `Chats, ${total} unread` : "Chats"}
        aria-expanded={open}
      >
        <Bubble />
        {total > 0 && (
          <span className="absolute -right-1.5 -top-1 min-w-[1.25rem] rounded-full bg-[#A0412D] px-1 text-center text-[11px] font-bold leading-[1.25rem] text-white">{total > 99 ? "99+" : total}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] shadow-lg overflow-hidden">
          <p className="px-4 py-2.5 border-b border-[#DDD5CC] font-heading text-base font-bold text-[#2C2420]">Unread chats</p>
          {chats.length === 0 ? (
            <p className="px-4 py-4 text-[15px] text-[#6B5D52]">You are all caught up.</p>
          ) : (
            <ul className="max-h-[60dvh] overflow-y-auto divide-y divide-[#DDD5CC]">
              {chats.map((c) => (
                <li key={c.sessionId}>
                  <Link href={c.href} onClick={(e) => go(c, e)} className="block px-4 py-2.5 hover:bg-[#EFE7DF]">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-heading font-bold text-[#2C2420]">{c.title}</span>
                      <span className="shrink-0 text-xs text-[#A39585]">{ago(c.latest.at)}</span>
                    </span>
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm text-[#6B5D52] line-clamp-2 break-words">
                        <span className="font-medium text-[#2C2420]">{c.latest.from}:</span> {c.latest.text}
                      </span>
                      <span className="shrink-0 rounded-full bg-[#A0412D] px-1.5 text-[11px] font-bold leading-5 text-white">{c.unread}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {toast && (
        <div className="fixed inset-x-0 top-3 z-[60] flex justify-center px-3 pointer-events-none" role="status" aria-live="polite">
          <button
            type="button"
            onClick={() => go(toast)}
            className="pointer-events-auto w-full max-w-md rounded-2xl border border-[#DDD5CC] bg-[#2C2420] text-left text-white shadow-xl px-4 py-3"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate font-heading font-bold">{toast.title}</span>
              <span className="shrink-0 text-xs text-white/70">Tap to open</span>
            </span>
            <span className="block text-sm text-white/90 line-clamp-2 break-words">
              <span className="font-medium">{toast.latest.from}:</span> {toast.latest.text}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
