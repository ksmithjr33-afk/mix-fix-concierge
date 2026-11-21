// The one balance rule for anything the client or a planner sees or hears:
// the client page, the planner page, the update concierge and the intake
// payment step. Pure, no database (lib/team/business-db.ts recordedPayments
// reads the rows).
//
// A balance is only ever the booked total on file minus payments recorded.
// Recorded means: a deposit an admin entered (event_finance.deposit_paid_cents),
// a balance recorded before the payments list (event_finance.balance_paid_cents),
// and every row in event_payments. The $150 deposit the Business tab assumes
// when none is entered is never counted here: no guessing from the deposit.
// A payment recorded as "Paid in full" settles the balance.
//
// With no total on file or nothing recorded there is no balance number: our
// team confirms it, and a team note asks someone to follow up.

import { TEAM_NOTES, withTeamNotes } from "@/lib/team-notes";

export interface Recorded {
  cents: number; // everything recorded as paid
  any: boolean; // anything at all is recorded
  paidInFull: boolean; // an admin recorded "Paid in full"
}

export const PAID_IN_FULL_NOTE = "Paid in full";

export function recordedFrom(finance: { deposit_paid_cents?: number | null; balance_paid_cents?: number | null } | null, payments: { cents: number; note?: string | null }[]): Recorded {
  const deposit = finance?.deposit_paid_cents ?? null;
  const legacy = finance?.balance_paid_cents ?? null;
  const cents = (deposit ?? 0) + (legacy ?? 0) + payments.reduce((n, p) => n + p.cents, 0);
  return {
    cents,
    any: deposit !== null || !!legacy || payments.length > 0,
    paidInFull: payments.some((p) => (p.note ?? "").trim() === PAID_IN_FULL_NOTE),
  };
}

/** The booked total, or null when none is on file or a new price is being confirmed. */
export function totalOnFile(booked: { total?: unknown } | null | undefined, pricePending = false): number | null {
  const t = booked?.total;
  if (pricePending || t === null || t === undefined || t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The balance in dollars, or null when it cannot be stated: no total on file, or nothing recorded. */
export function knownBalance(total: number | null, rec: Recorded | null): number | null {
  if (total === null || !rec || !rec.any) return null;
  if (rec.paidInFull) return 0;
  return Math.max(0, Math.round((total * 100 - rec.cents)) / 100);
}

/** Why no balance can be stated, for the team note. Null when it can. */
export function balanceGap(total: number | null, rec: Recorded | null, pricePending = false): string | null {
  if (pricePending) return "a new total is being confirmed";
  if (total === null && (!rec || !rec.any)) return "no booked total on file and no payments recorded";
  if (total === null) return "no booked total on file";
  if (!rec || !rec.any) return "no payments recorded";
  return null;
}

/** The team note added when the client was told our team will confirm their balance. */
export function balanceFollowUpNote(gap: string, preference?: unknown): string {
  const pref = typeof preference === "string" && preference.trim() ? ` They chose: ${preference.trim()}.` : "";
  return `Balance not quoted (${gap}). Confirm the remaining balance with the client.${pref}`;
}

export const TEAM_WILL_CONFIRM = "Our team will confirm your remaining balance with you.";

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** The options part of the payment question, the same in intake and update mode. */
const OPTIONS =
  "How would you like to handle it? We can charge your card on file now, on a date you pick, or on the due date. Or we can text you a payment link to pay any time before the due date, or set up a payment plan.";

/** The payment question: with the balance only when it is known, otherwise no number and our team confirms it. */
export function paymentQuestion(balance: number | null): string {
  return balance !== null
    ? `"Your remaining balance is ${fmt(balance)}, due two weeks before your event. ${OPTIONS}"`
    : `"Your remaining balance is due two weeks before your event. ${TEAM_WILL_CONFIRM} ${OPTIONS}"`;
}

/** Update mode, after a saved price change: the balance comes from the TOOL RESULT, worked out on the server after the save. */
export const PAYMENT_QUESTION_WITH_BALANCE = `"Your remaining balance is [the remaining_balance amount], due two weeks before your event. ${OPTIONS}"`;

/** The rule both concierges follow whenever a balance comes up, payment question or not. */
export function balanceRule(balance: number | null, gap: string | null): string {
  return balance !== null
    ? `BALANCE: the client's remaining balance is ${fmt(balance)} (the booked total minus the payments our team has recorded). It is the ONLY balance amount you may ever state. Never work out a balance yourself, and never subtract a deposit.`
    : `BALANCE: we cannot state this client's remaining balance (${gap}). NEVER state a balance amount, never work one out, and never subtract a deposit. If the balance comes up, say exactly: "${TEAM_WILL_CONFIRM}" Our team is told to follow up.`;
}

/** Adds the follow up team note to an event (intake submission), never twice. */
export function withBalanceFollowUp(ed: Record<string, unknown>, gap: string, preference?: unknown): Record<string, unknown> {
  return withTeamNotes(ed, [balanceFollowUpNote(gap, preference)]);
}

/**
 * Update mode: when the concierge saves a new payment choice and no balance
 * could be quoted, the same call carries the follow up team note.
 */
export function paymentFollowUp(
  current: Record<string, unknown>,
  partial: Record<string, unknown>,
  session: { booked_price?: { total?: unknown } | null; price_pending?: boolean | null },
  recorded: Recorded | null
): Record<string, unknown> {
  const pref = partial.payment_preference;
  if (typeof pref !== "string" || !pref.trim() || pref === current.payment_preference) return partial;
  const total = totalOnFile(session.booked_price, !!session.price_pending);
  const gap = balanceGap(total, recorded, !!session.price_pending);
  if (!gap) return partial;
  const base = typeof partial[TEAM_NOTES] === "string" ? { ...current, [TEAM_NOTES]: partial[TEAM_NOTES] } : current;
  return { ...partial, [TEAM_NOTES]: withBalanceFollowUp(base, gap, pref)[TEAM_NOTES] };
}

/** Update mode, in the TOOL RESULT after a saved price change: worked out here, never by the model. The new total minus recorded payments. */
export function remainingBalanceLine(newTotal: number | null, recorded: Recorded | null): string {
  const total = totalOnFile({ total: newTotal });
  const balance = knownBalance(total, recorded);
  if (balance !== null) return `remaining_balance: ${balance} (${fmt(balance)}), the new total minus the payments our team recorded`;
  return `remaining_balance: not known (${balanceGap(total, recorded)}). Do not state a balance amount. Say "${TEAM_WILL_CONFIRM}"`;
}
