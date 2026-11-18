// Reimbursements: money an admin pays back to one person on one event (ice
// they bought, menus they had printed, anything else). Pure, no database.
//
// A reimbursement is added to that person's amount on the payout sheet and in
// payroll, in its own column. It is never wages: no rate, no hours, no payroll
// burden. On the Business tab it is its own cost line, "Reimbursed to staff".
// It can be changed or removed until that person's line on the event is
// marked paid. Admins only (role admin, never managers); a staff member sees
// only their own.

import { money } from "@/lib/team/pay";

export const REIMBURSEMENT_KINDS = ["ice", "menu_printing", "other"] as const;
export type ReimbursementKind = (typeof REIMBURSEMENT_KINDS)[number];
export const KIND_LABEL: Record<ReimbursementKind, string> = { ice: "Ice", menu_printing: "Menu printing", other: "Other" };
export const MAX_REIMBURSEMENT_CENTS = 1000_00;
export const MAX_REIMBURSEMENT_NOTE = 120;
export const REIMBURSED_LABEL = "Reimbursed to staff";
export const REIMBURSEMENTS_NOT_READY = "Reimbursements are not set up yet. Run the payroll reimbursements migration first.";
export const LOCKED_MESSAGE = "This line is marked paid, so its reimbursements cannot change. Undo paid first.";

export interface Reimbursement {
  id: string;
  assignmentId: string;
  sessionId: string;
  staffId: string;
  kind: ReimbursementKind;
  cents: number;
  note: string;
}

export const reimbursementsCents = (list: Pick<Reimbursement, "cents">[]) => list.reduce((n, r) => n + r.cents, 0);

/** "Ice $24.00", "Other $12.00 (parking)". */
export function reimbursementText(r: Pick<Reimbursement, "kind" | "cents" | "note">): string {
  return `${KIND_LABEL[r.kind]} ${money(r.cents)}${r.note ? ` (${r.note})` : ""}`;
}

/** What an admin typed: a type, dollars, an optional note. */
export function validateReimbursement(raw: { kind?: unknown; amount?: unknown; note?: unknown }): { ok: true; kind: ReimbursementKind; cents: number; note: string } | { ok: false; error: string } {
  const kind = String(raw.kind ?? "") as ReimbursementKind;
  if (!(REIMBURSEMENT_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Pick Ice, Menu printing, or Other." };
  const s = String(raw.amount ?? "").trim().replace(/[$,\s]/g, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return { ok: false, error: "Enter the amount in dollars, like 24 or 24.50." };
  const cents = Math.round(Number(s) * 100);
  if (cents <= 0 || cents > MAX_REIMBURSEMENT_CENTS) return { ok: false, error: `Enter an amount between $0.01 and ${money(MAX_REIMBURSEMENT_CENTS)}.` };
  const note = String(raw.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > MAX_REIMBURSEMENT_NOTE) return { ok: false, error: `Keep the note to ${MAX_REIMBURSEMENT_NOTE} characters.` };
  return { ok: true, kind, cents, note };
}

// ----- The pickup prompt -----

export type PickupKind = "ice" | "menu_printing";
export const PICKUP_PROMPT: Record<PickupKind, string> = {
  ice: "Picked up the ice. Add a reimbursement?",
  menu_printing: "Picked up the menus. Add a reimbursement?",
};

/** The prompts for one line: a pickup that person did, with no reimbursement of that type entered. */
export function pickupPrompts(did: { ice: boolean; menu: boolean }, list: Pick<Reimbursement, "kind">[]): PickupKind[] {
  const has = (k: ReimbursementKind) => list.some((r) => r.kind === k);
  const out: PickupKind[] = [];
  if (did.ice && !has("ice")) out.push("ice");
  if (did.menu && !has("menu_printing")) out.push("menu_printing");
  return out;
}

// ----- Business: never count the same money twice -----
//
// Before reimbursements existed, an admin may have entered ice or menus as an
// "other cost" on the Business tab. When an other cost names the same thing
// (ice, menu or print, or the word reimbursement) for the same amount as a
// reimbursement on that event, it is already counted in Reimbursed to staff
// and is left out of Other costs. Each reimbursement covers one other cost at
// most.

const KIND_WORDS: Record<ReimbursementKind, RegExp> = { ice: /\bice\b/i, menu_printing: /\bmenus?\b|\bprint/i, other: /$^/ };
const REIMBURSE_WORD = /reimburs/i;

/** The ids of other costs already counted as a reimbursement. */
export function otherCostsCovered(other: { id: string; label: string; cents: number }[], list: Pick<Reimbursement, "kind" | "cents">[]): Set<string> {
  const covered = new Set<string>();
  for (const r of list) {
    const hit = other.find((o) => !covered.has(o.id) && o.cents === r.cents && (KIND_WORDS[r.kind].test(o.label) || REIMBURSE_WORD.test(o.label)));
    if (hit) covered.add(hit.id);
  }
  return covered;
}
