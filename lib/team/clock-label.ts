// Time labels for the event page, in the event's time zone (America/Chicago by
// default). No imports, so client components can use it.

const TZ = "America/Chicago";

function dayOf(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "4:12 PM" on the same day as `now` in `tz`, otherwise "Nov 13, 4:12 PM". */
export function timeLabel(iso: string | null | undefined, now: Date = new Date(), tz: string = TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const sameDay = dayOf(d, tz) === dayOf(now, tz);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  })
    .format(d)
    .replace(/[  ]/g, " ");
}
