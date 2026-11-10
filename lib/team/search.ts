// Search box filter for the events list. No imports, so the client bundle stays small.

/** Every word typed must appear in the event's name text. */
export function matchesSearch(e: { search: string }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => e.search.includes(w));
}
