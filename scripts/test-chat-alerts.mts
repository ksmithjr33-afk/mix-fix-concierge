// Chat notifications inside the app: unread counts per person per event chat,
// messages marked read on opening the chat, no notification for your own
// messages, bartenders only for events they are on, admin mute, and client
// contact details never in a notification. Real code, in-memory database.
// Run: node --no-warnings scripts/test-chat-alerts.mts

import { addDays, check, done, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const chat = await import("../lib/team/chat.ts");
const chatDb = await import("../lib/team/chat-db.ts");

const today = time.todayIn("America/Chicago");
const CLIENT = { client_name: "Justin Reyes", client_email: "justin@example.com", client_phone: "+1 (972) 555-0199", event_type: "Birthday" };
const ev = (id: string, name: string) => ({
  id,
  status: "submitted",
  version: 1,
  event_date: addDays(today, 3),
  team_market: "dallas",
  event_data: { ...CLIENT, event_name: name, event_date: addDays(today, 3), bar_service_start: "6:00pm", bar_service_end: "10:00pm", bartenders: 2 },
});
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const admin2 = { id: "a2", name: "Pat Jones", phone: "+12145550102", role: "admin" as const, active: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const b3 = { id: "b3", name: "Riley Park", phone: "+12145550113", role: "bartender" as const, active: true };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [ev("s1", "Justin's 30th"), ev("s2", "Office Party"), ev("s3", "Gala")];
  db.staff = [admin, admin2, b1, b2, b3].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "x1", session_id: "s1", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "s2", staff_id: "b2", status: "offered" },
    { id: "x3", session_id: "s1", staff_id: "b3", status: "declined" },
  ];
  for (const t of ["event_messages", "event_message_reads", "event_chat_notices", "event_chat_mutes", "team_notices"]) db[t] = [];
  texts.length = 0;
}
let clock = Date.parse("2026-11-12T18:00:00Z");
const tick = () => new Date((clock += 60_000));
const post = async (who: typeof admin | typeof b1, sid: string, body: string) => {
  const r = await chatDb.postMessage(sid, who, body, tick());
  if (!r.ok) throw new Error(r.error);
  return r.message;
};
const inbox = (who: typeof admin | typeof b1) => chatDb.chatInbox(who, new Date(clock + 1000));
const count = async (who: typeof admin | typeof b1, sid: string) => (await inbox(who)).chats.find((c) => c.sessionId === sid)?.unread ?? 0;

// ----- 1. Unread counts per person, and no notification for your own message -----
reset();
await post(b1, "s1", "Running 10 minutes late");
await post(b1, "s1", "Parking in the back");
check("Your own messages never count as unread", (await inbox(b1)).total === 0);
check("An admin gets the unread count for every event", (await count(admin, "s1")) === 2 && (await count(admin2, "s1")) === 2);
check("A bartender not on the event is not notified", (await inbox(b2)).total === 0);
check("A bartender who declined the event is not notified", (await inbox(b3)).total === 0);
await post(admin, "s2", "Bring the big cooler");
check("A bartender on an event (offered) is notified for it", (await count(b2, "s2")) === 1 && (await inbox(b2)).chats.length === 1);
check("Counts are per person: the poster has none for their own", (await count(admin, "s2")) === 0 && (await count(admin2, "s2")) === 1);
const a2 = await inbox(admin2);
check("The chat list is newest first with the event name, sender's first name, the start and the time", a2.chats.map((c) => c.sessionId).join() === "s2,s1" && a2.chats[0].title === "Office Party" && a2.chats[0].latest.from === "Kenneth" && a2.chats[0].latest.text === "Bring the big cooler" && !!a2.chats[0].latest.at);
check("Admin links open the manager Chat tab; bartender links their event's Chat tab", a2.chats[0].href === "/team/admin/e/s2?tab=chat" && (await inbox(b2)).chats[0].href === "/team/e/s2?tab=chat");
check("The total adds every chat", a2.total === 3);
check("Only counts and the newest message per chat come back", JSON.stringify(Object.keys(a2.chats[0]).sort()) === JSON.stringify(["href", "latest", "sessionId", "title", "unread"]) && JSON.stringify(Object.keys(a2.chats[0].latest).sort()) === JSON.stringify(["at", "from", "id", "text"]));
check("The start of a long message is cut", chat.inboxSnippet("x".repeat(200)).length === chat.INBOX_SNIPPET + 3);

// ----- 2. Messages marked read on opening the chat -----
await chatDb.markThreadRead("s1", "a2", tick());
check("Opening the chat marks it read for that person only", (await count(admin2, "s1")) === 0 && (await count(admin, "s1")) === 2);
await post(b1, "s1", "Here now");
check("A message after reading counts again", (await count(admin2, "s1")) === 1);
const chatRoute = src("app/api/team/chat/route.ts");
check("Loading the thread (the Chat tab) marks it read, after the access check", /threadAccess\(sessionId, staff\)[\s\S]*threadMessages\(sessionId, staff\)[\s\S]*markThreadRead\(sessionId, staff\.id\)/.test(chatRoute));
check("Opening an event on its Chat tab marks it read on both views", src("app/team/e/[id]/page.tsx").includes("if (chatTab) await markThreadRead(id, staff.id);") && src("app/team/admin/e/[id]/page.tsx").includes('if (tab === "chat") await markThreadRead(id, me.id);'));
check("The chat icon checks again as soon as a thread is read", src("app/team/e/[id]/chat-thread.tsx").includes("window.dispatchEvent(new Event(CHAT_READ))") && src("app/team/chat-alerts.tsx").includes("window.addEventListener(CHAT_READ, check)"));

// ----- 3. Bartenders only for their events -----
reset();
await post(admin, "s1", "Hi team");
await post(admin, "s3", "Gala notes");
check("A bartender on s1 is notified only for s1", (await inbox(b1)).chats.map((c) => c.sessionId).join() === "s1");
db.event_assignments = db.event_assignments.filter((a) => a.id !== "x1");
check("Removed from the event: no more notifications", (await inbox(b1)).total === 0);
check("An admin in Bartender view is notified only for their own events", (await chatDb.chatInbox({ ...admin2, role: "bartender" }, new Date(clock + 1000))).total === 0);
check("An inactive person gets nothing", (await chatDb.chatInbox({ ...admin2, active: false }, new Date(clock + 1000))).total === 0);

// ----- 4. Admin mute -----
reset();
await post(b1, "s1", "One");
const muted = await chatDb.setChatMuted("s1", admin2, true);
check("An admin can mute an event's chat", muted.ok && db.event_chat_mutes.length === 1);
check("A muted chat leaves that admin's icon and pop ups", (await count(admin2, "s1")) === 0 && (await inbox(admin2)).total === 0);
check("Other admins are still notified", (await count(admin, "s1")) === 1);
check("A bartender cannot mute", !(await chatDb.setChatMuted("s1", b1, true)).ok && db.event_chat_mutes.length === 1);
const muteRoute = src("app/api/team/chat/mute/route.ts");
check("The mute route is admin only on the server", muteRoute.includes("getCurrentStaff()") && muteRoute.includes('if (staff.role !== "admin")'));
// A muted admin who posted is not texted either.
await post(admin2, "s1", "I'm on it");
texts.length = 0;
clock += 10 * 60_000;
await post(b1, "s1", "Thanks");
check("A muted admin gets no chat text", textsTo(admin2).length === 0 && textsTo(admin).length === 0);
await chatDb.setChatMuted("s1", admin2, false);
check("Unmute brings the notifications back", (await count(admin2, "s1")) === 1 && db.event_chat_mutes.length === 0);
check("Muting twice is fine", (await chatDb.setChatMuted("s1", admin2, true)).ok && (await chatDb.setChatMuted("s1", admin2, true)).ok && db.event_chat_mutes.length === 1);

// ----- 5. Client contact details never in a notification -----
reset();
const m = await post(b1, "s1", "Client is Justin Reyes, call 972-555-0199 or justin@example.com");
check("Saved messages have client details removed", !/Reyes|555-0199|justin@example/.test(m.body));
db.event_messages.push({ id: "raw", session_id: "s1", staff_id: "b1", body: "Old note: Reyes (972) 555 0199 justin@example.com", created_at: new Date(clock + 500).toISOString() });
const latest = (await inbox(admin)).chats[0].latest.text;
check("The chat list and pop up never show client details, even from an old message", !/Reyes|555\D*0199|justin@example/.test(latest), latest);

// ----- 6. The browser side -----
const alerts = src("app/team/chat-alerts.tsx");
check("Checks about every 20 seconds", alerts.includes("const POLL_MS = 20_000;") && alerts.includes("setInterval(check, POLL_MS)"));
check("Only while the page is visible: stops in the background", alerts.includes('document.addEventListener("visibilitychange", onVis)') && alerts.includes('document.visibilityState === "visible" ? start() : stop()') && alerts.includes('if (stopped.current || document.visibilityState !== "visible") return;'));
check("No constant connection", !/EventSource|WebSocket|realtime|channel\(/.test(alerts));
check("No pop up for the chat on screen", alerts.includes("c.sessionId !== onScreen") && src("app/team/e/[id]/chat-thread.tsx").includes("setOpenChat(sessionId)"));
check("No pop up for old messages on first load", alerts.includes("if (seen === null)"));
check("The chat icon is in the header on every page", src("app/team/team-header.tsx").includes("{viewed && <ChatAlerts />}"));
check("Unread count on the Chat tab, kept live", src("app/team/e/[id]/event-tabs.tsx").includes("useLiveUnread(chat.sessionId") && src("app/team/admin/e/[id]/manager-tabs.tsx").includes("useLiveUnread(sessionId"));
check("Unread dot on the events list and calendar", src("app/team/events/event-list.tsx").includes("!!e.chat?.unread &&") && src("app/team/calendar-view.tsx").includes("{unread > 0 && <span"));
check("Mute this chat on the manager view", src("app/team/admin/e/[id]/manager-chat.tsx").includes('"Mute this chat"'));
check("The check route needs a sign in", src("app/api/team/chat/inbox/route.ts").includes("getCurrentStaff()") && src("app/api/team/chat/inbox/route.ts").includes("status: 401"));

done("chat notification");
