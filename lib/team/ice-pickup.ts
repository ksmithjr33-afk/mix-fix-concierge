// Ice pickup: the rules, no database. Works like the menu pickup
// (lib/team/menu-pickup.ts), but more than one person can pick up ice, each
// with an optional bag count.
//
// - Ice is complete only when every assigned person is picked up.
// - The manager view's Details count adds 1 inside 24 hours of service start
//   when nobody is assigned or anyone is not picked up.
// - The Staffing page and calendar flag "Ice not assigned" inside 48 hours of
//   service start when nobody is assigned.
// - Each person gets a text when assigned, and again only when their bag count
//   or the location changes.

import { eventSchedule, zonedInstant } from "@/lib/team/time";
import { pickupStamp } from "@/lib/team/menu-pickup";

const HOUR = 3_600_000;

export interface IceRow {
  session_id: string;
  location_name: string | null;
  location_address: string | null;
  total_bags: number | null;
  notes: string | null;
}

export interface IcePersonRow {
  id: string;
  session_id: string;
  staff_id: string;
  bags_assigned: number | null;
  self_added: boolean;
  picked_up_at: string | null;
  picked_up_by: string | null;
  picked_up_by_name: string | null;
  covered_by?: string | null; // "I picked up the ice instead", covering for this person
  covered_by_name?: string | null;
  actual_location: string | null;
  actual_bags: number | null;
  notify_after: string | null;
  notified_at: string | null;
  notified_bags: number | null;
  notified_location: string | null;
}

export type IceState = "unassigned" | "assigned" | "complete";

/** Complete only when someone is assigned and every one of them is picked up. */
export function iceState(people: Pick<IcePersonRow, "picked_up_at">[]): IceState {
  if (people.length === 0) return "unassigned";
  return people.every((p) => !!p.picked_up_at) ? "complete" : "assigned";
}

/** Service start, else noon on the event day. Null without a date. */
export function iceDeadline(ed: Record<string, unknown>): Date | null {
  const s = eventSchedule(ed);
  if (!s.day) return null;
  return s.start ?? zonedInstant(s.day, 12 * 60, s.tz);
}

function within(ed: Record<string, unknown>, now: Date, hours: number): boolean {
  const d = iceDeadline(ed);
  if (!d) return false;
  const left = d.getTime() - now.getTime();
  return left > 0 && left <= hours * HOUR;
}

/** The Details count: inside 24 hours of service start, nobody assigned or anyone not picked up. */
export function iceOutstanding(people: Pick<IcePersonRow, "picked_up_at">[], ed: Record<string, unknown>, now: Date): boolean {
  return iceState(people) !== "complete" && within(ed, now, 24);
}

/** The Staffing page and calendar flag: inside 48 hours of service start with nobody assigned. */
export function iceUnassignedFlag(people: unknown[], ed: Record<string, unknown>, now: Date): boolean {
  return people.length === 0 && within(ed, now, 48);
}

/** The bag count a person's text and card show: theirs, or the total when they are the only one. */
export function effectiveBags(p: Pick<IcePersonRow, "bags_assigned">, peopleCount: number, total: number | null): number | null {
  if (p.bags_assigned !== null && p.bags_assigned !== undefined) return p.bags_assigned;
  return peopleCount === 1 ? total : null;
}

/** "Kroger, 123 Main St". Empty when no location is set. */
export function locationText(row: Pick<IceRow, "location_name" | "location_address"> | null): string {
  return [row?.location_name?.trim(), row?.location_address?.trim()].filter(Boolean).join(", ");
}

/**
 * Whether this person needs a text now: never for someone already picked up
 * or with a text already waiting out quiet hours; always for someone never
 * texted; otherwise only when their bag count or the location changed since
 * the last text.
 */
export function needsText(p: IcePersonRow, bags: number | null, location: string): boolean {
  if (p.picked_up_at || p.notify_after) return false;
  if (!p.notified_at) return true;
  return (p.notified_bags ?? null) !== (bags ?? null) || (p.notified_location ?? "") !== location;
}

/** "X of Y bags assigned", and a warning when bag counts are set and do not add up to the total. */
export function bagSummary(people: Pick<IcePersonRow, "bags_assigned">[], total: number | null): { assigned: number; line: string; warning: string } {
  const counted = people.filter((p) => p.bags_assigned !== null && p.bags_assigned !== undefined);
  const assigned = counted.reduce((n, p) => n + (p.bags_assigned ?? 0), 0);
  if (total === null) return { assigned, line: counted.length ? `${assigned} ${assigned === 1 ? "bag" : "bags"} assigned` : "", warning: "" };
  const line = `${assigned} of ${total} bags assigned`;
  const warning =
    counted.length > 0 && assigned !== total
      ? assigned < total
        ? `${total - assigned} ${total - assigned === 1 ? "bag is" : "bags are"} not assigned to anyone.`
        : `${assigned - total} more ${assigned - total === 1 ? "bag" : "bags"} assigned than the total.`
      : "";
  return { assigned, line, warning };
}

/**
 * "Picked up, checked by Taylor, Dec 4, 3:40 PM · Kroger · 6 bags", or
 * "Covered by Sam, Dec 4, 3:40 PM · ..." when someone picked it up in their
 * place. Empty when not picked up.
 */
export function icePickedUpLine(
  p: Pick<IcePersonRow, "picked_up_at" | "picked_up_by_name" | "actual_location" | "actual_bags"> & Partial<Pick<IcePersonRow, "covered_by_name">>,
  tz: string
): string {
  if (!p.picked_up_at) return "";
  return [
    p.covered_by_name ? `Covered by ${p.covered_by_name}, ${pickupStamp(p.picked_up_at, tz)}` : `Picked up, checked by ${p.picked_up_by_name || "someone"}, ${pickupStamp(p.picked_up_at, tz)}`,
    p.actual_location?.trim() ?? "",
    p.actual_bags !== null && p.actual_bags !== undefined ? `${p.actual_bags} ${p.actual_bags === 1 ? "bag" : "bags"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A bag count typed in a box: blank is none, otherwise a whole number 0 to 999. */
export function cleanBags(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null || v === undefined || String(v).trim() === "") return { ok: true, value: null };
  const s = String(v).trim();
  if (!/^\d{1,3}$/.test(s)) return { ok: false };
  return { ok: true, value: parseInt(s, 10) };
}

function text(v: unknown, max: number): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/** The admin's ice settings form. */
export function cleanIceInput(raw: Record<string, unknown>): { ok: true; value: Omit<IceRow, "session_id"> } | { ok: false; error: string } {
  const bags = cleanBags(raw.total_bags);
  if (!bags.ok) return { ok: false, error: "Total bags must be a whole number." };
  return {
    ok: true,
    value: {
      location_name: text(raw.location_name, 120),
      location_address: text(raw.location_address, 200),
      total_bags: bags.value,
      notes: text(raw.notes, 500),
    },
  };
}

/** What a picked up check may say: where (optional) and how many bags (optional). */
export function cleanPickedUp(raw: Record<string, unknown>): { ok: true; location: string | null; bags: number | null } | { ok: false; error: string } {
  const bags = cleanBags(raw.bags);
  if (!bags.ok) return { ok: false, error: "Bags must be a whole number." };
  return { ok: true, location: text(raw.location, 120), bags: bags.value };
}

/** The bag count from the Shopping list's ice line ("12 x 16 lb bags"). Null when there is none. */
export function shoppingIceBags(sections: { id: string; lines: { fields: { name: string; quantity: string } }[] }[]): number | null {
  for (const s of sections) {
    if (s.id !== "ice") continue;
    for (const l of s.lines) {
      if (!/^ice\b/i.test(l.fields.name.trim())) continue;
      const m = /\d+/.exec(l.fields.quantity);
      if (m) return parseInt(m[0], 10);
    }
  }
  return null;
}

const bagsPhrase = (n: number | null) => (n === null ? "Bag count: ask the office" : `${n} ${n === 1 ? "bag" : "bags"}`);

/** The assignment text, and the update when the bag count or location changed. No client details. */
export function iceText(o: { firstName: string; title: string; date: string; bags: number | null; location: string; update: boolean; link: string }): string {
  const hi = o.firstName ? `${o.firstName}, ` : "";
  const lead = o.update ? `Ice pickup update: ${hi}your ice pickup for ${o.title} on ${o.date} changed.` : `Ice pickup: ${hi}you are picking up ice for ${o.title} on ${o.date}.`;
  return `${lead} ${bagsPhrase(o.bags)}. Where: ${o.location || "ask the office"}. Mark it picked up here: ${o.link}`;
}
