// One time: upgrade stored mileage on upcoming events from straight line to
// driving miles, now that GOOGLE_MAPS_API_KEY is set.
//
// Looks at accepted assignments on events from today on (Pacific date, so no
// event still happening today is skipped) whose stored miles are straight
// line or were never stored. Apply makes one Routes API call each and stores
// driving miles. Adjustments an admin or manager made are kept. A call that
// fails leaves that row as it was. Never sends a text or changes an assignment.
//
//   Dry run (default, no Routes calls, writes nothing):
//     node --no-warnings --env-file=.env.local scripts/upgrade-driving-miles.mts
//   Make the calls and store driving miles:
//     node --no-warnings --env-file=.env.local scripts/upgrade-driving-miles.mts --apply

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
  console.error("GOOGLE_MAPS_API_KEY is not set: every row would stay straight line. Stopping.");
  process.exit(1);
}

const { supabase } = await import("../lib/supabase.ts");
const { todayIn } = await import("../lib/team/time.ts");
const { upgradeToDriving } = await import("../lib/team/pay-db.ts");

const fromDay = todayIn("America/Los_Angeles");
const lines = await upgradeToDriving({ fromDay, apply });

const { data: staff } = await supabase.from("staff").select("id, name").in("id", [...new Set(lines.map((l) => l.staffId))]);
const names = new Map(((staff as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name]));
const mi = (m: number | null) => (m === null ? "none" : `${m} mi`);

console.log(`${apply ? "APPLY" : "DRY RUN"}: accepted assignments on events from ${fromDay} without driving miles: ${lines.length}\n`);
for (const l of lines) {
  const after = l.after ? ` -> ${mi(l.after.miles)} ${l.after.source}` : "";
  console.log(`${l.eventDate}  session ${l.sessionId.slice(0, 8)}  ${names.get(l.staffId) ?? l.staffId}  ${mi(l.before.miles)} ${l.before.source}${after}  (${l.note})`);
}
if (apply) {
  const up = lines.filter((l) => l.note === "upgraded").length;
  console.log(`\nUpgraded ${up} of ${lines.length}. Run again to retry any that did not upgrade.`);
} else {
  console.log(`\nNothing written. Run with --apply to make ${lines.length} Routes API ${lines.length === 1 ? "call" : "calls"}.`);
}
