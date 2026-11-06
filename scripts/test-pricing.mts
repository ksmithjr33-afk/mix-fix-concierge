// Reproduces the reference points from the Read me tab of Pricing v22.
// Run: npm run test:pricing   (plain node, Node 22.6+ strips the types)
// Exits 1 if any total is off.

import { priceEvent } from "../lib/pricing.ts";

const base = { guests: 100, hours: 4, bartenders: 2, tipJar: true };

const cases: Array<[string, string, boolean, number]> = [
  ["Beer and Wine", "beerwine", false, 1090],
  ["Dive Bar", "dive", false, 1249],
  ["Full", "full", false, 1749],
  ["Premium", "premium", false, 3074],
  ["Wedding Beer and Wine", "beerwine", true, 1221],
  ["Wedding Dive Bar", "dive", true, 1397],
  ["The Big Day Bar", "wedding", true, 1865],
  ["Wedding Full with a barback", "full", true, 2134],
  ["Wedding Premium", "premium", true, 3244],
];

let failed = 0;
for (const [label, pkg, isWedding, expected] of cases) {
  const r = priceEvent({ ...base, package: pkg, isWedding });
  const ok = r?.total === expected;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(28)} expected $${expected}  got $${r?.total ?? "null"}` +
      (r ? `  (package $${r.packagePrice} + gratuity $${r.gratuity})` : "")
  );
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} reference points are off.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} reference points match.`);
