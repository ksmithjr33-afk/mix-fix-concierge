// One time recovery: the legacy events table row for every client who
// finished the concierge while that insert was failing (2026-11-06 until the
// fix). Their sessions saved fine and are on the team side; only this flat
// copy is missing.
//
// Writes only new rows to public.events, built the same way /api/save-event
// builds them (shopping list, transcript, status "new"). It never changes a
// session, never sends a GHL webhook or note, and never messages a client.
// Hidden (test) events are skipped.
//
//   Dry run (default, writes nothing):
//     node --no-warnings --env-file=.env.local scripts/recover-events-rows.mts
//   Write the rows listed by the dry run:
//     node --no-warnings --env-file=.env.local scripts/recover-events-rows.mts --apply

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
process.env.TIMING_LOG = "0";

const apply = process.argv.includes("--apply");
const SINCE = "2026-11-06T00:00:00Z";

const { supabase } = await import("../lib/supabase.ts");
const { eventsInsertRow } = await import("../lib/events-row.ts");
const { generateShoppingList, formatShoppingList } = await import("../lib/shopping-list.ts");

type Msg = { role: string; content: string };

const { data: sessions, error } = await supabase
  .from("sessions")
  .select("id, name, email, event_data, submitted_at")
  .eq("status", "submitted")
  .gte("submitted_at", SINCE)
  .order("submitted_at", { ascending: true });
if (error) throw new Error(`sessions read failed: ${error.message}`);

const { data: hiddenRows } = await supabase.from("team_hidden_events").select("session_id");
const hidden = new Set(((hiddenRows as { session_id: string }[]) ?? []).map((h) => h.session_id));

const { data: existing, error: evErr } = await supabase.from("events").select("client_name, email, event_date").gte("created_at", SINCE);
if (evErr) throw new Error(`events read failed: ${evErr.message}`);
const key = (name: unknown, email: unknown) => `${String(name ?? "").trim().toLowerCase()}|${String(email ?? "").trim().toLowerCase()}`;
const have = new Set(((existing as Record<string, unknown>[]) ?? []).map((e) => key(e.client_name, e.email)));

let todo = 0;
let written = 0;
for (const s of (sessions as { id: string; name: string | null; email: string | null; event_data: Record<string, unknown> | null; submitted_at: string }[]) ?? []) {
  const ed = s.event_data ?? {};
  const label = `${s.submitted_at.slice(0, 16)}  ${String(ed.client_name ?? s.name ?? "")}  event ${String(ed.event_date ?? "")}  session ${s.id.slice(0, 8)}`;
  if (hidden.has(s.id)) {
    console.log(`skip (hidden)   ${label}`);
    continue;
  }
  if (have.has(key(ed.client_name, ed.email))) {
    console.log(`skip (has row)  ${label}`);
    continue;
  }
  todo++;
  if (!apply) {
    console.log(`would write     ${label}`);
    continue;
  }
  const { data: log } = await supabase.from("conversation_logs").select("messages").eq("session_id", s.id).maybeSingle();
  const transcript = (((log as { messages?: Msg[] } | null)?.messages ?? []) as Msg[])
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  let items: ReturnType<typeof generateShoppingList> = [];
  try {
    items = generateShoppingList(ed as never);
  } catch {
    items = [];
  }
  const { age_range: _a, menu_style: _b, menu_notes: _c, menu_design_preference: _d, ...clean } = ed;
  const { error: insErr } = await supabase.from("events").insert({
    ...eventsInsertRow(clean).row,
    shopping_list: items.length > 0 ? items : null,
    shopping_list_text: items.length > 0 ? formatShoppingList(items) : null,
    conversation_transcript: transcript || null,
    status: "new",
    ghl_webhook_sent: false,
    ghl_webhook_response: null,
    menu_colors: ed.menu_colors || null,
    menu_reference_photos: ed.menu_reference_photos || null,
  });
  if (insErr) console.log(`FAILED          ${label}: ${insErr.message}`);
  else {
    written++;
    console.log(`wrote           ${label}`);
  }
}
console.log(apply ? `\nWrote ${written} of ${todo} events rows.` : `\nDry run: ${todo} events rows would be written. Nothing was changed. Add --apply to write them.`);
