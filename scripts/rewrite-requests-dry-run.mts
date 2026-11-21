// DRY RUN ONLY. Proposes, for every submitted event whose special requests are
// hidden on the client page (submitted before 2026-11-21, so written for our
// team), a client line written to the client and a team note. The same for
// each hidden team voice field (beer and wine details, bar details, parking,
// bar on site: lib/team-notes.ts TEAM_VOICE_FIELDS). Writes nothing to the
// database: it only saves a review file. Applying it is a separate, later
// step, once the owner has reviewed and approved the file.
//
// Each event's special requests text (and its package and event type, never a
// name, email or phone) goes to the Claude API, the same provider the
// concierge already uses for these events.
//
//   node --no-warnings --env-file=.env.local scripts/rewrite-requests-dry-run.mts --out /path/outside/the/repo
//   (--limit 5 to try a few first)
//   --reuse <earlier .json>: keep that file's special requests proposals word
//   for word (the ones already under review) and propose only what is new.

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
const { requestsShown, splitTeamNotes, fieldHidden, TEAM_VOICE_FIELDS, TEAM_VOICE_LABEL } = await import("../lib/team-notes.ts");
const { readFileSync } = await import("node:fs");
const { REQUESTS_AND_NOTES_RULE } = await import("../lib/system-prompt.ts");

const arg = (f: string) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
const out = arg("--out");
const limit = Number(arg("--limit") ?? 0) || Infinity;
const reusePath = arg("--reuse");
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
type Item = { r: Row; field: string; label: string; text: string };
const todo: Item[] = rows
  .filter((r) => r.event_data && !requestsShown(r.event_data))
  .flatMap((r): Item[] => {
    const ed = r.event_data!;
    const out: Item[] = [];
    const req = splitTeamNotes(ed.special_requests).requests;
    if (req.trim() && !/^(none|no|n\/a)\.?$/i.test(req.trim())) out.push({ r, field: "special_requests", label: "Special requests", text: req });
    for (const f of TEAM_VOICE_FIELDS) if (fieldHidden(ed, f)) out.push({ r, field: f, label: TEAM_VOICE_LABEL[f], text: String(ed[f]).trim() });
    return out;
  })
  .slice(0, limit);
type Earlier = { id: string; original: string; client_line: string; team_note: string; flags: string[]; field?: string };
const earlier: Earlier[] = reusePath ? JSON.parse(readFileSync(reusePath, "utf8")) : [];
const reused = (x: Item) => earlier.find((e) => e.id === x.r.id && (e.field ?? "special_requests") === x.field && e.original === x.text) ?? null;

const SYSTEM = `You rewrite one field of one event for a mobile bar company (the field is named in the message: special requests, beer and wine details, bar details, parking info, or bar on site). The text was written by our concierge for our team, and the client is about to see it on their own event page.

${REQUESTS_AND_NOTES_RULE}

Split the text into:
- client_line: everything the client asked for or told us, written to them in plain words ("You will provide your own cups and napkins."). Short sentences, one per item, joined with a space. No follow ups, opinions, staff instructions, or anything they would be surprised or hurt to read. Empty string if nothing is for the client.
- team_note: everything else, for our team only, kept in our team's wording (follow ups, what the client says they were promised, instructions to staff, doubts). Empty string if nothing.
Lose nothing: every fact in the text must be in one of the two. Do not add facts, prices or promises that are not in the text. Answer with only a JSON object: {"client_line": "...", "team_note": "..."}`;

const client = new Anthropic();
type Result = { id: string; field: string; label: string; event_date: string | null; package: string; original: string; matched_scan: boolean; client_line: string; team_note: string; flags: string[]; reused: boolean };

async function propose(x: (typeof todo)[number]): Promise<Result> {
  const ed = x.r.event_data!;
  const base = { id: x.r.id, field: x.field, label: x.label, event_date: x.r.event_date, package: String(ed.package ?? ""), original: x.text, matched_scan: THIRD_PERSON.test(x.text), reused: false };
  const was = reused(x);
  if (was) return { ...base, client_line: was.client_line, team_note: was.team_note, flags: was.flags, reused: true };
  try {
    const res = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Package: ${base.package}\nEvent type: ${String(ed.event_type ?? "")}\nField: ${x.label}\n\n${x.label}:\n${x.text}` }],
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
const order = ["special_requests", ...TEAM_VOICE_FIELDS] as string[];
results.sort((a, b) => a.id.localeCompare(b.id) || order.indexOf(a.field) - order.indexOf(b.field));

mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const name = reusePath || todo.some((x) => x.field !== "special_requests") ? "client-page-rewrites" : "special-requests-rewrite";
const jsonPath = join(out, `${name}-${stamp}.json`);
const mdPath = join(out, `${name}-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify(results, null, 2));
const flagged = results.filter((r) => r.flags.length);
const byEvent = new Map<string, Result[]>();
for (const r of results) byEvent.set(r.id, [...(byEvent.get(r.id) ?? []), r]);
const count = (f: (r: Result) => boolean) => results.filter(f).length;
const md = [
  `# Client page rewrites: DRY RUN, not applied`,
  ``,
  `${byEvent.size} events, ${results.length} items hidden on the client page. ${flagged.length} flagged for a closer look.`,
  `- Special requests: ${count((r) => r.field === "special_requests")} (${count((r) => r.field === "special_requests" && r.matched_scan)} matched the third person scan)${reusePath ? `, proposals kept word for word from ${reusePath.split("/").pop()}` : ""}`,
  ...TEAM_VOICE_FIELDS.map((f) => `- ${TEAM_VOICE_LABEL[f]}: ${count((r) => r.field === f)}`),
  ``,
  `Nothing was changed. These stay hidden on the client page until this is reviewed and approved.`,
  ``,
  ...[...byEvent.entries()].flatMap(([id, items]) => [
    `## ${id}  (${items[0].event_date ?? "no date"}, ${items[0].package || "no package"})`,
    ``,
    ...items.flatMap((r) => [
      `### ${r.label}${r.flags.length ? `  FLAGGED: ${r.flags.join("; ")}` : ""}`,
      ``,
      `**Now (team wording):** ${r.original.replace(/\n/g, " / ")}`,
      ``,
      `**Client would see:** ${r.client_line || "(nothing)"}`,
      ``,
      `**Team note:** ${r.team_note || "(nothing)"}`,
      ``,
    ]),
  ]),
].join("\n");
writeFileSync(mdPath, md);
console.log(`\nDRY RUN: ${results.length} items (${count((r) => r.reused)} kept from the earlier file), ${flagged.length} flagged. Nothing written to the database.\n  ${mdPath}\n  ${jsonPath}`);
