// "Running low": staff tell the office in two taps when they are short on
// something. Pure, no database. The database side is lib/team/low-stock-db.ts.
//
// - Event report: tied to an event happening today. Texted to admins and
//   managers right away, quiet hours or not, since someone may need to run
//   supplies.
// - Kit report: not tied to a live event (a bartender's own tools, or stock
//   for future events). No text right away: one summary of every open kit
//   report goes to admins and managers at 9 AM Central, nothing when none.
// - The same person, item and event inside 30 minutes updates the report
//   instead of adding one, with no new text, unless it went from low to out.
//
// Staff facing words and every text: client first name only, no hyphens.

import { BREAKDOWN_MIN } from "@/lib/team/clock";
import { eventDayStart, eventSchedule, todayIn, TZ } from "@/lib/team/time";

export const LOW_STOCK_LABEL = "Running low";
export const LEVELS = ["low", "out"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABEL: Record<Level, string> = { low: "Running low", out: "Out" };
export type ReportKind = "event" | "kit";
export type ReportStatus = "open" | "on_it" | "resolved";
export const STATUS_LABEL: Record<ReportStatus, string> = { open: "Open", on_it: "On it", resolved: "Resolved" };

export const MAX_ITEM = 120;
export const MAX_NOTE = 500;
export const SAME_REPORT_MS = 30 * 60_000;
export const SUMMARY_HOUR = 9; // 9 AM Central

export const isLevel = (v: unknown): v is Level => v === "low" || v === "out";

export interface LowStockRow {
  id: string;
  session_id: string | null;
  staff_id: string;
  item: string;
  level: Level;
  note: string | null;
  kind: ReportKind;
  status: ReportStatus;
  taken_by: string | null;
  taken_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** One line of text, trimmed and capped. */
export function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** "Limes", " limes " and "LIMES" are the same item. */
export const itemKey = (item: string) => item.replace(/\s+/g, " ").trim().toLowerCase();

/** The button shows from arrival (setup) through service end plus an hour of breakdown. */
export function lowStockWindow(ed: Record<string, unknown>): { from: Date; to: Date } | null {
  const s = eventSchedule(ed);
  const dayStart = eventDayStart(ed);
  const from = s.arrival ?? dayStart;
  if (!from) return null;
  const to = s.end ? new Date(s.end.getTime() + BREAKDOWN_MIN * 60_000) : dayStart ? new Date(dayStart.getTime() + 24 * 3_600_000) : null;
  return to ? { from, to } : null;
}

export function lowStockOpen(ed: Record<string, unknown>, now: Date = new Date()): boolean {
  const w = lowStockWindow(ed);
  return !!w && now.getTime() >= w.from.getTime() && now.getTime() <= w.to.getTime();
}

/** An event report is for an event happening today (its own time zone), or still in breakdown past midnight. */
export function eventIsLive(ed: Record<string, unknown>, now: Date = new Date()): boolean {
  const s = eventSchedule(ed);
  return (!!s.day && todayIn(s.tz, now) === s.day) || lowStockOpen(ed, now);
}

export function kindFor(hasEvent: boolean, ed: Record<string, unknown> | null, now: Date): ReportKind {
  return hasEvent && ed && eventIsLive(ed, now) ? "event" : "kit";
}

/** The open report a new one updates: same person, same event (or both no event), same item, not resolved, made inside 30 minutes. */
export function sameReport<T extends Pick<LowStockRow, "staff_id" | "session_id" | "item" | "status" | "created_at">>(
  rows: T[],
  r: { staffId: string; sessionId: string | null; item: string },
  now: Date
): T | null {
  const since = now.getTime() - SAME_REPORT_MS;
  return (
    rows
      .filter(
        (x) =>
          x.staff_id === r.staffId &&
          (x.session_id ?? null) === (r.sessionId ?? null) &&
          x.status !== "resolved" &&
          itemKey(x.item) === itemKey(r.item) &&
          new Date(x.created_at).getTime() >= since
      )
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null
  );
}

/** An update texts again only when it went from low to out. */
export const textsAgain = (before: Level, after: Level) => before === "low" && after === "out";

const levelPhrase = (level: Level, item: string) => (level === "out" ? `is out of ${item}` : `is running low on ${item}`);

/** The event report text to admins and managers. The title is the client first name and event type. */
export function eventAlertText(o: { who: string; title: string; item: string; level: Level; note: string; link: string; nowOut?: boolean }): string {
  return [
    `${o.nowOut ? "Now out" : LOW_STOCK_LABEL}: ${o.title}`,
    `${o.who} ${levelPhrase(o.level, o.item)}.`,
    o.note ? `Note: ${o.note}` : "",
    o.link,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The 9 AM summary of open kit reports. */
export function kitSummaryText(o: { reports: { who: string; item: string; level: Level; note: string; takenBy: string }[]; link: string }): string {
  const n = o.reports.length;
  return [
    `${LOW_STOCK_LABEL}, kit reports: ${n} open`,
    ...o.reports.map((r) => `${r.who}: ${r.item}, ${LEVEL_LABEL[r.level].toLowerCase()}${r.note ? ` (${r.note})` : ""}${r.takenBy ? `. ${r.takenBy} is on it` : ""}`),
    o.link,
  ].join("\n");
}

/** The text to the person who reported it. */
export function onItText(o: { name: string; item: string; level: Level }): string {
  return `${o.name} is on it.\nYour report: ${o.item}, ${LEVEL_LABEL[o.level].toLowerCase()}`;
}

/** The summary goes during the 9 AM hour in Chicago; the cron runs every 5 minutes and a notice key makes it once a day. */
export function summaryDue(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour === SUMMARY_HOUR;
}

export const summaryKey = (now: Date) => `low_stock_kit:${todayIn(TZ, now)}`;

/** Names to pick from: the event's Tools lines and Supplies items, each once, in order. */
export function itemChoices(tools: string[], supplies: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...supplies, ...tools]) {
    const name = cleanText(raw, MAX_ITEM);
    if (!name || seen.has(itemKey(name))) continue;
    seen.add(itemKey(name));
    out.push(name);
  }
  return out;
}
