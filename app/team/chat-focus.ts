// Shared between the chat icon in the header, the event chat thread, and the
// event page tabs, all in the browser. Which chat is on screen right now (no
// pop up for it), live unread counts from the chat check, and opening the
// Chat tab in place when the event page is already open.

import { useEffect, useState } from "react";

export const CHAT_READ = "mf-chat-read"; // a thread was just marked read: check again
export const CHAT_INBOX = "mf-chat-inbox"; // detail: { [sessionId]: unread }
export const OPEN_CHAT = "mf-open-chat"; // detail: sessionId

let openChat: string | null = null;
const tabsOn = new Set<string>();

/** The chat thread on screen, or null. Set by the thread while its tab is open. */
export function setOpenChat(sessionId: string | null) {
  openChat = sessionId;
}
export function getOpenChat(): string | null {
  return openChat;
}

/** The event page for this event is open and can switch to its Chat tab in place. */
export function registerTabs(sessionId: string): () => void {
  tabsOn.add(sessionId);
  return () => tabsOn.delete(sessionId);
}

/** Open the Chat tab in place when that event's page is already open. True when handled. */
export function openChatInPlace(sessionId: string): boolean {
  if (!tabsOn.has(sessionId)) return false;
  window.dispatchEvent(new CustomEvent(OPEN_CHAT, { detail: sessionId }));
  return true;
}

/** Tabs: switch to Chat when asked from the header or a pop up. */
export function useOpenChat(sessionId: string, open: () => void) {
  useEffect(() => {
    const off = registerTabs(sessionId);
    const on = (e: Event) => (e as CustomEvent<string>).detail === sessionId && open();
    window.addEventListener(OPEN_CHAT, on);
    return () => {
      off();
      window.removeEventListener(OPEN_CHAT, on);
    };
  }, [sessionId, open]);
}

/** The Chat tab's unread count, kept up to date by the chat check. Zero while the chat is open. */
export function useLiveUnread(sessionId: string, initial: number, active: boolean): number {
  const [n, setN] = useState(initial);
  useEffect(() => {
    const on = (e: Event) => {
      const counts = (e as CustomEvent<Record<string, number>>).detail ?? {};
      if (sessionId in counts) setN(counts[sessionId]);
    };
    window.addEventListener(CHAT_INBOX, on);
    return () => window.removeEventListener(CHAT_INBOX, on);
  }, [sessionId]);
  // Opening the chat clears the count (set while rendering, as React advises for derived resets).
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setN(0);
  }
  return active ? 0 : n;
}
