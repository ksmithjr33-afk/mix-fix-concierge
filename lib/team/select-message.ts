// The staffing page's Select mode result line. Pure and tiny, so the browser can load it.

/** The result line after "Post <n> shifts" in Select mode. */
export function selectedMessage(r: { posted: number; texted: number; held: number; skipped: { title: string; reason: string }[] }): string {
  const parts = [`Posted ${r.posted} ${r.posted === 1 ? "shift" : "shifts"}.`];
  if (r.posted > 0) parts.push(`${r.texted} ${r.texted === 1 ? "text" : "texts"} sent, one per bartender per market.`);
  if (r.held > 0) parts.push(`${r.held} held for quiet hours, sent at 8:00 AM.`);
  if (r.skipped.length > 0) parts.push(`Skipped ${r.skipped.length}: ${r.skipped.map((s) => `${s.title} (${s.reason})`).join(", ")}.`);
  return parts.join(" ");
}
