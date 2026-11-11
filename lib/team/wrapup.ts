// End of night wrap up: the closeout plus the inventory, in one form. Pure, no database.
//
// The bartender marks every supply The Mix Fix provided (Used up, Opened some
// left, or Unopened with a count), every piece of company equipment
// (Returned, Missing, or Damaged with a note), whether the leftover alcohol
// stayed with the client, and anything else we should know. It can be edited
// until an admin marks it reviewed. The manager reads it at a glance, and the
// Leftover stock view totals what came back unopened across events.

import { eventSchedule } from "@/lib/team/time";
import type { SupplyItem } from "@/lib/team/supplies";

export const SUPPLY_STATES = ["used", "opened", "unopened"] as const;
export type SupplyStateName = (typeof SUPPLY_STATES)[number];
export const SUPPLY_LABELS: Record<SupplyStateName, string> = { used: "Used up", opened: "Opened, some left", unopened: "Unopened" };

export const EQUIPMENT_STATES = ["returned", "missing", "damaged"] as const;
export type EquipmentState = (typeof EQUIPMENT_STATES)[number];
export const EQUIPMENT_LABELS: Record<EquipmentState, string> = { returned: "Returned", missing: "Missing", damaged: "Damaged" };

export const WRAP_UP_TAB = "Wrap up";
export const ALCOHOL_QUESTION = "Did you leave the leftover alcohol with the client?";
export const ANYTHING_ELSE = "Anything we should know?";
export const WRAP_UP_REMINDER_MIN = 30; // one text 30 minutes after clock out with no wrap up
export const WRAP_UP_LATE_HOURS = 2; // the manager's Day of count, 2 hours after service ends
export const EQUIP_NOTE_MAX = 300;

export interface SupplyCount {
  key: string; // the Shopping list line
  item: string;
  size: string;
  amount: string; // what was provided, "4 x 32 oz bottles"
  max: number;
  state: SupplyStateName;
  count: number; // unopened only, 1 to max
}

export interface EquipmentCheck {
  item: string;
  state: EquipmentState;
  note: string;
  photoPath: string;
}

export interface Inventory {
  supplies: SupplyCount[];
  equipment: EquipmentCheck[];
  alcoholLeft: boolean | null; // null when the client provided no alcohol
  alcoholNote: string;
}

/** The counter for an Unopened item: starts at 1, never below 1 or above what was provided. */
export function clampCount(n: unknown, max: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(Math.max(1, max), v));
}

/** "Mark all used up": every supply set to Used up, ready for the exceptions. */
export function markAllUsed(items: SupplyItem[]): Record<string, { state: SupplyStateName; count: number }> {
  return Object.fromEntries(items.map((i) => [i.key, { state: "used" as const, count: 1 }]));
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

function parse<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/**
 * The inventory part of a wrap up, checked against the list the bartender saw
 * (rebuilt on the server, never trusted from the phone). Every supply and every
 * piece of equipment needs an answer. Missing or Damaged needs a note. The
 * alcohol question needs Yes or No when the client provided alcohol, and a note on No.
 */
export function validateInventory(
  raw: { supplies?: unknown; equipment?: unknown; alcoholLeft?: unknown; alcoholNote?: unknown },
  o: { items: SupplyItem[]; gear: string[]; clientAlcohol: boolean; photos?: Record<string, string> }
): { ok: true; value: Inventory } | { ok: false; error: string } {
  const sup = parse<Record<string, { state?: unknown; count?: unknown }>>(raw.supplies, {}) ?? {};
  const supplies: SupplyCount[] = [];
  for (const i of o.items) {
    const a = sup[i.key];
    const state = String(a?.state ?? "") as SupplyStateName;
    if (!SUPPLY_STATES.includes(state)) return { ok: false, error: `Mark ${i.item}: Used up, Opened, or Unopened.` };
    supplies.push({ key: i.key, item: i.item, size: i.size, amount: i.quantity, max: i.max, state, count: state === "unopened" ? clampCount(a?.count ?? 1, i.max) : 0 });
    if (state === "unopened" && Number(a?.count ?? 1) > i.max) return { ok: false, error: `${i.item}: no more than ${i.max} unopened.` };
  }
  const eq = parse<Record<string, { state?: unknown; note?: unknown }>>(raw.equipment, {}) ?? {};
  const equipment: EquipmentCheck[] = [];
  for (const g of o.gear) {
    const a = eq[g];
    const state = String(a?.state ?? "") as EquipmentState;
    if (!EQUIPMENT_STATES.includes(state)) return { ok: false, error: `Mark ${g}: Returned, Missing, or Damaged.` };
    const note = clean(a?.note, EQUIP_NOTE_MAX);
    if (state !== "returned" && !note) return { ok: false, error: `Add a short note on what happened to ${g}.` };
    equipment.push({ item: g, state, note: state === "returned" ? "" : note, photoPath: state === "returned" ? "" : (o.photos?.[g] ?? "") });
  }
  let alcoholLeft: boolean | null = null;
  let alcoholNote = "";
  if (o.clientAlcohol) {
    const v = String(raw.alcoholLeft ?? "");
    if (v !== "yes" && v !== "no") return { ok: false, error: "Answer: did you leave the leftover alcohol with the client?" };
    alcoholLeft = v === "yes";
    alcoholNote = alcoholLeft ? "" : clean(raw.alcoholNote, 500);
    if (!alcoholLeft && !alcoholNote) return { ok: false, error: "Add a note on where the leftover alcohol went." };
  }
  return { ok: true, value: { supplies, equipment, alcoholLeft, alcoholNote } };
}

/** Gear the wrap up marked Missing or Damaged, for the closeout alert the office already gets. */
export function gearFromEquipment(equipment: EquipmentCheck[]): { gearItems: string[]; gearNote: string } {
  const bad = equipment.filter((e) => e.state !== "returned");
  return {
    gearItems: bad.map((e) => e.item),
    gearNote: bad.map((e) => `${e.item} ${e.state}: ${e.note}`).join("; ").slice(0, 500),
  };
}

// ----- The manager's summary -----

export interface WrapUpSummary {
  problems: { item: string; state: EquipmentState; note: string; photoPath: string }[]; // first, in red
  unopened: { item: string; size: string; count: number }[]; // second: can be reused
  opened: string[]; // third
  used: string[]; // last, collapsed by default
  alcohol: string; // "Left with the client" or "Not left with the client: <note>"
}

/** The wrap up in the order a manager reads it: problems, reusable stock, opened, then used up. */
export function wrapUpSummary(inv: Partial<Inventory>): WrapUpSummary {
  const supplies = inv.supplies ?? [];
  return {
    problems: (inv.equipment ?? []).filter((e) => e.state !== "returned").map((e) => ({ item: e.item, state: e.state, note: e.note, photoPath: e.photoPath })),
    unopened: supplies.filter((s) => s.state === "unopened").map((s) => ({ item: s.item, size: s.size, count: s.count })),
    opened: supplies.filter((s) => s.state === "opened").map((s) => s.item),
    used: supplies.filter((s) => s.state === "used").map((s) => s.item),
    alcohol: inv.alcoholLeft === true ? "Left with the client" : inv.alcoholLeft === false ? `Not left with the client${inv.alcoholNote ? `: ${inv.alcoholNote}` : ""}` : "",
  };
}

export function hasProblems(inv: Partial<Inventory>): boolean {
  return (inv.equipment ?? []).some((e) => e.state !== "returned");
}

/** Two hours after service ends with no wrap up: the manager's Day of tab counts it. */
export function wrapUpLate(ed: Record<string, unknown>, now: Date): boolean {
  const end = eventSchedule(ed).end;
  return !!end && now.getTime() >= end.getTime() + WRAP_UP_LATE_HOURS * 3_600_000;
}

export function wrapUpReminderText(o: { firstName: string; title: string; link: string }): string {
  return `Hi ${o.firstName || "there"}, please do your wrap up for ${o.title}: how it went, what is left, and the equipment. ${o.link}`;
}

// ----- Leftover stock across events -----

export interface LeftoverRow {
  item: string;
  size: string;
  count: number;
  events: number;
}

/** Unopened items from wrap ups, totalled by item and size, most first. */
export function leftoverTotals(wrapUps: { sessionId: string; supplies: SupplyCount[] }[]): LeftoverRow[] {
  const map = new Map<string, LeftoverRow & { sessions: Set<string> }>();
  for (const w of wrapUps) {
    for (const s of w.supplies ?? []) {
      if (s.state !== "unopened" || !(s.count > 0)) continue;
      const k = `${s.item.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${s.size.trim().toLowerCase()}`;
      const row = map.get(k) ?? { item: s.item, size: s.size, count: 0, events: 0, sessions: new Set<string>() };
      row.count += s.count;
      row.sessions.add(w.sessionId);
      row.events = row.sessions.size;
      map.set(k, row);
    }
  }
  return [...map.values()]
    .map(({ item, size, count, events }) => ({ item, size, count, events }))
    .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item));
}

// ----- The Day of tab count -----

/**
 * What needs a manager's eye on the Day of tab: each missing item report, a
 * bar photo still missing after service starts, each bartender whose lists
 * still have unchecked items at service start, each wrap up with Missing or
 * Damaged items not yet reviewed, and each wrap up not in 2 hours after service ends.
 */
export function dayOfCount(o: { missingReports: number; photoMissing: boolean; listsUnfinished: number; wrapUpProblems: number; wrapUpsLate: number }): number {
  return o.missingReports + (o.photoMissing ? 1 : 0) + o.listsUnfinished + o.wrapUpProblems + o.wrapUpsLate;
}

/** Bar service has started. */
export function serviceStarted(ed: Record<string, unknown>, now: Date): boolean {
  const start = eventSchedule(ed).start;
  return !!start && now.getTime() >= start.getTime();
}
