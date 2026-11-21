// Read only: every chat, any date, where the concierge sent the closing line
// ("Please hang tight while we gather all your details together") but the
// session was never submitted. Writes nothing, messages nobody.
// "Closed" is the conversation log's last update: messages carry no time of their own.
//
//   node --no-warnings --env-file=.env.local scripts/list-closed-unsubmitted.mts

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
process.env.TIMING_LOG = "0";

const { supabase } = await import("../lib/supabase.ts");
const { sentClosing } = await import("../lib/unsaved-sessions.ts");
const { present } = await import("../lib/blank.ts");

type Log = { session_id: string; client_name: string | null; status: string | null; updated_at: string; messages: { role?: string; content?: unknown }[] | null };
const logs: Log[] = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await supabase.from("conversation_logs").select("session_id, client_name, status, updated_at, messages").range(from, from + 499);
  if (error) throw new Error(`conversation_logs read failed: ${error.message}`);
  logs.push(...((data as Log[]) ?? []));
  if (!data || data.length < 500) break;
}
const closed = logs.filter((l) => l.session_id && sentClosing(l.messages));
const ids = [...new Set(closed.map((l) => l.session_id))];
const sessions = new Map<string, Record<string, unknown>>();
for (let i = 0; i < ids.length; i += 100) {
  const { data, error } = await supabase.from("sessions").select("id, name, status, package_type, event_date, event_data").in("id", ids.slice(i, i + 100));
  if (error) throw new Error(`sessions read failed: ${error.message}`);
  for (const s of (data as Record<string, unknown>[]) ?? []) sessions.set(String(s.id), s);
}
const { data: hiddenRows } = await supabase.from("team_hidden_events").select("session_id");
const hidden = new Set(((hiddenRows as { session_id: string }[]) ?? []).map((h) => h.session_id));

const rows = closed
  .map((l) => ({ l, s: sessions.get(l.session_id) }))
  .filter(({ s }) => s && s.status !== "submitted")
  .sort((a, b) => b.l.updated_at.localeCompare(a.l.updated_at));
console.log(`${logs.length} conversations read; ${closed.length} sent the closing; ${rows.length} of those are not submitted.\n`);
for (const { l, s } of rows) {
  const ed = (s!.event_data ?? {}) as Record<string, unknown>;
  const first = (present(s!.name) ?? present(l.client_name) ?? "?").split(/\s+/)[0];
  const date = present(ed.event_date) ?? present(s!.event_date) ?? "no date saved";
  console.log(`${l.updated_at.slice(0, 16).replace("T", " ")} UTC | ${first} | ${present(s!.package_type) ?? "?"} | event ${date} | session ${l.session_id}${hidden.has(l.session_id) ? " | hidden (test)" : ""}`);
}
