// Event team chat rules. Pure, no database.
//
// The thread belongs to the event: admins and the staff assigned to it (not
// declined) can read and post. The client is never part of it. Client contact
// details and last name are taken out of every message before it is saved, so
// no reader and no text ever carries them.

export const CHAT_BATCH_MIN = 5;
export const CHAT_MAX = 2000;
export const CHAT_SNIPPET = 100;

/** Who may open an event's thread. */
export function canUseThread(staff: { role: string; active: boolean }, assignmentStatus: string | null): boolean {
  if (!staff.active) return false;
  if (staff.role === "admin") return true;
  return assignmentStatus === "offered" || assignmentStatus === "accepted";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The message with the client's email, phone number, and last name taken out.
 * Phone numbers match in any format (spaces, dots, dashes, brackets, +1).
 */
export function redactClient(body: string, client: { email?: unknown; phone?: unknown; name?: unknown }): string {
  let out = body;
  const email = String(client.email ?? "").trim();
  if (email.includes("@")) out = out.replace(new RegExp(escapeRe(email), "gi"), "[client contact removed]");
  const digits = String(client.phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length === 10) {
    const loose = digits.split("").join("[\\s().-]*");
    out = out.replace(new RegExp(`(\\+?1[\\s().-]*)?${loose}`, "g"), "[client contact removed]");
  }
  const words = String(client.name ?? "").trim().split(/\s+/);
  const last = words.length > 1 ? words[words.length - 1].replace(/[^\p{L}'-]/gu, "") : "";
  if (last.length >= 2) out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRe(last)}(?![\\p{L}])`, "giu"), "[last name removed]");
  return out;
}

/** A message ready to save, or an error. */
export function cleanMessage(
  raw: unknown,
  client: { email?: unknown; phone?: unknown; name?: unknown },
  opts: { hasAttachment?: boolean } = {}
): { ok: true; body: string } | { ok: false; error: string } {
  const body = String(raw ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!body && !opts.hasAttachment) return { ok: false, error: "Write a message first." };
  if (body.length > CHAT_MAX) return { ok: false, error: `Keep it under ${CHAT_MAX} characters.` };
  return { ok: true, body: redactClient(body, client) };
}

/** The first 100 characters on one line, with "..." when cut. */
export function snippet(body: string): string {
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > CHAT_SNIPPET ? `${one.slice(0, CHAT_SNIPPET).trimEnd()}...` : one;
}

/**
 * "Jordan on Justin's 30th: Running 10 minutes late (+2 more) https://...".
 * With a picture: "Jordan on Justin's 30th: sent a GIF https://..." (and the
 * words after it, if any). The file itself is never in the text.
 */
export function chatText(o: { from: string; title: string; body: string; more: number; link: string; attachment?: "gif" | "photo" | null }): string {
  const words = snippet(o.body);
  const sent = o.attachment ? (o.attachment === "gif" ? "sent a GIF" : "sent a photo") : "";
  const what = sent && words ? `${sent}: ${words}` : sent || words;
  return `${o.from} on ${o.title}: ${what}${o.more > 0 ? ` (+${o.more} more)` : ""} ${o.link}`;
}

export type ChatNoticeRow = { last_sent_at: string | null; pending_after: string | null };

/**
 * What to do for one person when a message is posted: text now, hold a
 * text until 5 minutes after the last one, or nothing (one is already held).
 */
export function chatNoticePlan(row: ChatNoticeRow | null, now: Date): { action: "send" } | { action: "hold"; until: Date } | { action: "none" } {
  if (row?.pending_after) return { action: "none" };
  const last = row?.last_sent_at ? new Date(row.last_sent_at).getTime() : null;
  if (last !== null && now.getTime() - last < CHAT_BATCH_MIN * 60_000) return { action: "hold", until: new Date(last + CHAT_BATCH_MIN * 60_000) };
  return { action: "send" };
}

/** Messages from others after the given time: the unread count. */
export function unreadCount(messages: { staff_id: string | null; created_at: string }[], me: string, since: string | null): number {
  const t = since ? new Date(since).getTime() : -Infinity;
  return messages.filter((m) => m.staff_id !== me && new Date(m.created_at).getTime() > t).length;
}

// ----- Notifications inside the app -----

/** How far back the unread check looks. Older unread messages stop counting. */
export const INBOX_DAYS = 60;
export const INBOX_SNIPPET = 80;

export interface InboxMessage {
  id: string;
  session_id: string;
  staff_id: string | null;
  body: string;
  created_at: string;
  attachment_kind?: "gif" | "photo" | null;
}

export interface InboxEntry {
  sessionId: string;
  unread: number;
  latest: InboxMessage;
}

/**
 * Unread chats for one person, newest first: messages from others after they
 * last read that thread, in threads they are notified for (`eligible`; null
 * means every thread, for admins), leaving out muted threads.
 */
export function inboxFrom(
  messages: InboxMessage[],
  o: { me: string; lastRead: Map<string, string>; eligible: Set<string> | null; muted: Set<string> }
): InboxEntry[] {
  const by = new Map<string, InboxEntry>();
  for (const m of messages) {
    if (m.staff_id === o.me) continue;
    if (o.eligible && !o.eligible.has(m.session_id)) continue;
    if (o.muted.has(m.session_id)) continue;
    const read = o.lastRead.get(m.session_id);
    if (read && new Date(m.created_at).getTime() <= new Date(read).getTime()) continue;
    const cur = by.get(m.session_id);
    if (!cur) by.set(m.session_id, { sessionId: m.session_id, unread: 1, latest: m });
    else {
      cur.unread++;
      if (m.created_at > cur.latest.created_at) cur.latest = m;
    }
  }
  return [...by.values()].sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
}

/** The start of a message on one line, for the chat list and the pop up. A picture alone reads "sent a GIF". */
export function inboxSnippet(body: string, attachment?: "gif" | "photo" | null): string {
  const one = body.replace(/\s+/g, " ").trim() || (attachment === "gif" ? "sent a GIF" : attachment ? "sent a photo" : "");
  return one.length > INBOX_SNIPPET ? `${one.slice(0, INBOX_SNIPPET).trimEnd()}...` : one;
}
