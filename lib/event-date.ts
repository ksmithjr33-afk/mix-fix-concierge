// Event date parsing shared by every formatter that renders event_date.
//
// event_date arrives in whatever shape the bot or booking system wrote it:
// "2026-12-12", "December 12, 2026", "Dec 12th", "August 12th". A bare
// YYYY-MM-DD string handed to new Date() is read as UTC midnight, which is the
// evening before in Dallas, so those are built as a local calendar date instead.

/**
 * Parse an event date as a local calendar date. Returns null if unparseable.
 * Dates with no year (or that parse to a year before 2000) get the current year.
 */
export function parseEventDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim();

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[T\s])/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // Strip ordinal suffixes only after a digit, so "August 12th" keeps its "st".
  const cleaned = s.replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let parsed = new Date(cleaned);
  if (isNaN(parsed.getTime())) {
    parsed = new Date(`${cleaned} ${new Date().getFullYear()}`);
  }
  if (isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() < 2000) {
    parsed.setFullYear(new Date().getFullYear());
  }
  return parsed;
}

/** Event date as YYYY-MM-DD, or the original string if it cannot be parsed. */
export function toIsoEventDate(dateStr: string | null | undefined): string {
  const d = parseEventDate(dateStr);
  if (!d) return dateStr ?? "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
