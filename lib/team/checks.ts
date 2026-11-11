// Checkbox state for the Checklist and Supplies tabs. Pure, no database.
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

// "I have everything": a staff member confirms once every checklist box is
// checked. Unchecking any item clears the confirmation.

/** The button turns on only when there is at least one box and every box is checked. */
export function canConfirm(state: Record<string, CheckState>): boolean {
  const p = progress(state);
  return p.total > 0 && p.checked === p.total;
}

/** A saved confirmation only counts while every box is still checked. */
export function activeConfirmation(confirmedAt: string | null, state: Record<string, CheckState>): string | null {
  return confirmedAt && canConfirm(state) ? confirmedAt : null;
}

/** Whether saving this checkbox clears the confirmation: any uncheck on the checklist does. */
export function clearsConfirmation(list: ListName, checked: boolean): boolean {
  return list === "checklist" && !checked;
}
