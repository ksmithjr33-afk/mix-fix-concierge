// The calendar view of an events list: a Monday to Sunday week, or a month
// grid of whole weeks. Pure, no database. Days are YYYY-MM-DD event days.

import type { EventListItem } from "@/lib/team/event-list";

export type CalMode = "week" | "month";

export interface CalDay {
  ymd: string;
  dayNum: number;
  weekday: string; // "Mon"
  label: string; // "Monday, Nov 9"
  inMonth: boolean; // false for the leading and trailing days of a month grid
  today: boolean;
  events: EventListItem[];
}

export interface CalGrid {
  mode: CalMode;
  anchor: string;
  label: string; // "Nov 9 to 15, 2026" or "November 2026"
  prev: string;
  next: string;
  days: CalDay[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m, d];
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function dow(ymd: string): number {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Monday on or before the day. */
export function weekStart(ymd: string): string {
  return addDays(ymd, -((dow(ymd) + 6) % 7));
}

function monthFirst(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function addMonths(ymd: string, n: number): string {
  const [y, m] = parts(ymd);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

function monthLast(ymd: string): string {
  return addDays(addMonths(ymd, 1), -1);
}

export function isYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
}

export function calMode(v: unknown): CalMode {
  return v === "month" ? "month" : "week";
}

/** "4:00 PM" as minutes after midnight, for ordering. Unknown times go last. */
export function arrivalMinutes(arrival: string): number {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(arrival.trim());
  if (!m) return 24 * 60 + 1;
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return h * 60 + Number(m[2]);
}

function shortMonth(ymd: string): string {
  return MONTHS[parts(ymd)[1] - 1].slice(0, 3);
}

function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const [sy, , sd] = parts(start);
  const [ey, , ed] = parts(end);
  if (sy !== ey) return `${shortMonth(start)} ${sd}, ${sy} to ${shortMonth(end)} ${ed}, ${ey}`;
  if (start.slice(5, 7) !== end.slice(5, 7)) return `${shortMonth(start)} ${sd} to ${shortMonth(end)} ${ed}, ${ey}`;
  return `${shortMonth(start)} ${sd} to ${ed}, ${ey}`;
}

/** The week or month holding `anchor`, with each day's events in arrival order. Undated events are left out. */
export function calendarGrid(mode: CalMode, anchor: string, today: string, items: EventListItem[]): CalGrid {
  let start: string;
  let end: string;
  let label: string;
  let prev: string;
  let next: string;
  if (mode === "week") {
    start = weekStart(anchor);
    end = addDays(start, 6);
    label = weekLabel(start);
    prev = addDays(start, -7);
    next = addDays(start, 7);
  } else {
    const first = monthFirst(anchor);
    start = weekStart(first);
    end = addDays(weekStart(monthLast(first)), 6);
    label = `${MONTHS[parts(first)[1] - 1]} ${parts(first)[0]}`;
    prev = addMonths(first, -1);
    next = addMonths(first, 1);
  }
  const byDay = new Map<string, EventListItem[]>();
  for (const e of items) {
    if (!e.day || e.day < start || e.day > end) continue;
    byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  }
  const days: CalDay[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = WEEKDAYS[dow(d)];
    days.push({
      ymd: d,
      dayNum: parts(d)[2],
      weekday: wd.slice(0, 3),
      label: `${wd}, ${shortMonth(d)} ${parts(d)[2]}`,
      inMonth: mode === "week" || d.slice(0, 7) === anchor.slice(0, 7),
      today: d === today,
      events: (byDay.get(d) ?? []).sort((a, b) => arrivalMinutes(a.arrival) - arrivalMinutes(b.arrival) || a.title.localeCompare(b.title)),
    });
  }
  return { mode, anchor, label, prev, next, days };
}
