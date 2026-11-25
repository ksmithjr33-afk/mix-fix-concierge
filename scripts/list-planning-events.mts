// Read only: the bookings showing on the team side as "Planning not finished"
// (lib/planning.ts), soonest first, with days since booked and whether hidden.
// Writes nothing, messages nobody.
//
//   node --no-warnings --env-file=.env.local scripts/list-planning-events.mts

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
process.env.TIMING_LOG = "0";

const { supabase } = await import("../lib/supabase.ts");
const { showsOnTeam, daysSinceBooked } = await import("../lib/planning.ts");
const { eventDay } = await import("../lib/team/time.ts");

const rows: Record<string, unknown>[] = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await supabase.from("sessions").select("id, name, email, status, event_date, package_type, created_at, booked_on").eq("status", "in_progress").range(from, from + 499);
  if (error) throw new Error(`sessions read failed: ${error.message}`);
  rows.push(...((data as Record<string, unknown>[]) ?? []));
  if (!data || data.length < 500) break;
}
const { data: hiddenRows } = await supabase.from("team_hidden_events").select("session_id");
const hidden = new Set(((hiddenRows as { session_id: string }[]) ?? []).map((h) => h.session_id));
const showing = rows
  .filter((r) => showsOnTeam(r as { id: string; status: string }))
  .map((r) => ({ id: String(r.id), name: String(r.name ?? r.email ?? "Unknown"), day: eventDay(r.event_date) ?? "no date", pkg: String(r.package_type ?? ""), since: daysSinceBooked(r as { id: string }), hidden: hidden.has(String(r.id)) }))
  .sort((a, b) => a.day.localeCompare(b.day));
console.log(`${rows.length} unfinished sessions in all. ${showing.length} show as Planning not finished (${showing.filter((s) => s.hidden).length} of them already hidden).`);
for (const s of showing) console.log([s.day, s.name, s.pkg, s.since === null ? "booked ?" : `booked ${s.since}d ago`, s.hidden ? "HIDDEN" : "", s.id].filter(Boolean).join(" | "));
