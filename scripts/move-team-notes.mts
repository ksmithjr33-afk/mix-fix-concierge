// One time: move the team notes ("Drinks not finalized: ..." and "Not
// confirmed: ...") out of special_requests into event_data.team_notes, for
// every session that has them, so the client page never shows them. An older
// "Not confirmed" line's drinks also go in unconfirmed_drinks (names only), so
// the client gets the Yes or No question on their page. The team side shows
// special requests and team notes together, so it looks the same after.
//
// Not a client change: no version bump, no history row, no GHL, no texts.
//
//   Dry run (default, writes nothing):
//     node --no-warnings --env-file=.env.local scripts/move-team-notes.mts
//   Write it:
//     node --no-warnings --env-file=.env.local scripts/move-team-notes.mts --confirm

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
process.env.TIMING_LOG = "0";

const { supabase } = await import("../lib/supabase.ts");
const { moveTeamNotes, TEAM_NOTES, UNCONFIRMED_DRINKS } = await import("../lib/team-notes.ts");

const confirm = process.argv.includes("--confirm");
type Row = { id: string; name: string | null; version: number; event_data: Record<string, unknown> | null };
const rows: Row[] = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await supabase.from("sessions").select("id, name, version, event_data").not("event_data", "is", null).range(from, from + 499);
  if (error) throw new Error(`sessions read failed: ${error.message}`);
  rows.push(...((data as Row[]) ?? []));
  if (!data || data.length < 500) break;
}

let moved = 0;
let failed = 0;
for (const r of rows) {
  const next = r.event_data ? moveTeamNotes(r.event_data) : null;
  if (!next) continue;
  moved++;
  console.log(`\n${r.name ?? "(no name)"} (session ${r.id}, version ${r.version})`);
  console.log(`  special_requests: ${JSON.stringify(r.event_data!.special_requests ?? null)}`);
  console.log(`  -> special_requests: ${JSON.stringify(next.special_requests ?? null)}`);
  console.log(`  -> ${TEAM_NOTES}: ${JSON.stringify(next[TEAM_NOTES] ?? null)}`);
  if (next[UNCONFIRMED_DRINKS]) console.log(`  -> ${UNCONFIRMED_DRINKS}: ${JSON.stringify(next[UNCONFIRMED_DRINKS])}`);
  if (!confirm) continue;
  // Only if nobody changed the event since it was read.
  const { data, error } = await supabase.from("sessions").update({ event_data: next }).eq("id", r.id).eq("version", r.version).select("id");
  if (error || !data || data.length === 0) {
    failed++;
    console.error(`  NOT SAVED: ${error?.message ?? "the event changed since it was read; run again"}`);
  } else console.log("  saved");
}
console.log(`\n${confirm ? "CONFIRM" : "DRY RUN"}: ${moved} session${moved === 1 ? "" : "s"} with team notes in special requests${confirm ? `, ${moved - failed} saved, ${failed} not saved` : ". Nothing written. Add --confirm to save."}`);
