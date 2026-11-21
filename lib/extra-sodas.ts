// Sodas a client asked for in their special requests, added to their shopping
// list. Pure, no imports, safe in the browser. When the client's page hides the
// free text of older special requests, the sodas are passed on by name in
// event_data.extra_sodas so the list stays the same (lib/team-notes.ts).

export function parseExtraSodas(specialRequests?: unknown): string[] {
  if (typeof specialRequests !== "string" || !specialRequests) return [];
  const extras: string[] = [];
  const lower = specialRequests.toLowerCase();
  const sodaKeywords = [
    { match: "diet coke", label: "Diet Coke" },
    { match: "diet cola", label: "Diet Coke" },
    { match: "sprite", label: "Sprite" },
    { match: "dr pepper", label: "Dr Pepper" },
    { match: "ginger ale", label: "Ginger ale" },
    { match: "lemon lime", label: "Lemon lime soda" },
    { match: "7up", label: "7UP" },
    { match: "coca cola", label: "Coca Cola" },
    { match: "coke", label: "Coca Cola" },
    { match: "root beer", label: "Root beer" },
  ];
  for (const soda of sodaKeywords) {
    if (lower.includes(soda.match)) {
      extras.push(soda.label);
    }
  }
  return extras;
}

/** The extra sodas for an event: named outright, or read from its special requests. */
export function extraSodasOf(ed: { extra_sodas?: unknown; special_requests?: unknown }): string[] {
  return Array.isArray(ed.extra_sodas) ? ed.extra_sodas.map(String) : parseExtraSodas(ed.special_requests);
}
