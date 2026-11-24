// Deliveries and pickups: when a staff member can receive supplies at home and
// when they can do a store pickup. The rules, no database.
//
// This is about receiving supplies, not about working shifts: it never touches
// "Days I never work" (staff.off_weekdays) or the unavailable days.
//
// Per day of the week: can receive deliveries (yes or no, from and to) and can
// do pickups (yes or no, from and to). Plus house or apartment, delivery,
// pickup or either, and one short notes line.
//
// Each week (Monday to Sunday, Chicago) the person confirms it by a deadline:
// Wednesday 6 PM Central unless an admin changed it in settings. One tap
// ("Still correct for this week") or saving an edit confirms. Admins and
// managers see who has and has not. Nobody is reassigned automatically. One
// reminder text on Wednesday from 9 AM Central to anyone not confirmed,
// never in quiet hours in the person's own time zone.

import { formatClock, zonedInstant, TZ, todayIn } from "@/lib/team/time";

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export const DAY_LABEL: Record<DayKey, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const DAY_SHORT: Record<DayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export interface TimeWindow {
  on: boolean;
  from: number | null; // minutes after midnight
  to: number | null;
}
export interface DayWindows {
  receive: TimeWindow;
  pickup: TimeWindow;
}
export type WeekWindows = Record<DayKey, DayWindows>;

export const HOME_TYPES = ["house", "apartment"] as const;
export type HomeType = (typeof HOME_TYPES)[number];
export const HOME_LABEL: Record<HomeType, string> = { house: "House", apartment: "Apartment" };

export const HANDOFF_PREFS = ["delivery", "pickup", "either"] as const;
export type HandoffPref = (typeof HANDOFF_PREFS)[number];
export const HANDOFF_LABEL: Record<HandoffPref, string> = { delivery: "Prefers delivery", pickup: "Prefers pickup", either: "Delivery or pickup" };

export const NOTES_MAX = 120;

export const SECTION_TITLE = "Deliveries and pickups";
export const SECTION_LINE = "This is about receiving supplies for events, not about working shifts.";
export const CONFIRM_BUTTON = "Still correct for this week";

/** The columns on staff_profiles. */
export interface DeliveryColumns {
  delivery_windows?: unknown;
  home_type?: string | null;
  handoff_pref?: string | null;
  delivery_notes?: string | null;
  availability_confirmed_at?: string | null;
}

export interface DeliveryInput {
  delivery_windows: WeekWindows;
  home_type: HomeType | null;
  handoff_pref: HandoffPref | null;
  delivery_notes: string | null;
}

const off = (): TimeWindow => ({ on: false, from: null, to: null });

export function emptyWeek(): WeekWindows {
  return Object.fromEntries(DAY_KEYS.map((d) => [d, { receive: off(), pickup: off() }])) as WeekWindows;
}

function minutes(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v < 1440 ? v : null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

/** "13:30" for an <input type="time">. Empty for none. */
export function timeValue(m: number | null): string {
  if (m === null) return "";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Saved windows, read leniently: anything broken reads as off. */
export function readWeek(v: unknown): WeekWindows | null {
  if (!v || typeof v !== "object") return null;
  const raw = v as Record<string, unknown>;
  const out = emptyWeek();
  for (const d of DAY_KEYS) {
    const day = (raw[d] ?? {}) as Record<string, unknown>;
    for (const k of ["receive", "pickup"] as const) {
      const w = (day[k] ?? {}) as Record<string, unknown>;
      out[d][k] = { on: w.on === true, from: minutes(w.from), to: minutes(w.to) };
    }
  }
  return out;
}

/** The form, checked. A "yes" needs a from and a to, and from before to. */
export function cleanDelivery(raw: Record<string, unknown>): { ok: true; value: DeliveryInput } | { ok: false; error: string } {
  const src = (raw.delivery_windows ?? {}) as Record<string, unknown>;
  if (typeof src !== "object") return { ok: false, error: "Set each day." };
  const week = emptyWeek();
  for (const d of DAY_KEYS) {
    const day = (src[d] ?? {}) as Record<string, unknown>;
    for (const k of ["receive", "pickup"] as const) {
      const w = (day[k] ?? {}) as Record<string, unknown>;
      if (w.on !== true) continue;
      const from = minutes(w.from);
      const to = minutes(w.to);
      const what = k === "receive" ? "deliveries" : "pickups";
      if (from === null || to === null) return { ok: false, error: `${DAY_LABEL[d]}: enter a from and a to time for ${what}.` };
      if (from >= to) return { ok: false, error: `${DAY_LABEL[d]}: the ${what} from time must be before the to time.` };
      week[d][k] = { on: true, from, to };
    }
  }
  const home = raw.home_type === "" || raw.home_type == null ? null : raw.home_type;
  if (home !== null && !(HOME_TYPES as readonly unknown[]).includes(home)) return { ok: false, error: "Pick house or apartment." };
  const pref = raw.handoff_pref === "" || raw.handoff_pref == null ? null : raw.handoff_pref;
  if (pref !== null && !(HANDOFF_PREFS as readonly unknown[]).includes(pref)) return { ok: false, error: "Pick delivery, pickup, or either." };
  const notes = String(raw.delivery_notes ?? "").replace(/\s+/g, " ").trim().slice(0, NOTES_MAX) || null;
  return { ok: true, value: { delivery_windows: week, home_type: home as HomeType | null, handoff_pref: pref as HandoffPref | null, delivery_notes: notes } };
}

/** "9:00 AM to 5:00 PM", or "No". */
export function windowText(w: TimeWindow): string {
  if (!w.on || w.from === null || w.to === null) return "No";
  return `${formatClock(w.from)} to ${formatClock(w.to)}`;
}

/** Short form for the event: "9a–5p". */
export function shortWindow(w: TimeWindow): string {
  if (!w.on || w.from === null || w.to === null) return "";
  const s = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
  };
  return `${s(w.from)}–${s(w.to)}`;
}

/** "Mon 9a–5p, Sat 10a–2p", or "none set". */
export function weekSummary(week: WeekWindows | null, kind: "receive" | "pickup", days: readonly DayKey[] = DAY_KEYS): string {
  if (!week) return "not set";
  const parts = days.filter((d) => week[d][kind].on).map((d) => `${DAY_SHORT[d]} ${shortWindow(week[d][kind])}`);
  return parts.length ? parts.join(", ") : "none";
}

// ----- The weekly deadline -----

export const DEADLINE_KEY = "delivery_confirm_deadline";
export interface Deadline {
  day: DayKey;
  minutes: number; // Central time
}
export const DEADLINE_DEFAULT: Deadline = { day: "wed", minutes: 18 * 60 };
export const REMINDER_DAY: DayKey = "wed";
export const REMINDER_HOUR = 9; // Central

export function readDeadline(v: unknown): Deadline {
  const o = (v ?? {}) as Record<string, unknown>;
  const day = (DAY_KEYS as readonly unknown[]).includes(o.day) ? (o.day as DayKey) : DEADLINE_DEFAULT.day;
  const m = typeof o.minutes === "number" && Number.isInteger(o.minutes) && o.minutes >= 0 && o.minutes < 1440 ? o.minutes : DEADLINE_DEFAULT.minutes;
  return { day, minutes: m };
}

export function cleanDeadline(raw: Record<string, unknown>): { ok: true; value: Deadline } | { ok: false; error: string } {
  if (!(DAY_KEYS as readonly unknown[]).includes(raw.day)) return { ok: false, error: "Pick a day." };
  const m = minutes(raw.time ?? raw.minutes);
  if (m === null) return { ok: false, error: "Pick a time." };
  return { ok: true, value: { day: raw.day as DayKey, minutes: m } };
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday to Sunday is index 0 to 6. */
export function dayKeyOf(ymd: string): DayKey {
  const [y, m, d] = ymd.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday
  return DAY_KEYS[(js + 6) % 7];
}

/** The Monday (Chicago) of the week `now` falls in. */
export function weekStart(now: Date): string {
  const today = todayIn(TZ, now);
  return addDays(today, -DAY_KEYS.indexOf(dayKeyOf(today)));
}

/** This week's deadline as an instant. */
export function deadlineAt(now: Date, d: Deadline): Date {
  return zonedInstant(addDays(weekStart(now), DAY_KEYS.indexOf(d.day)), d.minutes, TZ);
}

/** "Wednesday, Nov 25 at 6:00 PM Central". */
export function deadlineText(now: Date, d: Deadline): string {
  const ymd = addDays(weekStart(now), DAY_KEYS.indexOf(d.day));
  const [y, m, dd] = ymd.split("-").map(Number);
  const md = new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${DAY_LABEL[d.day]}, ${md} at ${formatClock(d.minutes)} Central`;
}

/** "Every Wednesday at 6:00 PM Central", for settings. */
export function deadlineRule(d: Deadline): string {
  return `Every ${DAY_LABEL[d.day]} at ${formatClock(d.minutes)} Central`;
}

/** Confirmed for the week `now` is in: a confirmation on or after this Monday, Chicago. */
export function confirmedThisWeek(confirmedAt: string | null | undefined, now: Date): boolean {
  if (!confirmedAt) return false;
  const t = new Date(confirmedAt);
  if (Number.isNaN(t.getTime())) return false;
  return todayIn(TZ, t) >= weekStart(now) && t.getTime() <= now.getTime() + 60_000;
}

export interface WeekStatus {
  confirmed: boolean;
  confirmedAt: string | null;
  deadline: string; // "Wednesday, Nov 25 at 6:00 PM Central"
  overdue: boolean; // past the deadline and not confirmed
  set: boolean; // windows have been filled in at least once
}

export function weekStatus(row: DeliveryColumns | null, now: Date, d: Deadline): WeekStatus {
  const confirmed = confirmedThisWeek(row?.availability_confirmed_at, now);
  return {
    confirmed,
    confirmedAt: confirmed ? (row?.availability_confirmed_at ?? null) : null,
    deadline: deadlineText(now, d),
    overdue: !confirmed && now.getTime() > deadlineAt(now, d).getTime(),
    set: readWeek(row?.delivery_windows) !== null,
  };
}

/** Who is asked to confirm: active field staff (bartenders, bar backs, servers, event helpers). */
export function mustConfirm(p: { role: string; active: boolean }): boolean {
  return p.active && ["bartender", "bar_back", "server", "event_helper"].includes(p.role);
}

/** The reminder is due on the reminder day, from 9 AM Central, while the person is out of quiet hours. */
export function reminderDue(now: Date): boolean {
  const today = todayIn(TZ, now);
  if (dayKeyOf(today) !== REMINDER_DAY) return false;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= REMINDER_HOUR;
}

export const reminderKey = (now: Date, staffId: string) => `delivery_confirm:${weekStart(now)}:${staffId}`;

/** The one reminder text. No client details, no prices. */
export function reminderText(o: { firstName: string; deadline: string; link: string }): string {
  const hi = o.firstName ? `${o.firstName}, ` : "";
  return `The Mix Fix: ${hi}please confirm your deliveries and pickups times for this week by ${o.deadline}. One tap if nothing changed: ${o.link}`;
}

// ----- On the event -----

export interface EventAvailability {
  staffId: string;
  receive: string; // "Fri 9a–5p, Sat 10a–2p" for the event day and the day before, "none", or "not set"
  pickup: string;
  home: string; // "Apartment" or ""
  pref: string; // "Prefers pickup" or ""
  notes: string;
  confirmed: boolean;
  set: boolean;
  full: { day: string; receive: string; pickup: string }[]; // the whole week, for "see all"
}

/** The days that matter for an event: the day before and the day of. */
export function eventDays(eventYmd: string | null): DayKey[] {
  if (!eventYmd) return [...DAY_KEYS];
  return [dayKeyOf(addDays(eventYmd, -1)), dayKeyOf(eventYmd)];
}

export function eventAvailability(staffId: string, row: DeliveryColumns | null, eventYmd: string | null, now: Date): EventAvailability {
  const week = readWeek(row?.delivery_windows);
  const days = eventDays(eventYmd);
  return {
    staffId,
    receive: weekSummary(week, "receive", days),
    pickup: weekSummary(week, "pickup", days),
    home: row?.home_type && (HOME_TYPES as readonly string[]).includes(row.home_type) ? HOME_LABEL[row.home_type as HomeType] : "",
    pref: row?.handoff_pref && (HANDOFF_PREFS as readonly string[]).includes(row.handoff_pref) ? HANDOFF_LABEL[row.handoff_pref as HandoffPref] : "",
    notes: row?.delivery_notes ?? "",
    confirmed: confirmedThisWeek(row?.availability_confirmed_at, now),
    set: week !== null,
    full: week ? DAY_KEYS.map((d) => ({ day: DAY_SHORT[d], receive: windowText(week[d].receive), pickup: windowText(week[d].pickup) })) : [],
  };
}
