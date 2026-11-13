// The concierge's final save, end to end on the in-memory database:
// every field the submit tool can send has a home (an events column, or kept
// on the session only), so the legacy events insert is never refused again
// (from 2026-11-06 to 2026-11-13 it failed on payment_preference); a finished
// session lands on the admin events list as upcoming; a failed final save is
// retried, logged as [FINAL SAVE FAILED], and listed for admins; a date with
// no year is read as the next time it comes, and a booking saved with a date
// that already passed is flagged.
// Run: node --no-warnings scripts/test-submit-save.mts

import { registerHooks } from "node:module";
import { addDays, check, done } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db, guards } = await import("./fake-supabase.mts");
const { submitEventDataTool } = await import("../lib/intake-tools.ts");
const { EVENTS_COLUMNS, SESSION_ONLY_FIELDS, eventsInsertRow } = await import("../lib/events-row.ts");
const updates = await import("../lib/event-updates.ts");
const saveRoute = await import("../app/api/save-event/route.ts");
const eventList = await import("../lib/team/event-list.ts");
const alertsDb = await import("../lib/unsaved-sessions-db.ts");
const alerts = await import("../lib/unsaved-sessions.ts");
const prompt = await import("../lib/system-prompt.ts");
const time = await import("../lib/team/time.ts");

for (const t of ["sessions", "events", "conversation_logs", "event_updates", "team_hidden_events"]) db[t] = [];

// The live events table refuses a column it does not have, like PostgREST does.
const LIVE_EVENTS = new Set<string>(EVENTS_COLUMNS);
guards.push((table, op, rows) => {
  if (table !== "events" || op !== "insert") return null;
  const bad = rows.flatMap((r) => Object.keys(r)).find((k) => !LIVE_EVENTS.has(k));
  return bad ? `Could not find the '${bad}' column of 'events' in the schema cache` : null;
});

// ---- 1. Every submit tool field has a home ----
const toolFields = Object.keys(submitEventDataTool.input_schema.properties as Record<string, unknown>);
const homeless = toolFields.filter((f) => !LIVE_EVENTS.has(f) && !(SESSION_ONLY_FIELDS as readonly string[]).includes(f));
check("Every submit tool field is an events column or kept on the session only", homeless.length === 0, `no home: ${homeless.join(", ")}`);
check("payment_preference and change_approval_needed are kept on the session only", ["payment_preference", "change_approval_needed"].every((f) => (SESSION_ONLY_FIELDS as readonly string[]).includes(f)));

const today = time.chicagoToday();
const future = addDays(today, 40);
const full: Record<string, unknown> = {
  client_name: "Dana Lopez",
  email: "dana@example.com",
  event_type: "Birthday",
  event_name: null,
  event_date: future,
  venue_type: "venue",
  bar_service_start: "6:00 PM",
  bar_service_end: "10:00 PM",
  event_address: "100 Main St, Dallas, TX 75201",
  guest_count: 80,
  package: "Full Bar",
  signature_drinks: [],
  payment_preference: "Payment link",
  change_approval_needed: "No",
  dive_menu_requested: false,
};
const { row, dropped } = eventsInsertRow(full);
check("The events row keeps the event fields", row.client_name === "Dana Lopez" && row.event_date === future && row.package === "Full Bar");
check("The events row leaves out the session only fields", !("payment_preference" in row) && dropped.includes("payment_preference") && dropped.includes("change_approval_needed"));

// ---- 2. A finished session saves and shows on the admin list ----
db.sessions.push({ id: "s-ok", name: "Dana Lopez", status: "in_progress", version: 0, event_data: null, event_date: future, created_at: new Date().toISOString() });
db.conversation_logs.push({ session_id: "s-ok", status: "in_progress", updated_at: new Date().toISOString(), messages: [] });
const outcome = await updates.saveFinalSubmission("s-ok", full as never, { retryDelayMs: 0 });
const ok = db.sessions.find((s) => s.id === "s-ok")!;
check("The final save marks the session submitted with its details", outcome === "saved" && ok.status === "submitted" && !!ok.event_data && ok.version === 1);
const res = await saveRoute.POST(new Request("http://x/api/save-event", { method: "POST", body: JSON.stringify({ eventData: full, conversationTranscript: "t", sessionId: "s-ok" }) }));
check("The events row insert succeeds with every tool field sent (it failed from 2026-11-06)", res.status === 200 && db.events.length === 1, `status ${res.status}`);
const submitted = db.sessions.filter((s) => s.status === "submitted");
const sections = eventList.upcomingSections(submitted.map((s) => eventList.eventListItem(s as never)), today);
check("The finished event is on the admin upcoming list", sections.some((s) => s.days.some((d) => d.events.some((e) => e.id === "s-ok"))));
check("Saving again is not a failure", (await updates.saveFinalSubmission("s-ok", full as never, { retryDelayMs: 0 })) === "already_submitted");

// ---- 3. A failed final save is retried, logged, and listed for admins ----
let refusals = 0;
guards.push((table, op, rows) => {
  if (table === "sessions" && op === "update" && rows.some((r) => r.id === "s-fail")) {
    refusals++;
    return "terminating connection due to administrator command";
  }
  return null;
});
db.sessions.push({ id: "s-fail", name: "Maya Chen", status: "in_progress", version: 0, event_data: null, event_date: "null", created_at: new Date().toISOString() });
db.conversation_logs.push({
  session_id: "s-fail",
  client_name: "Maya Chen",
  status: "in_progress",
  updated_at: new Date().toISOString(),
  messages: [
    { role: "user", content: "That is all, thank you!" },
    { role: "assistant", content: "Thank you so much, Maya! If you have any questions before then, feel free to text us anytime at 469 754 8512. Please hang tight while we gather all your details together!" },
  ],
});
const errors: string[] = [];
const quiet = console.error;
console.error = (...a: unknown[]) => errors.push(a.map(String).join(" "));
const failed = await updates.saveFinalSubmission("s-fail", { ...full, client_name: "Maya Chen" } as never, { retryDelayMs: 0 });
console.error = quiet;
check("A failed final save is tried twice and reported as failed", failed === "failed" && refusals === 2, `outcome ${failed}, tries ${refusals}`);
check("A failed final save logs [FINAL SAVE FAILED] with the session and client", errors.some((e) => e.includes("[FINAL SAVE FAILED]") && e.includes("s-fail") && e.includes("Maya Chen")));
const found = await alertsDb.saveAlerts();
check("The admin alert lists the session that finished but did not save", found.unsaved.length === 1 && found.unsaved[0].sessionId === "s-fail" && found.unsaved[0].name === "Maya Chen");
check("The admin alert leaves saved sessions alone", !found.unsaved.some((u) => u.sessionId === "s-ok"));
check("A conversation still in progress is not listed", !alerts.looksFinished({ session_id: "x", client_name: null, status: "in_progress", updated_at: null, last: { role: "assistant", content: "What spirit are you thinking?" } }));

// ---- 4. Dates: no year means the next one; a past date at booking is flagged ----
const nov13 = new Date("2026-11-13T18:00:00Z");
const intake = prompt.buildIntakePrompt(null, nov13);
check("The intake prompt has today's date", intake.includes("Today is Friday, November 13, 2026."));
check("The intake prompt reads a date with no year as the next one", intake.includes("already passed this year is in 2027") && intake.includes("Always write event_date with the full year"));
check("The intake prompt has the client confirm a date that already passed", intake.includes("ask the client to confirm their event date"));
check("The old fixed year line is gone", !intake.includes("The current year is 2026"));
const past = alerts.bookedWithPastDate([
  { id: "p1", name: "Dulari", status: "submitted", event_data: { event_date: "April 11, 2026" }, submitted_at: "2026-11-13T15:34:56Z", created_at: "2026-11-13T00:04:35" },
  { id: "p2", name: "Dearcy", status: "submitted", event_data: { event_date: "12/4/2026" }, submitted_at: "2026-11-13T17:51:16Z", created_at: "2026-11-07T19:47:13" },
  { id: "p3", name: "Old booking", status: "submitted", event_data: { event_date: "October 17, 2026" }, submitted_at: "2026-10-22T13:52:26Z", created_at: "2026-07-20T17:44:43" },
  { id: "p4", name: "Hidden test", status: "submitted", event_data: { event_date: "April 1, 2026" }, submitted_at: "2026-11-13T15:00:00Z", created_at: "2026-11-13T14:00:00" },
], new Set(["p4"]));
check("A booking saved with a date already past is flagged", past.length === 1 && past[0].sessionId === "p1" && past[0].eventDate === "2026-04-11", JSON.stringify(past));

done("submit save");
