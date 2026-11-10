// Time labels for the event page, in America/Chicago. No imports, so client components can use it.

const TZ = "America/Chicago";

function dayOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "4:12 PM" on the same Chicago day as `now`, otherwise "Nov 13, 4:12 PM". */
export function timeLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const sameDay = dayOf(d) === dayOf(now);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  })
    .format(d)
    .replace(/[  ]/g, " ");
}
