// DRY RUN ONLY. Proposes, for every submitted event whose special requests are
// hidden on the client page (submitted before 2026-11-21, so written for our
// team), a client line written to the client and a team note. Writes nothing
// to the database: it only saves a review file. Applying it is a separate,
// later step, once the owner has reviewed and approved the file.
//
// Each event's special requests text (and its package and event type, never a
// name, email or phone) goes to the Claude API, the same provider the
// concierge already uses for these events.
//
//   node --no-warnings --env-file=.env.local scripts/rewrite-requests-dry-run.mts --out /path/outside/the/repo
//   (--limit 5 to try a few first)

import { registerHooks } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
process.env.TIMING_LOG = "0";

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const { supabase } = await import("../lib/supabase.ts");
const { requestsShown, splitTeamNotes } = await import("../lib/team-notes.ts");
const { REQUESTS_AND_NOTES_RULE } = await import("../lib/system-prompt.ts");

const arg = (f: string) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
const out = arg("--out");
const limit = Number(arg("--limit") ?? 0) || Infinity;
if (!out || out.startsWith(process.cwd())) {
  console.error("--out <folder outside the repo> is required.");
  process.exit(1);
}

type Row = { id: string; event_date: string | null; submitted_at: string | null; event_data: Record<string, unknown> | null };
const rows: Row[] = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await supabase.from("sessions").select("id, event_date, submitted_at, event_data").eq("status", "submitted").range(from, from + 499);
  if (error) throw new Error(`sessions read failed: ${error.message}`);
  rows.push(...((data as Row[]) ?? []));
  if (!data || data.length < 500) break;
}
const THIRD_PERSON = /\b(the )?client\b|\bthey\b|\btheir\b|text them/i;
const BANNED = /\bthe client\b|\bclient\b|\bclient's\b|\bthey\b|\btheir\b|text them|ask the client/i;
const todo = rows
  .filter((r) => r.event_data && !requestsShown(r.event_data))
  .map((r) => ({ r, text: splitTeamNotes(r.event_data!.special_requests).requests }))
  .filter((x) => x.text.trim() && !/^(none|no|n\/a)\.?$/i.test(x.text.trim()))
  .slice(0, limit);

const SYSTEM = `You rewrite one event's special requests for a mobile bar company. The text was written by our concierge for our team, and the client is about to see their requests on their own event page.

${REQUESTS_AND_NOTES_RULE}

Split the text into:
- client_line: everything the client asked for or told us, written to them in plain words ("You will provide your own cups and napkins."). Short sentences, one per item, joined with a space. No follow ups, opinions, staff instructions, or anything they would be surprised or hurt to read. Empty string if nothing is for the client.
- team_note: everything else, for our team only, kept in our team's wording (follow ups, what the client says they were promised, instructions to staff, doubts). Empty string if nothing.
Lose nothing: every fact in the text must be in one of the two. Do not add facts, prices or promises that are not in the text. Answer with only a JSON object: {"client_line": "...", "team_note": "..."}`;

const client = new Anthropic();
type Result = { id: string; event_date: string | null; package: string; original: string; matched_scan: boolean; client_line: string; team_note: string; flags: string[] };

async function propose(x: (typeof todo)[number]): Promise<Result> {
  const ed = x.r.event_data!;
  const base = { id: x.r.id, event_date: x.r.event_date, package: String(ed.package ?? ""), original: x.text, matched_scan: THIRD_PERSON.test(x.text) };
  try {
    const res = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Package: ${base.package}\nEvent type: ${String(ed.event_type ?? "")}\n\nSpecial requests:\n${x.text}` }],
    } as never) as Anthropic.Message;
    if (res.stop_reason === "refusal") return { ...base, client_line: "", team_note: x.text, flags: ["declined by the model: review by hand"] };
    const raw = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { client_line?: unknown; team_note?: unknown };
    const client_line = String(json.client_line ?? "").trim();
    const team_note = String(json.team_note ?? "").trim();
    const flags: string[] = [];
    if (BANNED.test(client_line)) flags.push("client line still speaks about the client");
    if (!client_line && !team_note) flags.push("both empty");
    return { ...base, client_line, team_note, flags };
  } catch (err) {
    return { ...base, client_line: "", team_note: x.text, flags: [`not proposed (${err instanceof Error ? err.message.slice(0, 80) : "error"}): review by hand`] };
  }
}

const results: Result[] = [];
const queue = [...todo];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      results.push(await propose(x));
      process.stdout.write(`\r${results.length} of ${todo.length}`);
    }
  })
);
results.sort((a, b) => a.id.localeCompare(b.id));

mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const jsonPath = join(out, `special-requests-rewrite-${stamp}.json`);
const mdPath = join(out, `special-requests-rewrite-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify(results, null, 2));
const flagged = results.filter((r) => r.flags.length);
const md = [
  `# Special requests rewrite: DRY RUN, not applied`,
  ``,
  `${results.length} events whose special requests are hidden on the client page. ${results.filter((r) => r.matched_scan).length} of them matched the third person scan (the 187). ${flagged.length} flagged for a closer look.`,
  `Nothing was changed. These events stay hidden on the client page until this is reviewed and approved.`,
  ``,
  ...results.flatMap((r) => [
    `## ${r.id}  (${r.event_date ?? "no date"}, ${r.package || "no package"})${r.flags.length ? `  FLAGGED: ${r.flags.join("; ")}` : ""}`,
    ``,
    `**Now (team wording):** ${r.original.replace(/\n/g, " / ")}`,
    ``,
    `**Client would see:** ${r.client_line || "(nothing)"}`,
    ``,
    `**Team note:** ${r.team_note || "(nothing)"}`,
    ``,
  ]),
].join("\n");
writeFileSync(mdPath, md);
console.log(`\nDRY RUN: ${results.length} proposed, ${flagged.length} flagged. Nothing written to the database.\n  ${mdPath}\n  ${jsonPath}`);
