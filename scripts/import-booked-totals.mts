// Booked totals and amounts paid, from the owner's export (CSV). Never the
// price engine: every number comes from the file. The columns and file name
// are in lib/booked-import.ts.
//
// For each row it finds the one session with the same email or GHL contact id
// and the same event date, and:
// - sets booked_price.total when no total is on file (a different total on
//   file is reported and left alone);
// - records amount_paid when nothing is recorded as paid (a different
//   recorded amount is reported and left alone). It is recorded the way the
//   Business tab counts money collected (deposit plus payments): the deposit
//   part (up to the booked deposit, $150 by default) as the event's entered
//   deposit, and the rest as one payment. Collected, and the balance the
//   client sees (lib/balance.ts), then equal amount_paid exactly.
// No version bump, no history row, no GHL, no texts.
//
//   Dry run (default, writes nothing; saves a report next to the file):
//     node --no-warnings --env-file=.env.local scripts/import-booked-totals.mts /Users/USER/mix-fix-review/booked-totals.csv
//   Write it, after the report is reviewed:
//     ... scripts/import-booked-totals.mts /Users/USER/mix-fix-review/booked-totals.csv --confirm

import { registerHooks } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
process.env.TIMING_LOG = "0";

const { supabase } = await import("../lib/supabase.ts");
const { readImport, matchRow } = await import("../lib/booked-import.ts");
const { eventData } = await import("../lib/team/markets.ts");
const { eventSchedule } = await import("../lib/team/time.ts");
const { DEFAULT_DEPOSIT } = await import("../lib/price-change.ts");
const { recordedFrom } = await import("../lib/balance.ts");
type Candidate = import("../lib/booked-import.ts").Candidate;
type Outcome = import("../lib/booked-import.ts").Outcome;

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const confirm = process.argv.includes("--confirm");
if (!file) {
  console.error("Give the CSV file: scripts/import-booked-totals.mts /path/to/booked-totals.csv");
  process.exit(1);
}
const { rows, error } = readImport(readFileSync(file, "utf8"));
if (error) {
  console.error(error);
  process.exit(1);
}

type S = { id: string; status: string; version: number; email: string | null; ghl_contact_id: string | null; event_date: string | null; event_data: Record<string, unknown> | null; booked_price: Record<string, unknown> | null };
const sessions: S[] = [];
for (let from = 0; ; from += 500) {
  const { data, error: e } = await supabase.from("sessions").select("id, status, version, email, ghl_contact_id, event_date, event_data, booked_price").range(from, from + 499);
  if (e) throw new Error(`sessions read failed: ${e.message}`);
  sessions.push(...((data as S[]) ?? []));
  if (!data || data.length < 500) break;
}
const pays = new Map<string, { cents: number; n: number }>();
const fin = new Map<string, { deposit_paid_cents: number | null; balance_paid_cents: number | null }>();
{
  const { data, error: e } = await supabase.from("event_finance").select("session_id, deposit_paid_cents, balance_paid_cents");
  if (e) throw new Error(`event_finance read failed: ${e.message}`);
  for (const f of (data as { session_id: string; deposit_paid_cents: number | null; balance_paid_cents: number | null }[]) ?? []) fin.set(f.session_id, f);
}
for (let from = 0; ; from += 1000) {
  const { data, error: e } = await supabase.from("event_payments").select("session_id, amount_cents").range(from, from + 999);
  if (e) throw new Error(`event_payments read failed: ${e.message}`);
  for (const p of (data as { session_id: string; amount_cents: number }[]) ?? []) {
    const was = pays.get(p.session_id) ?? { cents: 0, n: 0 };
    pays.set(p.session_id, { cents: was.cents + p.amount_cents, n: was.n + 1 });
  }
  if (!data || data.length < 1000) break;
}
const lc = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const byId = new Map(sessions.map((s) => [s.id, s]));
const candidates: Candidate[] = sessions.map((s) => {
  const ed = eventData(s);
  const total = s.booked_price?.total;
  return {
    id: s.id,
    status: s.status,
    emails: [lc(s.email), lc(ed.email), lc(ed.client_email)].filter((e) => e && e !== "null"),
    contactId: (s.ghl_contact_id ?? "").trim(),
    eventDay: eventSchedule(ed).day,
    total: total === null || total === undefined || !Number.isFinite(Number(total)) ? null : Number(total),
    // Everything recorded as paid (an entered deposit, a legacy balance, payments), never the assumed deposit.
    ...(() => {
      const f = fin.get(s.id) ?? null;
      const p = pays.get(s.id);
      const rec = recordedFrom(f, p ? [{ cents: p.cents }] : []);
      return { paidCents: rec.cents, payments: (f?.deposit_paid_cents != null ? 1 : 0) + (f?.balance_paid_cents ? 1 : 0) + (p?.n ?? 0) };
    })(),
  };
});

const outcomes: Outcome[] = rows.map((r) => matchRow(r, candidates));
// Two rows for the same event: neither is applied.
const seen = new Map<string, number>();
for (const o of outcomes) if (o.kind === "matched") seen.set(o.c.id, (seen.get(o.c.id) ?? 0) + 1);
const final: Outcome[] = outcomes.map((o) => (o.kind === "matched" && seen.get(o.c.id)! > 1 ? { kind: "unmatched", row: o.row, reason: `more than one row in the file for event ${o.c.id}` } : o));

const today = new Date().toISOString().slice(0, 10);
// Only to split the paid amount into the deposit and the rest, the way the Business tab records them. Never subtracted from a total.
const depositOf = (s: S) => Number(s.booked_price?.deposit_paid ?? DEFAULT_DEPOSIT);
const $ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const who = (o: Outcome) => o.row.email || o.row.contactId;
let wrote = 0;
let failed = 0;
const lines: string[] = [];
const matched = final.filter((o): o is Extract<Outcome, { kind: "matched" }> => o.kind === "matched");
const changes = matched.filter((o) => o.setTotal || o.addPaid !== null);

for (const o of changes) {
  const s = byId.get(o.c.id)!;
  const what = [o.setTotal ? `total ${$(o.row.total!)}` : "", o.addPaid !== null ? `paid ${$(o.addPaid)} as of ${o.row.paidOn ?? today} (deposit ${$(Math.min(o.addPaid, depositOf(s)))}${o.addPaid > depositOf(s) ? ` + one payment of ${$(o.addPaid - depositOf(s))}` : ""})` : ""].filter(Boolean).join(", ");
  lines.push(`- line ${o.row.line}: ${who(o)}, ${o.row.eventDay} -> session ${o.c.id}: set ${what}${o.notes.length ? ` (${o.notes.join("; ")})` : ""}`);
  if (!confirm) continue;
  let ok = true;
  if (o.setTotal) {
    const booked = s.booked_price ?? { package_price: null, gratuity: null, bartenders: null, promo_code: null, custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: DEFAULT_DEPOSIT };
    const { data, error: e } = await supabase.from("sessions").update({ booked_price: { ...booked, total: o.row.total, source: "import" } }).eq("id", s.id).eq("version", s.version).select("id");
    if (e || !data?.length) {
      ok = false;
      lines.push(`  NOT SAVED (total): ${e?.message ?? "the event changed since it was read; run again"}`);
    }
  }
  if (ok && o.addPaid !== null) {
    const depositCents = Math.min(Math.round(o.addPaid * 100), Math.round(depositOf(s) * 100));
    const restCents = Math.round(o.addPaid * 100) - depositCents;
    const on = o.row.paidOn ?? today;
    const { error: e1 } = await supabase.from("event_finance").upsert({ session_id: s.id, deposit_paid_cents: depositCents, deposit_paid_on: on, updated_at: new Date().toISOString() }, { onConflict: "session_id" });
    if (e1) {
      ok = false;
      lines.push(`  NOT SAVED (deposit): ${e1.message}`);
    } else if (restCents > 0) {
      const { error: e } = await supabase.from("event_payments").insert({ session_id: s.id, amount_cents: restCents, paid_on: on, note: `Imported: paid as of ${on}`, created_by: null, created_by_name: "Import" });
      if (e) {
        ok = false;
        lines.push(`  NOT SAVED (payment): ${e.message}`);
      }
    }
  }
  if (ok) wrote++;
  else failed++;
}

const nothing = matched.filter((o) => !o.setTotal && o.addPaid === null);
const unmatched = final.filter((o) => o.kind === "unmatched") as Extract<Outcome, { kind: "unmatched" }>[];
const ambiguous = final.filter((o) => o.kind === "ambiguous") as Extract<Outcome, { kind: "ambiguous" }>[];
const report = [
  `# Booked totals import: ${confirm ? "APPLIED" : "DRY RUN, nothing written"}`,
  ``,
  `File: ${file}, ${rows.length} rows. ${changes.length} would change, ${nothing.length} already match or are left alone, ${unmatched.length} could not be matched, ${ambiguous.length} matched more than one event.`,
  confirm ? `Saved: ${wrote}. Not saved: ${failed}.` : `Nothing was written. Add --confirm to save.`,
  ``,
  `## Would set`,
  ...(lines.length ? lines : ["(none)"]),
  ``,
  `## Matched, nothing to set`,
  ...(nothing.length ? nothing.map((o) => `- line ${o.row.line}: ${who(o)}, ${o.row.eventDay} -> session ${o.c.id}${o.notes.length ? `: ${o.notes.join("; ")}` : ": already on file"}`) : ["(none)"]),
  ``,
  `## Could not match`,
  ...(unmatched.length ? unmatched.map((o) => `- line ${o.row.line}: ${who(o) || "(no email or id)"}, ${o.row.eventDateText || "(no date)"}: ${o.reason}`) : ["(none)"]),
  ``,
  `## More than one event`,
  ...(ambiguous.length ? ambiguous.map((o) => `- line ${o.row.line}: ${who(o)}, ${o.row.eventDay}: sessions ${o.ids.join(", ")}`) : ["(none)"]),
  ``,
].join("\n");
const out = join(dirname(file), `booked-totals-import-${today}${confirm ? "-applied" : ""}.md`);
writeFileSync(out, report);
console.log(report.split("\n").slice(0, 4).join("\n"));
console.log(`Report: ${out}`);
