// Usual order windows (was "Deliveries and pickups"): when a staff member can
// usually receive supplies at home and when they can usually do a store
// pickup. The rules, no database.
//
// Optional. It only prefills the per event Order window item
// (lib/team/order-window.ts), which replaced the weekly confirm. This is about
// receiving supplies, not about working shifts: it never touches "Days I never
// work" (staff.off_weekdays) or the unavailable days.
//
// Per day of the week: can receive deliveries (yes or no, from and to) and can
// do pickups (yes or no, from and to). Plus house or apartment, delivery,
// pickup or either, and one short notes line.

import { formatClock } from "@/lib/team/time";

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

export const SECTION_TITLE = "Usual order windows";
export const SECTION_LINE = "Optional. When you can usually receive supplies for events. We use it to fill in the order window on each event you accept, so you can confirm it in one tap. This is not about working shifts.";

/** The columns on staff_profiles. */
export interface DeliveryColumns {
  delivery_windows?: unknown;
  home_type?: string | null;
  handoff_pref?: string | null;
  delivery_notes?: string | null;
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

/** Monday to Sunday is index 0 to 6. */
export function dayKeyOf(ymd: string): DayKey {
  const [y, m, d] = ymd.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday
  return DAY_KEYS[(js + 6) % 7];
}
