// Database side of the event team chat. Server only.
//
// Thread members are the staff assigned to the event (offered or accepted)
// plus any admin who has posted in it. A new message texts the other members:
// the first text right away, then at most one more per person per event every
// 5 minutes, covering everything posted in between. Someone removed from the
// event loses the thread and its texts at once; someone added sees the whole
// history.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { getAssignment, getSubmittedSession } from "@/lib/team/events";
import { eventTitle } from "@/lib/team/event-list";
import { eventData } from "@/lib/team/markets";
import { sendStaffText } from "@/lib/team/sms";
import { siteOrigin } from "@/lib/team/clock-db";
import { canUseThread, chatNoticePlan, chatText, cleanMessage, inboxFrom, inboxSnippet, redactClient, unreadCount, INBOX_DAYS, type ChatNoticeRow, type InboxMessage } from "@/lib/team/chat";

interface MessageRow {
  id: string;
  session_id: string;
  staff_id: string | null;
  body: string;
  created_at: string;
}

interface Member {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
}

export interface ChatMessage {
  id: string;
  from: string; // first name
  fromAdmin: boolean;
  mine: boolean;
  body: string;
  at: string;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export type ThreadAccess = { ok: true; session: SessionRow } | { ok: false; reason: "not_found" | "not_assigned" };

export function threadLink(sessionId: string): string {
  return `${siteOrigin()}/team/e/${encodeURIComponent(sessionId)}?tab=chat`;
}

/** Admins, and staff assigned to the event and not declined. */
export async function threadAccess(sessionId: string, staff: StaffMember): Promise<ThreadAccess> {
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, reason: "not_found" };
  const status = staff.role === "admin" ? null : ((await getAssignment(sessionId, staff.id))?.status ?? null);
  return canUseThread(staff, status) ? { ok: true, session } : { ok: false, reason: "not_assigned" };
}

async function messagesOf(sessionId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase.from("event_messages").select("*").eq("session_id", sessionId).order("created_at", { ascending: true });
  if (error) return [];
  return (data as MessageRow[]) ?? [];
}

async function staffMap(ids: string[]): Promise<Map<string, Member>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("staff").select("id, name, phone, role, active").in("id", ids);
  return new Map(((data as Member[]) ?? []).map((s) => [s.id, s]));
}

/** The whole thread, oldest first. Call threadAccess first. */
export async function threadMessages(sessionId: string, staff: StaffMember): Promise<ChatMessage[]> {
  const rows = await messagesOf(sessionId);
  const people = await staffMap([...new Set(rows.map((r) => r.staff_id).filter((x): x is string => !!x))]);
  return rows.map((r) => {
    const p = r.staff_id ? people.get(r.staff_id) : undefined;
    return {
      id: r.id,
      from: firstName(p?.name) || "Mix Fix",
      fromAdmin: p?.role === "admin",
      mine: r.staff_id === staff.id,
      body: r.body,
      at: r.created_at,
    };
  });
}

export async function markThreadRead(sessionId: string, staffId: string, now: Date = new Date()): Promise<void> {
  const { error } = await supabase
    .from("event_message_reads")
    .upsert({ session_id: sessionId, staff_id: staffId, last_read_at: now.toISOString() }, { onConflict: "session_id,staff_id" });
  if (error) console.error("[team-chat] saving read time failed:", error.message);
}

/** Thread members who get texts: assigned staff (not declined) and admins who have posted. Active only. */
async function threadMembers(sessionId: string, messages: MessageRow[]): Promise<Member[]> {
  const { data } = await supabase.from("event_assignments").select("staff_id, status").eq("session_id", sessionId);
  const assigned = ((data as { staff_id: string; status: string }[]) ?? []).filter((a) => a.status !== "declined").map((a) => a.staff_id);
  const posters = messages.map((m) => m.staff_id).filter((x): x is string => !!x);
  const people = await staffMap([...new Set([...assigned, ...posters])]);
  const muted = await mutedBy(sessionId);
  return [...people.values()].filter((p) => p.active && (assigned.includes(p.id) || (p.role === "admin" && !muted.has(p.id))));
}

async function noticeRow(sessionId: string, staffId: string): Promise<ChatNoticeRow | null> {
  const { data } = await supabase.from("event_chat_notices").select("last_sent_at, pending_after").eq("session_id", sessionId).eq("staff_id", staffId).maybeSingle();
  return (data as ChatNoticeRow | null) ?? null;
}

/** Claim the right to text this person now. False when another send got there first. */
async function claimSend(sessionId: string, staffId: string, row: ChatNoticeRow | null, now: Date): Promise<boolean> {
  if (!row) {
    const { error } = await supabase.from("event_chat_notices").insert({ session_id: sessionId, staff_id: staffId, last_sent_at: now.toISOString(), pending_after: null });
    return !error;
  }
  let q = supabase.from("event_chat_notices").update({ last_sent_at: now.toISOString() }).eq("session_id", sessionId).eq("staff_id", staffId).is("pending_after", null);
  q = row.last_sent_at ? q.eq("last_sent_at", row.last_sent_at) : q.is("last_sent_at", null);
  const { data } = await q.select("staff_id");
  return ((data as unknown[]) ?? []).length > 0;
}

async function hold(sessionId: string, staffId: string, until: Date): Promise<void> {
  await supabase.from("event_chat_notices").update({ pending_after: until.toISOString() }).eq("session_id", sessionId).eq("staff_id", staffId).is("pending_after", null);
}

/** Post a message to the event's thread and text the other members. A failed text never fails the post. */
export async function postMessage(sessionId: string, staff: StaffMember, raw: unknown, now: Date = new Date()): Promise<Result<{ message: ChatMessage }>> {
  const access = await threadAccess(sessionId, staff);
  if (!access.ok) return { ok: false, error: access.reason === "not_found" ? "We could not find that event." : "You are not on this event.", status: access.reason === "not_found" ? 404 : 403 };
  const ed = access.session.event_data ?? {};
  const clean = cleanMessage(raw, { email: ed.client_email, phone: ed.client_phone, name: ed.client_name });
  if (!clean.ok) return { ok: false, error: clean.error, status: 400 };
  const { data, error } = await supabase
    .from("event_messages")
    .insert({ session_id: sessionId, staff_id: staff.id, body: clean.body, created_at: now.toISOString() })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: "Could not send. Try again.", status: 500 };
  const row = data as MessageRow;
  await markThreadRead(sessionId, staff.id, now);

  try {
    const messages = await messagesOf(sessionId);
    const title = eventTitle(eventData(access.session));
    const from = firstName(staff.name) || "Mix Fix";
    for (const m of await threadMembers(sessionId, messages)) {
      if (m.id === staff.id) continue;
      const existing = await noticeRow(sessionId, m.id);
      const plan = chatNoticePlan(existing, now);
      if (plan.action === "hold") await hold(sessionId, m.id, plan.until);
      if (plan.action !== "send") continue;
      if (!(await claimSend(sessionId, m.id, existing, now))) {
        await hold(sessionId, m.id, new Date(now.getTime() + 5 * 60_000));
        continue;
      }
      await sendStaffText(m.phone, m.name, chatText({ from, title, body: clean.body, more: 0, link: threadLink(sessionId) }));
    }
  } catch (err) {
    console.error("[team-chat] texting the thread failed:", err instanceof Error ? err.message : String(err));
  }
  return {
    ok: true,
    message: { id: row.id, from: firstName(staff.name) || "Mix Fix", fromAdmin: staff.role === "admin", mine: true, body: row.body, at: row.created_at },
  };
}

/**
 * Send the held chat texts that are due: one text per person per event,
 * showing the latest message and how many more came in. Skipped when they
 * already read the thread, or are no longer on the event. Returns texts sent.
 */
export async function deliverChatNotices(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from("event_chat_notices").select("*").not("pending_after", "is", null);
  if (error || !data) return 0;
  const due = (data as (ChatNoticeRow & { session_id: string; staff_id: string })[]).filter((r) => r.pending_after && new Date(r.pending_after).getTime() <= now.getTime());
  let sent = 0;
  for (const r of due) {
    const { data: claimed } = await supabase
      .from("event_chat_notices")
      .update({ pending_after: null, last_sent_at: now.toISOString() })
      .eq("session_id", r.session_id)
      .eq("staff_id", r.staff_id)
      .eq("pending_after", r.pending_after!)
      .select("staff_id");
    if (((claimed as unknown[]) ?? []).length === 0) continue;
    const person = (await staffMap([r.staff_id])).get(r.staff_id);
    if (!person) continue;
    const access = await threadAccess(r.session_id, person as StaffMember);
    if (!access.ok) continue;
    const { data: read } = await supabase.from("event_message_reads").select("last_read_at").eq("session_id", r.session_id).eq("staff_id", r.staff_id).maybeSingle();
    const since = [r.last_sent_at, (read as { last_read_at: string } | null)?.last_read_at].filter((x): x is string => !!x).map((x) => new Date(x).getTime());
    const after = since.length ? Math.max(...since) : -Infinity;
    const fresh = (await messagesOf(r.session_id)).filter((m) => m.staff_id !== r.staff_id && new Date(m.created_at).getTime() > after);
    if (fresh.length === 0) continue;
    const latest = fresh[fresh.length - 1];
    const author = latest.staff_id ? (await staffMap([latest.staff_id])).get(latest.staff_id) : undefined;
    const ok = await sendStaffText(
      person.phone,
      person.name,
      chatText({ from: firstName(author?.name) || "Mix Fix", title: eventTitle(eventData(access.session)), body: latest.body, more: fresh.length - 1, link: threadLink(r.session_id) })
    );
    if (ok) sent++;
  }
  return sent;
}

/** Unread messages per event for this person (messages from others since they last read). */
export async function unreadByEvent(staffId: string, sessionIds?: string[]): Promise<Map<string, number>> {
  let q = supabase.from("event_messages").select("session_id, staff_id, created_at");
  if (sessionIds) {
    if (sessionIds.length === 0) return new Map();
    q = q.in("session_id", sessionIds);
  }
  const [{ data, error }, { data: reads }] = await Promise.all([q, supabase.from("event_message_reads").select("session_id, last_read_at").eq("staff_id", staffId)]);
  if (error || !data) return new Map();
  const lastRead = new Map(((reads as { session_id: string; last_read_at: string }[]) ?? []).map((r) => [r.session_id, r.last_read_at]));
  const bySession = new Map<string, MessageRow[]>();
  for (const m of data as MessageRow[]) bySession.set(m.session_id, [...(bySession.get(m.session_id) ?? []), m]);
  const out = new Map<string, number>();
  for (const [sid, rows] of bySession) {
    const n = unreadCount(rows, staffId, lastRead.get(sid) ?? null);
    if (n > 0) out.set(sid, n);
  }
  return out;
}

// ----- Notifications inside the app -----

/** Admins who muted this event's chat. */
async function mutedBy(sessionId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("event_chat_mutes").select("staff_id").eq("session_id", sessionId);
  if (error || !data) return new Set();
  return new Set((data as { staff_id: string }[]).map((r) => r.staff_id));
}

/** The events whose chat this person muted. */
export async function mutedChats(staffId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("event_chat_mutes").select("session_id").eq("staff_id", staffId);
  if (error || !data) return new Set();
  return new Set((data as { session_id: string }[]).map((r) => r.session_id));
}

/** Admins only: mute or unmute an event's chat for themselves. */
export async function setChatMuted(sessionId: string, staff: StaffMember, muted: boolean): Promise<Result<{ muted: boolean }>> {
  if (staff.role !== "admin") return { ok: false, error: "Only admins can mute a chat.", status: 403 };
  if (!(await getSubmittedSession(sessionId))) return { ok: false, error: "We could not find that event.", status: 404 };
  const { error } = muted
    ? await supabase.from("event_chat_mutes").upsert({ session_id: sessionId, staff_id: staff.id }, { onConflict: "session_id,staff_id", ignoreDuplicates: true })
    : await supabase.from("event_chat_mutes").delete().eq("session_id", sessionId).eq("staff_id", staff.id);
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, muted };
}

/** The threads a person is notified for: every thread for admins (null), the events they are on for everyone else. */
async function notifiedThreads(staff: StaffMember): Promise<Set<string> | null> {
  if (staff.role === "admin") return null;
  const { data } = await supabase.from("event_assignments").select("session_id, status").eq("staff_id", staff.id);
  return new Set(((data as { session_id: string; status: string }[]) ?? []).filter((a) => canUseThread(staff, a.status)).map((a) => a.session_id));
}

export interface InboxChat {
  sessionId: string;
  title: string;
  href: string; // the event's Chat tab
  unread: number;
  latest: { id: string; from: string; text: string; at: string };
}

/**
 * The unread check: per chat with unread messages, the count and the newest
 * message (sender's first name and the start of it), newest first. Bartenders
 * only for events they are on; admins for every event they have not muted.
 * Never the viewer's own messages, never client contact details.
 */
export async function chatInbox(staff: StaffMember, now: Date = new Date()): Promise<{ total: number; chats: InboxChat[] }> {
  const empty = { total: 0, chats: [] };
  if (!staff.active) return empty;
  const eligible = await notifiedThreads(staff);
  if (eligible && eligible.size === 0) return empty;
  const since = new Date(now.getTime() - INBOX_DAYS * 86_400_000).toISOString();
  let q = supabase.from("event_messages").select("id, session_id, staff_id, body, created_at").gte("created_at", since);
  if (eligible) q = q.in("session_id", [...eligible]);
  const [{ data, error }, { data: reads }, muted] = await Promise.all([q, supabase.from("event_message_reads").select("session_id, last_read_at").eq("staff_id", staff.id), mutedChats(staff.id)]);
  if (error || !data) return empty;
  const lastRead = new Map(((reads as { session_id: string; last_read_at: string }[]) ?? []).map((r) => [r.session_id, r.last_read_at]));
  const entries = inboxFrom(data as InboxMessage[], { me: staff.id, lastRead, eligible, muted: staff.role === "admin" ? muted : new Set() });
  if (entries.length === 0) return empty;
  const ids = entries.map((e) => e.sessionId);
  const [{ data: sessions }, people] = await Promise.all([
    supabase.from("sessions").select("id, status, event_date, event_data").in("id", ids),
    staffMap([...new Set(entries.map((e) => e.latest.staff_id).filter((x): x is string => !!x))]),
  ]);
  const byId = new Map(((sessions as (SessionRow & { status: string })[]) ?? []).filter((s) => s.status === "submitted").map((s) => [s.id, s]));
  const chats: InboxChat[] = [];
  for (const e of entries) {
    const s = byId.get(e.sessionId);
    if (!s) continue;
    const ed = s.event_data ?? {};
    const author = e.latest.staff_id ? people.get(e.latest.staff_id) : undefined;
    chats.push({
      sessionId: e.sessionId,
      title: eventTitle(eventData(s)),
      href: staff.role === "admin" ? `/team/admin/e/${encodeURIComponent(e.sessionId)}?tab=chat` : `/team/e/${encodeURIComponent(e.sessionId)}?tab=chat`,
      unread: e.unread,
      latest: {
        id: e.latest.id,
        from: firstName(author?.name) || "Mix Fix",
        // Saved messages already have client details taken out; this is a second check.
        text: inboxSnippet(redactClient(e.latest.body, { email: ed.client_email, phone: ed.client_phone, name: ed.client_name })),
        at: e.latest.created_at,
      },
    });
  }
  return { total: chats.reduce((n, c) => n + c.unread, 0), chats };
}
