// Checkbox state for the checklist and shopping list tabs. Pure, no database.
//
// One saved row per staff member, event, list, and item name, with the quantity
// the item had when the row was written. When a client update changes the
// shopping list, an item whose quantity no longer matches its row, or that has
// no row while others do, comes back unchecked and tagged "changed" until the
// bartender checks it again.

export type ListName = "checklist" | "shopping";

export interface CheckRow {
  item_key: string;
  checked: boolean;
  quantity: string;
}

export interface CheckableItem {
  key: string;
  quantity: string;
}

export interface CheckState {
  checked: boolean;
  changed: boolean;
}

export function mergeChecks(
  items: CheckableItem[],
  rows: CheckRow[],
  opts: { trackChanges: boolean }
): Record<string, CheckState> {
  const byKey = new Map(rows.map((r) => [r.item_key, r]));
  const seeded = rows.length > 0;
  const out: Record<string, CheckState> = {};
  for (const item of items) {
    const row = byKey.get(item.key);
    const changed = opts.trackChanges && seeded && (!row || row.quantity !== item.quantity);
    out[item.key] = { checked: !!row?.checked && !changed, changed };
  }
  return out;
}

export function progress(state: Record<string, CheckState>): { checked: number; total: number } {
  const values = Object.values(state);
  return { checked: values.filter((s) => s.checked).length, total: values.length };
}

export function progressLabel(p: { checked: number; total: number }): string {
  return `${p.checked} of ${p.total} checked`;
}
