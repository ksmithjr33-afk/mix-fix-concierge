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

export interface CalLinks {
  prev: string;
  next: string;
  week: string;
  month: string;
  today: string;
}

/** The calendar's navigation links, built on the server so the view needs no function props. */
export function calLinksOf(grid: Pick<CalGrid, "prev" | "next">, link: (o: { mode?: CalMode; d?: string }) => string): CalLinks {
  return { prev: link({ d: grid.prev }), next: link({ d: grid.next }), week: link({ mode: "week" }), month: link({ mode: "month" }), today: link({ d: "today" }) };
}

/** The events a calendar shows: the whole week, or the days inside the month. */
export function shownEvents(grid: CalGrid): EventListItem[] {
  return grid.days.filter((d) => d.inMonth).flatMap((d) => d.events);
}

// ----- The bigger calendar: Month, Week and List views, filter, preferences -----

export type CalView = "month" | "week" | "list";
export const CAL_VIEWS: readonly CalView[] = ["month", "week", "list"];
export type Layout = "list" | "calendar";

/** How many days the List view shows at a time. */
export const LIST_DAYS = 28;

/**
 * Each person's last calendar choices. The view is remembered separately for
 * a laptop and a phone, so a phone still opens on the List view by default.
 */
export interface CalPrefs {
  wideView: CalView | null;
  phoneView: CalView | null;
  market: string; // a market key, or "all"
  eventsLayout: Layout | null; // /team/events: the event list or the calendar
  staffingLayout: Layout | null; // /team/admin/events
}

export const DEFAULT_PREFS: CalPrefs = { wideView: null, phoneView: null, market: "all", eventsLayout: null, staffingLayout: null };

const isView = (v: unknown): v is CalView => typeof v === "string" && (CAL_VIEWS as readonly string[]).includes(v);
const isLayout = (v: unknown): v is Layout => v === "list" || v === "calendar";

/** Saved or posted preferences, with anything unknown dropped. `markets` are the allowed market keys. */
export function cleanPrefs(raw: unknown, markets: readonly string[]): CalPrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    wideView: isView(r.wideView) ? r.wideView : null,
    phoneView: isView(r.phoneView) ? r.phoneView : null,
    market: typeof r.market === "string" && markets.includes(r.market) ? r.market : "all",
    eventsLayout: isLayout(r.eventsLayout) ? r.eventsLayout : null,
    staffingLayout: isLayout(r.staffingLayout) ? r.staffingLayout : null,
  };
}

/** The view to open: the remembered one, else List on a phone and Month on a laptop. */
export function startView(prefs: Pick<CalPrefs, "wideView" | "phoneView">, phone: boolean): CalView {
  return (phone ? prefs.phoneView : prefs.wideView) ?? (phone ? "list" : "month");
}

/** The layout to open: the address bar first, then the remembered one, else the event list. */
export function pickLayout(asked: unknown, saved: Layout | null): Layout {
  return isLayout(asked) ? asked : (saved ?? "list");
}

export interface ListRange {
  from: string;
  to: string;
  label: string;
  prev: string;
  next: string;
  days: CalDay[]; // only the days with events (or marked unavailable)
}

/** The List view: 4 weeks from `anchor`, as an agenda of the days that have something on them. */
export function listRange(anchor: string, today: string, items: EventListItem[], marked: Set<string> = new Set()): ListRange {
  const from = anchor;
  const to = addDays(anchor, LIST_DAYS - 1);
  const byDay = new Map<string, EventListItem[]>();
  for (const e of items) {
    if (!e.day || e.day < from || e.day > to) continue;
    byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  }
  const days: CalDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const evs = byDay.get(d);
    if (!evs && !marked.has(d)) continue;
    const wd = WEEKDAYS[dow(d)];
    days.push({
      ymd: d,
      dayNum: parts(d)[2],
      weekday: wd.slice(0, 3),
      label: `${wd}, ${MONTHS[parts(d)[1] - 1]} ${parts(d)[2]}`,
      inMonth: true,
      today: d === today,
      events: (evs ?? []).sort((a, b) => arrivalMinutes(a.arrival) - arrivalMinutes(b.arrival) || a.title.localeCompare(b.title)),
    });
  }
  const [fy] = parts(from);
  const [ty] = parts(to);
  const label = `${shortMonth(from)} ${parts(from)[2]}${fy !== ty ? `, ${fy}` : ""} to ${shortMonth(to)} ${parts(to)[2]}, ${ty}`;
  return { from, to, label, prev: addDays(anchor, -LIST_DAYS), next: addDays(anchor, LIST_DAYS), days };
}

/** Keep only one market's events ("all" keeps every event). Events with no market only show under "all". */
export function filterMarket(items: EventListItem[], market: string): EventListItem[] {
  return market === "all" ? items : items.filter((e) => e.market === market);
}

/** Every day from..to (inclusive) covered by unavailable rows, as YYYY-MM-DD. */
export function unavailableDays(rows: { start_day: string; end_day: string }[], from: string, to: string): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    const a = r.start_day > from ? r.start_day : from;
    const b = r.end_day < to ? r.end_day : to;
    for (let d = a; d <= b; d = addDays(d, 1)) out.add(d);
  }
  return [...out].sort();
}

export type ChipTone = "full" | "open" | "none" | "mine" | "offered" | "shift" | "plain";

/**
 * A chip's color. Admins: fully staffed, spots open, or nobody assigned.
 * Bartenders: their own event (accepted or offered) or an open shift.
 */
export function chipTone(e: EventListItem): ChipTone {
  if (e.kind === "shift") return "shift";
  if (e.staffing) return e.staffing;
  if (e.status === "accepted") return "mine";
  if (e.status === "offered") return "offered";
  return "plain";
}
