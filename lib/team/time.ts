// Event times for the staff portal, always in America/Chicago. Pure, no database.

import { parseEventDate } from "@/lib/event-date";

export const TZ = "America/Chicago";

/** "6:00pm", "6 PM", "18:00", "12:00am" as minutes after midnight. Null if unreadable. */
export function parseClock(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.[0];
  if (min > 59 || h > 23) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "a") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (m[2] === undefined) {
    return null; // a bare number is not a time
  }
  return h * 60 + min;
}

/** Minutes after midnight as "4:30 PM". Wraps past midnight. */
export function formatClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

/** Event date as YYYY-MM-DD, or null. */
export function eventDay(dateStr: unknown): string | null {
  const d = parseEventDate(typeof dateStr === "string" ? dateStr : null);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Chicago's offset from UTC in minutes at an instant (negative, -360 or -300). */
function chicagoOffset(instant: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)])
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - instant) / 60000);
}

/** The instant a Chicago wall clock reads `minutes` after midnight on `ymd`. Minutes may pass 1440. */
export function chicagoInstant(ymd: string, minutes: number): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess - chicagoOffset(guess) * 60000;
  t = guess - chicagoOffset(t) * 60000; // settle across a DST change
  return new Date(t);
}

/** Today in Chicago as YYYY-MM-DD. */
export function chicagoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isWeddingEvent(ed: Record<string, unknown>): boolean {
  const type = String(ed.event_type ?? "").toLowerCase();
  const pkg = String(ed.package ?? "").toLowerCase();
  return type.includes("wedding") || pkg.includes("big day") || pkg.includes("wedding bar");
}

export interface EventSchedule {
  day: string | null; // YYYY-MM-DD
  startMin: number | null;
  endMin: number | null; // past 1440 when service ends after midnight
  arrivalMin: number | null; // 2 hours before service, 3 for weddings
  start: Date | null; // service start instant
  end: Date | null;
  arrival: Date | null;
}

export function eventSchedule(ed: Record<string, unknown>): EventSchedule {
  const day = eventDay(ed.event_date);
  const startMin = parseClock(ed.bar_service_start);
  let endMin = parseClock(ed.bar_service_end);
  if (startMin !== null && endMin !== null && endMin <= startMin) endMin += 1440;
  const arrivalMin = startMin === null ? null : startMin - (isWeddingEvent(ed) ? 180 : 120);
  return {
    day,
    startMin,
    endMin,
    arrivalMin,
    start: day && startMin !== null ? chicagoInstant(day, startMin) : null,
    end: day && endMin !== null ? chicagoInstant(day, endMin) : null,
    arrival: day && arrivalMin !== null ? chicagoInstant(day, arrivalMin) : null,
  };
}

/** "Saturday, December 12, 2026" from YYYY-MM-DD. */
export function longDate(ymd: string | null): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** "Dec 12" from YYYY-MM-DD, for texts. */
export function shortDate(ymd: string | null): string {
  if (!ymd) return "your event date";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** An instant as "Nov 9, 2026, 8:15 PM" in Chicago. */
export function chicagoStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(d)
    .replace(/[  ]/g, " ");
}
