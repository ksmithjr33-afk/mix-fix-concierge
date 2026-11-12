// Cocktail menu pickup rules. Pure, no database.
//
// Each event's cocktail menu is printed at Walmart or Walgreens (or another
// store) and someone on the team picks it up. An admin sets the store and the
// person; the person (or an admin) checks "Picked up", which records who and
// when. An admin can undo it, and the undo is recorded too. "No printed menu
// for this event" takes the event off every outstanding count.

import { eventSchedule } from "@/lib/team/time";
import { inQuietHours } from "@/lib/team/shifts";

export const PRINT_STORES = ["walmart", "walgreens", "other"] as const;
export type PrintStore = (typeof PRINT_STORES)[number];
export const STORE_LABEL: Record<PrintStore, string> = { walmart: "Walmart", walgreens: "Walgreens", other: "Other" };

/** Outstanding counts and the bartender's card start this long before the event. */
export const PICKUP_WINDOW_HOURS = 48;
/** Admins hear about an event with nobody assigned this long before it. */
export const UNASSIGNED_ALERT_HOURS = 24;
/** The morning reminder goes from 8:00 AM until noon on the event day. */
export const MORNING_END_HOUR = 12;

export interface PickupRow {
  session_id: string;
  store: PrintStore | null;
  store_other: string | null;
  location_note: string | null;
  order_number: string | null;
  assignee_id: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  not_needed: boolean;
  picked_up_at: string | null;
  picked_up_by: string | null;
  picked_up_by_name: string | null;
  undone_at?: string | null;
  undone_by?: string | null;
  undone_by_name?: string | null;
  notify_after?: string | null;
  notified_at?: string | null;
  updated_at?: string | null;
}

export type PickupState = "not_needed" | "unassigned" | "assigned" | "picked_up";

/** Where the pickup stands. No row yet means nobody is assigned. */
export function pickupState(row: Pick<PickupRow, "not_needed" | "assignee_id" | "picked_up_at"> | null): PickupState {
  if (!row) return "unassigned";
  if (row.not_needed) return "not_needed";
  if (row.picked_up_at) return "picked_up";
  return row.assignee_id ? "assigned" : "unassigned";
}

/** "Walgreens", or the typed name for Other. Empty when no store is set. */
export function storeName(row: Pick<PickupRow, "store" | "store_other"> | null): string {
  if (!row?.store) return "";
  if (row.store === "other") return (row.store_other ?? "").trim() || "Other store";
  return STORE_LABEL[row.store];
}

function clip(v: unknown, max: number): string | null {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
}

export interface PickupInput {
  store: PrintStore | null;
  store_other: string | null;
  location_note: string | null;
  order_number: string | null;
  assignee_id: string | null;
  not_needed: boolean;
}

/**
 * The admin's form, checked. The person must be active staff (admins
 * included); the store must be one of the three, with a typed name for Other.
 */
export function cleanPickupInput(raw: Record<string, unknown>, activeStaffIds: Set<string>): { ok: true; value: PickupInput } | { ok: false; error: string } {
  const storeRaw = raw.store === "" || raw.store === null || raw.store === undefined ? null : raw.store;
  if (storeRaw !== null && !PRINT_STORES.includes(storeRaw as PrintStore)) return { ok: false, error: "Pick Walmart, Walgreens, or Other." };
  const store = storeRaw as PrintStore | null;
  const storeOther = store === "other" ? clip(raw.store_other, 80) : null;
  if (store === "other" && !storeOther) return { ok: false, error: "Type the store name for Other." };
  const assignee = raw.assignee_id === "" || raw.assignee_id === null || raw.assignee_id === undefined ? null : String(raw.assignee_id);
  if (assignee && !activeStaffIds.has(assignee)) return { ok: false, error: "Pick someone from the active staff." };
  return {
    ok: true,
    value: {
      store,
      store_other: storeOther,
      location_note: clip(raw.location_note, 200),
      order_number: clip(raw.order_number, 60),
      assignee_id: assignee,
      not_needed: raw.not_needed === true,
    },
  };
}

/** Who may check "Picked up": admins on any event, others only on their own assigned pickup. */
export function canMarkPickedUp(staff: { id: string; role: string; active: boolean }, row: Pick<PickupRow, "assignee_id" | "not_needed"> | null): boolean {
  if (!staff.active || !row || row.not_needed || !row.assignee_id) return false;
  return staff.role === "admin" || row.assignee_id === staff.id;
}

/** When the event starts for pickup purposes: arrival, else service start, else noon. Null without a date. */
export function pickupDeadline(ed: Record<string, unknown>): Date | null {
  const s = eventSchedule(ed);
  if (!s.day) return null;
  return s.arrival ?? s.start ?? eventScheduleNoon(s.day, s.tz);
}

function eventScheduleNoon(day: string, tz: string): Date {
  // eventSchedule with a noon service start gives noon in the event's zone.
  return eventSchedule({ event_date: day, bar_service_start: "12:00 PM", __tz: tz }).start ?? new Date(`${day}T17:00:00Z`);
}

/** Within 48 hours of the event (and before it) with the menu not picked up or nobody assigned. */
export function pickupOutstanding(row: PickupRow | null, ed: Record<string, unknown>, now: Date): boolean {
  const state = pickupState(row);
  if (state === "not_needed" || state === "picked_up") return false;
  const at = pickupDeadline(ed);
  if (!at) return false;
  const left = at.getTime() - now.getTime();
  return left > 0 && left <= PICKUP_WINDOW_HOURS * 3_600_000;
}

function localHour(at: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at)) % 24;
}

function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The morning of the event (8:00 AM to noon, event time zone), assigned and not picked up, before the event. */
export function morningReminderDue(row: PickupRow | null, ed: Record<string, unknown>, now: Date): boolean {
  if (pickupState(row) !== "assigned") return false;
  const s = eventSchedule(ed);
  if (!s.day || localDay(now, s.tz) !== s.day) return false;
  if (inQuietHours(now, s.tz) || localHour(now, s.tz) >= MORNING_END_HOUR) return false;
  const at = pickupDeadline(ed);
  return !!at && now.getTime() < at.getTime();
}

/** Nobody assigned 24 hours before the event (and the event not started), outside quiet hours. */
export function unassignedAlertDue(row: PickupRow | null, ed: Record<string, unknown>, now: Date): boolean {
  if (pickupState(row) !== "unassigned") return false;
  const at = pickupDeadline(ed);
  if (!at) return false;
  const left = at.getTime() - now.getTime();
  if (left <= 0 || left > UNASSIGNED_ALERT_HOURS * 3_600_000) return false;
  return !inQuietHours(now, eventSchedule(ed).tz);
}

/** "Nov 12, 3:40 PM" in the event's time zone. */
export function pickupStamp(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(d)
    .replace(/[  ]/g, " ");
}

/** "Picked up by Taylor, Nov 12, 3:40 PM". Empty when not picked up. */
export function pickedUpLine(row: Pick<PickupRow, "picked_up_at" | "picked_up_by_name"> | null, tz: string): string {
  if (!row?.picked_up_at) return "";
  return `Picked up by ${row.picked_up_by_name || "someone"}, ${pickupStamp(row.picked_up_at, tz)}`;
}

/** "Undone by Pat, Nov 12, 4:05 PM", while it is not picked up again. */
export function undoneLine(row: Pick<PickupRow, "picked_up_at" | "undone_at" | "undone_by_name"> | null, tz: string): string {
  if (!row?.undone_at || row.picked_up_at) return "";
  return `Picked up was undone by ${row.undone_by_name || "an admin"}, ${pickupStamp(row.undone_at, tz)}`;
}

/** The short status on the admin events list and the calendar chip. Null when no printed menu is needed. */
export function pickupBadge(row: PickupRow | null, names: Map<string, string>): { state: PickupState; text: string } | null {
  const state = pickupState(row);
  if (state === "not_needed") return null;
  if (state === "picked_up") return { state, text: "Menu picked up" };
  if (state === "assigned") return { state, text: `Menu: ${names.get(row!.assignee_id!) || "assigned"}` };
  return { state, text: "Menu: no one assigned" };
}

// ----- Texts -----

function where(o: { store: string; note: string; order: string }): string {
  return [o.store ? ` at ${o.store}` : "", o.note ? ` (${o.note})` : "", o.order ? `. Order #${o.order}` : ""].join("");
}

/** The one text when someone is assigned. */
export function assignedText(o: { firstName: string; title: string; date: string; store: string; note: string; order: string; link: string }): string {
  return `Hi ${o.firstName || "there"}, please pick up the printed cocktail menu for ${o.title} (${o.date})${where(o)}. Tap "I picked it up" when you have it: ${o.link}`;
}

/** The morning reminder when it is still not picked up. */
export function morningText(o: { firstName: string; title: string; store: string; note: string; order: string; link: string }): string {
  return `Hi ${o.firstName || "there"}, reminder: the printed cocktail menu for ${o.title} today is not marked picked up yet${where(o)}. Tap "I picked it up" when you have it: ${o.link}`;
}

/** Admins: nobody is assigned 24 hours out. */
export function unassignedText(o: { title: string; date: string; link: string }): string {
  return `Nobody is assigned to pick up the printed cocktail menu for ${o.title} (${o.date}). Assign someone or mark it no printed menu: ${o.link}`;
}
