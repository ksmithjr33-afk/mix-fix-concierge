// Admin side: finish and submit a client's plan when the concierge chat ended
// without saving it (the closing went out but submit_event_data never ran).
// Builds the event the same way the chat route does at submission: drinks
// checked (skipped details marked Drinks not finalized, an extra drink nobody
// said yes to held back), booked facts filled in, the Dive Bar set menu.
//
// Never messages the client. Never texts staff or admins. Never sends the GHL
// webhook unless you ask for it separately with --send-ghl.
//
//   Dry run (default, writes nothing, prints the event as it would be saved):
//     node --no-warnings --env-file=.env.local scripts/admin-submit-session.mts <sessionId> --data plan.json
//   Save it (session submitted as version 1, events row, conversation marked completed):
//     ... <sessionId> --data plan.json --confirm
//   Also clear a planning_role the chat saved by mistake:
//     ... --clear-role
//   Later, after reviewing the saved plan, send the GHL webhook and note (dry run without --confirm):
//     ... <sessionId> --send-ghl [--confirm]

import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
process.env.TIMING_LOG = "0";

const args = process.argv.slice(2);
const sessionId = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--data");
const flag = (f: string) => args.includes(f);
const dataPath = args.includes("--data") ? args[args.indexOf("--data") + 1] : null;
const confirm = flag("--confirm");
if (!sessionId) {
  console.error("Usage: admin-submit-session.mts <sessionId> (--data plan.json [--clear-role] | --send-ghl) [--confirm]");
  process.exit(1);
}

const { supabase } = await import("../lib/supabase.ts");
const { recordSubmission } = await import("../lib/event-updates.ts");
const { checkDrinks } = await import("../lib/intake-plan.ts");
const { bookingFill } = await import("../lib/booking-webhook.ts");
const { bookedFacts, factsAsSession } = await import("../lib/booked-facts.ts");
const { applyDiveSetMenu } = await import("../lib/dive-menu.ts");
const { eventsInsertRow } = await import("../lib/events-row.ts");
const { generateShoppingList, formatShoppingList } = await import("../lib/shopping-list.ts");
const { siteOrigin } = await import("../lib/team/clock-db.ts");
const { isBlank } = await import("../lib/blank.ts");

type Msg = { role: string; content: string };
const { data: session, error } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
if (error || !session) {
  console.error(`Session ${sessionId} not found${error ? `: ${error.message}` : ""}`);
  process.exit(1);
}
const { data: log } = await supabase.from("conversation_logs").select("messages, status").eq("session_id", sessionId).maybeSingle();
const messages = (((log as { messages?: Msg[] } | null)?.messages ?? []) as Msg[]).filter((m) => typeof m.content === "string");
const transcript = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
const mode = confirm ? "CONFIRM" : "DRY RUN";

// ---------------------------------------------------------------------------
// --send-ghl: only for a session already submitted, after you reviewed it.
// ---------------------------------------------------------------------------
if (flag("--send-ghl")) {
  if (session.status !== "submitted" || !session.event_data) {
    console.error("This session is not submitted yet. Submit it first, review it, then send the GHL webhook.");
    process.exit(1);
  }
  const url = `${siteOrigin()}/api/webhook`;
  console.log(`[${mode}] GHL webhook and contact note via ${url} for ${session.name} (session ${sessionId})`);
  if (!confirm) {
    console.log("Nothing sent. Add --confirm to send it.");
    process.exit(0);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventData: session.event_data, conversationTranscript: transcript, clientEmail: session.email ?? null, sessionId }),
  });
  console.log(`Webhook route answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(res.ok ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------
if (!dataPath) {
  console.error("--data plan.json is required to submit.");
  process.exit(1);
}
if (session.status === "submitted") {
  console.error(`Session ${sessionId} is already submitted (version ${session.version}). Nothing to do.`);
  process.exit(1);
}
const raw = JSON.parse(readFileSync(dataPath, "utf8")) as Record<string, unknown>;
const pkg = String(session.package_type ?? raw.package ?? "");
const drinks = checkDrinks(raw, pkg);
const facts = bookedFacts(session as Record<string, unknown>, messages);
const filled = { ...drinks.data, ...bookingFill(drinks.data, factsAsSession(facts)) };
const eventData = applyDiveSetMenu(filled) as Record<string, unknown>;

const writes = [
  `sessions ${sessionId}: event_data saved, status submitted, version 1, event_updates version 1 (recordSubmission)`,
  ...(isBlank(session.event_date) && eventData.event_date ? [`sessions ${sessionId}: event_date "${String(session.event_date)}" -> "${String(eventData.event_date)}"`] : []),
  ...(flag("--clear-role") ? [`sessions ${sessionId}: planning_role "${String(session.planning_role)}" -> null`] : []),
  `events: one new row (shopping list, transcript, status new, ghl_webhook_sent false)`,
  `conversation_logs ${sessionId}: status completed, event_data saved`,
];
console.log(`[${mode}] ${session.name} — ${pkg} — session ${sessionId}`);
console.log(`Drinks not finalized: ${drinks.notFinalized ? "yes" : "no"}${drinks.unconfirmed.length ? `; held back (not confirmed): ${drinks.unconfirmed.join(", ")}` : ""}`);
console.log("Writes:");
for (const w of writes) console.log(`  - ${w}`);
console.log("Not done: no client message, no staff or admin text, no GHL webhook (use --send-ghl later).");
console.log("Event as it would be saved:");
console.log(JSON.stringify(eventData, null, 2));
if (!confirm) {
  console.log("\nNothing written. Add --confirm to save it.");
  process.exit(0);
}

const ok = await recordSubmission(sessionId, eventData as never);
if (!ok) {
  console.error("recordSubmission did not save (already submitted, or the update failed). Stopping before any other write.");
  process.exit(1);
}
const extra: Record<string, unknown> = {};
if (isBlank(session.event_date) && eventData.event_date) extra.event_date = String(eventData.event_date);
if (flag("--clear-role")) extra.planning_role = null;
if (Object.keys(extra).length) {
  const { error: e } = await supabase.from("sessions").update(extra).eq("id", sessionId);
  if (e) console.error(`sessions update (${Object.keys(extra).join(", ")}) failed: ${e.message}`);
}

const { data: saved } = await supabase.from("sessions").select("event_data").eq("id", sessionId).single();
const finalData = ((saved as { event_data: Record<string, unknown> } | null)?.event_data ?? eventData) as Record<string, unknown>;
let items: ReturnType<typeof generateShoppingList> = [];
try {
  items = generateShoppingList(finalData as never);
} catch {
  items = [];
}
const { age_range: _a, menu_style: _b, menu_notes: _c, menu_design_preference: _d, ...clean } = finalData;
const { row } = eventsInsertRow(clean);
const { error: insErr } = await supabase.from("events").insert({
  ...row,
  shopping_list: items.length ? items : null,
  shopping_list_text: items.length ? formatShoppingList(items) : null,
  conversation_transcript: transcript || null,
  status: "new",
  ghl_webhook_sent: false,
  ghl_webhook_response: null,
  menu_colors: finalData.menu_colors || null,
  menu_reference_photos: finalData.menu_reference_photos || null,
});
if (insErr) console.error(`events insert failed: ${insErr.message}`);
const { error: logErr } = await supabase.from("conversation_logs").update({ status: "completed", event_data: clean, updated_at: new Date().toISOString() }).eq("session_id", sessionId);
if (logErr) console.error(`conversation_logs update failed: ${logErr.message}`);
console.log(`\nSaved. Review it on the admin side, then send the GHL webhook with: --send-ghl --confirm`);
