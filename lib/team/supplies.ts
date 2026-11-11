// The bartender's Supplies tab: what should be at the event, read from the
// admin Shopping list for that event, so the two always match. Pure, no database.
//
// Every line on the Shopping list (renamed, resized, added by hand, or
// calculated) shows here, and removed lines do not. Bartenders see the item,
// the amount, and the brand. Never stores, highlights, Ordered checks, who
// edited, or any admin control. A check mark is saved against the line's ref
// on the Shopping list, so it stays on the line when its name or amount changes.

import type { Sheet, SheetLine } from "@/lib/order-sheet";
import { amountText } from "@/lib/order-sheet-shared";
import type { CheckRow, CheckState } from "@/lib/team/checks";
import type { ResolvedGroup } from "@/lib/team/checklist-config";
import type { ShopItem, StaffShopping } from "@/lib/team/shopping";

export const SUPPLIES_TAB = "Supplies";
export const SUPPLIES_TITLE = "Supplies for this event";
export const SUPPLIES_INTRO = "Check off each item when you see it at the event.";
export const SUPPLIES_PROGRESS = "Supplies check";
export const UPDATED_TITLE = "Updated";
export const NOTICE_HOURS = 48; // admin edits text assigned staff when the event is this close

/** One supply on the bartender's list. The key is the Shopping list line's ref. */
export interface SupplyItem extends ShopItem {
  size: string; // "32 oz", or empty
  max: number; // most a bartender can count back as unopened
  mixFix: boolean; // The Mix Fix buys it, so it is on the end of night inventory
}

/** "4 bottles" is 4, "2 to 3 bags" is 3, "24 count" is 24. Anything without a number is 1. */
export function maxCount(quantity: string): number {
  const nums = [...String(quantity).matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const range = String(quantity).match(/^\s*(\d+)\s*(?:to|-|–)\s*(\d+)/i);
  const n = range ? Number(range[2]) : nums.length && !/^\s*\d+\s*\/\s*\d+/.test(quantity) ? Math.floor(nums[0]) : 1;
  return Math.max(1, Math.min(999, n || 1));
}

function itemOf(l: SheetLine, group: "alcohol" | "supplies"): SupplyItem {
  return {
    key: l.ref,
    item: l.fields.name,
    brand: l.fields.detail || null,
    quantity: amountText(l.fields, l.section),
    size: l.fields.size,
    max: maxCount(l.fields.quantity),
    mixFix: group === "supplies" && !l.clientBuys,
  };
}

/** The two groups bartenders already know: liquor lines are the client's alcohol, everything else is supplies. */
export function suppliesFromSheet(sheet: Sheet): Supplies {
  const lines = sheet.sections.flatMap((s) => s.lines);
  return {
    alcohol: lines.filter((l) => l.section === "liquor").map((l) => itemOf(l, "alcohol")),
    supplies: lines.filter((l) => l.section !== "liquor").map((l) => itemOf(l, "supplies")),
  };
}

export interface Supplies extends StaffShopping {
  alcohol: SupplyItem[];
  supplies: SupplyItem[];
}

/** Every line, supplies first, the way the tab lists them. */
export function allSupplies(s: Supplies): SupplyItem[] {
  return [...s.supplies, ...s.alcohol];
}

/** The key a check mark had before the list came from the Shopping list: group and item name. */
export function legacyKey(group: "alcohol" | "supplies", item: string): string {
  return `${group}:${item.toLowerCase()}`;
}

/**
 * Saved rows lined up with today's list. A row saved against the line's ref
 * wins; an older row saved against the item name carries over until the
 * bartender taps the item again. A line with no row starts unchecked.
 */
export function supplyRows(list: Supplies, rows: CheckRow[]): CheckRow[] {
  const byKey = new Map(rows.map((r) => [r.item_key, r]));
  const out: CheckRow[] = [];
  for (const [group, items] of [["alcohol", list.alcohol], ["supplies", list.supplies]] as const) {
    for (const i of items) {
      const r = byKey.get(i.key) ?? byKey.get(legacyKey(group, i.item));
      if (r) out.push({ item_key: i.key, checked: r.checked, quantity: i.quantity });
    }
  }
  return out;
}

/** Check state for each line: checks stay on the line through renames and new amounts; a removed line takes its check with it. */
export function supplyState(list: Supplies, rows: CheckRow[]): Record<string, CheckState> {
  const saved = new Map(supplyRows(list, rows).map((r) => [r.item_key, r.checked]));
  const out: Record<string, CheckState> = {};
  for (const i of [...list.supplies, ...list.alcohol]) out[i.key] = { checked: saved.get(i.key) === true, changed: false };
  return out;
}

// ----- "Updated": what changed since the bartender last looked -----

export interface SeenItem {
  key: string;
  name: string;
  amount: string;
}

export function seenItems(list: Supplies): SeenItem[] {
  return [...list.supplies, ...list.alcohol].map((i) => ({ key: i.key, name: i.item, amount: [i.quantity, i.brand].filter(Boolean).join(", ") }));
}

/** Plain lines saying what changed: renamed, new amount, added, removed. Empty when nothing did. */
export function supplyChanges(before: SeenItem[] | null, after: SeenItem[]): string[] {
  if (!before) return [];
  const was = new Map(before.map((b) => [b.key, b]));
  const now = new Set(after.map((a) => a.key));
  const out: string[] = [];
  for (const a of after) {
    const b = was.get(a.key);
    if (!b) {
      out.push(`Added ${a.name}${a.amount ? ` (${a.amount})` : ""}`);
      continue;
    }
    if (b.name !== a.name) out.push(`${b.name} is now ${a.name}`);
    if (b.amount !== a.amount) out.push(`${a.name}: ${a.amount || "no amount"}, was ${b.amount || "no amount"}`);
  }
  for (const b of before) if (!now.has(b.key)) out.push(`Removed ${b.name}`);
  return out;
}

/** The supplies part of the update text: "Supplies list: Honey syrup is now Simple syrup; Added Ice (2 bags)." */
export function suppliesTextLine(changes: string[]): string {
  if (changes.length === 0) return "";
  const shown = changes.slice(0, 4).join("; ");
  return `Supplies list: ${shown}${changes.length > 4 ? `; and ${changes.length - 4} more` : ""}.`;
}

/** Admin edits text assigned staff from 48 hours before service until it ends. */
export function inNoticeWindow(start: Date | null, end: Date | null, now: Date): boolean {
  if (!start) return false;
  const t = now.getTime();
  return t >= start.getTime() - NOTICE_HOURS * 3_600_000 && t <= (end ?? start).getTime();
}

// ----- What the manager sees on each bartender's lists -----

export interface ListLine {
  label: string;
  quantity: string;
}

export interface ListDetail {
  unchecked: ListLine[];
  checked: ListLine[];
  total: number;
  lastTouched: string | null; // null while nothing is checked: "not started"
}

function detail(lines: (ListLine & { key: string })[], state: Record<string, CheckState>, rows: { item_key: string; updated_at?: string | null }[]): ListDetail {
  const checked = lines.filter((l) => state[l.key]?.checked);
  const keys = new Set(lines.map((l) => l.key));
  const touched = rows
    .filter((r) => keys.has(r.item_key) && r.updated_at)
    .map((r) => String(r.updated_at))
    .sort()
    .at(-1);
  return {
    unchecked: lines.filter((l) => !state[l.key]?.checked).map(({ label, quantity }) => ({ label, quantity })),
    checked: checked.map(({ label, quantity }) => ({ label, quantity })),
    total: lines.length,
    lastTouched: checked.length > 0 ? (touched ?? null) : null,
  };
}

/** One bartender's two lists for the manager: what is not checked off, by name and amount, and when they last touched each. */
export function bartenderLists(o: {
  checklist: ResolvedGroup[];
  checklistState: Record<string, CheckState>;
  checklistRows: { item_key: string; updated_at?: string | null }[];
  supplies: Supplies;
  supplyState: Record<string, CheckState>;
  supplyRows: { item_key: string; updated_at?: string | null }[];
}): { checklist: ListDetail; supplies: ListDetail } {
  const cl = o.checklist.flatMap((g) => g.sections.flatMap((s) => s.lines.filter((l) => !l.info).map((l) => ({ key: l.key, label: l.label, quantity: "" }))));
  const sp = [...o.supplies.supplies, ...o.supplies.alcohol].map((i) => ({ key: i.key, label: i.item, quantity: i.quantity }));
  // Rows saved against the old item name key count for the line they carried over to.
  const legacy = new Map<string, string>();
  for (const [group, items] of [["alcohol", o.supplies.alcohol], ["supplies", o.supplies.supplies]] as const) for (const i of items) legacy.set(legacyKey(group, i.item), i.key);
  const spRows = o.supplyRows.map((r) => ({ ...r, item_key: legacy.get(r.item_key) ?? r.item_key }));
  return { checklist: detail(cl, o.checklistState, o.checklistRows), supplies: detail(sp, o.supplyState, spRows) };
}
