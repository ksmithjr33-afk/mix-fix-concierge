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

/** "Clocked in since 4:32 PM", "Clocked out 10:05 PM", or "Not clocked in", in the event's time zone. */
export function clockStatus(p: { clockIn: string | null; clockOut: string | null }, tz: string = TZ, now: Date = new Date()): string {
  if (p.clockOut) return `Clocked out ${timeLabel(p.clockOut, now, tz)}`;
  if (p.clockIn) return `Clocked in since ${timeLabel(p.clockIn, now, tz)}`;
  return "Not clocked in";
}
