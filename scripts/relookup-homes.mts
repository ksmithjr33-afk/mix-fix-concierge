// One time: look up again, with Google, every home address on file that was
// never found on the map (OpenStreetMap missed it before the Google key was
// set). Saves the location and home_geo_source "google"; one Google still
// cannot find is marked "none" and left without a location. Never texts
// anyone and never changes the address itself.
//
// Run upgrade-driving-miles.mts after this, so anyone newly found who is on
// an upcoming event gets driving miles stored.
//
//   Dry run (default, no lookups, writes nothing):
//     node --no-warnings --env-file=.env.local scripts/relookup-homes.mts
//   Look them up and save:
//     node --no-warnings --env-file=.env.local scripts/relookup-homes.mts --apply

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
process.env.TIMING_LOG = "0";

const apply = process.argv.includes("--apply");
if (apply && !process.env.GOOGLE_MAPS_API_KEY) {
  console.error("GOOGLE_MAPS_API_KEY is not set: nothing could be looked up with Google. Stopping.");
  process.exit(1);
}

const { supabase } = await import("../lib/supabase.ts");
const { relookupHomes } = await import("../lib/team/profile-db.ts");

const lines = await relookupHomes({ apply, gapMs: 100 });

const { data: staff } = await supabase.from("staff").select("id, name").in("id", [...new Set(lines.map((l) => l.staffId))]);
const names = new Map(((staff as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name]));

console.log(`${apply ? "APPLY" : "DRY RUN"}: home addresses never found on the map: ${lines.length}\n`);
for (const l of lines) console.log(`${names.get(l.staffId) ?? l.staffId}  "${l.address}"  (${l.note})`);
if (apply) console.log(`\nFound ${lines.filter((l) => l.found).length} of ${lines.length}. Now run scripts/upgrade-driving-miles.mts.`);
else console.log(`\nNothing written. Run with --apply to make ${lines.length} Google ${lines.length === 1 ? "lookup" : "lookups"}.`);
