// Admin edits of event details from the team portal. Saves through the same
// path as a client update (applyEventUpdate, then deliverEventUpdates), so the
// version bumps, an event_updates row is written, the lists and the needed
// bartender count follow the new event data, the GHL note and update webhook go
// out. Assigned staff are not texted: the edit is held as "changes not sent to
// the team" (lib/team/held-changes-db.ts). Differences: no six day cutoff, the
// admin's price choice instead of a quote, and the row is marked with the
// admin. Nothing here messages the client directly: the update payload says
// whether GHL sends the client their updated shopping list, which only happens
// when the list changed and the admin left Send updated list to client on.
// Server only.

import { applyEventUpdate, getSession, quoteEventUpdate, VersionConflictError } from "@/lib/event-updates";
import { eventTimeZone } from "@/lib/team/markets";
import { honoreeRefusal, isHonoree, surpriseActive, type SurpriseColumns } from "@/lib/partners/surprise";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { applyChanges, isPricedField } from "@/lib/event-diff";
import { isServiceFeeEvent, serviceFeeBreakdown, withHoursBooked } from "@/lib/price-change";
import { recordedPayments } from "@/lib/team/business-db";
import { knownBalance } from "@/lib/balance";
import { autoSendOn, listWouldChange } from "@/lib/client-list-db";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { adminPrice, cleanAdminEdit, cleanPriceChoice } from "@/lib/team/admin-edit";
import { unpriced } from "@/lib/price-pending";
import { barbackStatus } from "@/lib/package-extras";
import { textPricePending } from "@/lib/price-pending-db";
import { holdForTeam } from "@/lib/team/held-changes-db";

export interface AdminPreview {
  priced: boolean; // a priced field changes, so the price choice matters
  bookedTotal: number | null;
  engineAmount: number | null;
  engineNewTotal: number | null;
  engineText: string;
  listChanges: string; // what the edit would change on the client's shopping list, empty when nothing
  autoSend: boolean; // the team setting, so the form can say the list will not go out while it is off
  // Service fee model events: the fee as its own line, before and after.
  serviceFee?: boolean;
  bookedBreakdown?: string | null;
  engineBreakdown?: string | null;
  // The remaining balance: the total less payments recorded. Null when nothing is recorded.
  paidCents?: number | null;
  balanceNow?: number | null;
  balanceAfter?: number | null;
}

export type PreviewResult = { ok: true; preview: AdminPreview } | { ok: false; error: string; status: number };

/** The engine's price for the edit, shown next to "apply the pricing engine's difference". Saves nothing. */
export async function previewAdminEdit(sessionId: string, rawChanges: unknown): Promise<PreviewResult> {
  const session = await getSession(sessionId);
  if (!session || session.status !== "submitted" || !session.event_data) return { ok: false, error: "We could not find that event.", status: 404 };
  const clean = cleanAdminEdit(rawChanges, session.event_data.package);
  if (!clean.ok) return { ok: false, error: clean.error, status: 400 };
  const quote = await quoteEventUpdate(sessionId, clean.partial, undefined, { ignoreCutoff: true });
  const p = quote?.price ?? null;
  const current = withHoursBooked(session.event_data, session);
  const list = listWouldChange(current, applyChanges(current, quote?.changes ?? []));
  const bp = session.booked_price ?? null;
  const serviceFee = isServiceFeeEvent(bp, session);
  const recorded = await recordedPayments(sessionId);
  const bookedTotal = p?.booked_total ?? (typeof bp?.total === "number" ? bp.total : null);
  return {
    ok: true,
    preview: {
      priced: !!quote?.changes.some((c) => isPricedField(c.field)),
      // The booked total even when nothing priced changes, so a date change can show it on its confirm.
      bookedTotal: p?.booked_total ?? (typeof session.booked_price?.total === "number" ? session.booked_price.total : null),
      engineAmount: p?.amount ?? null,
      engineNewTotal: p?.new_total ?? null,
      engineText: p?.price_text ?? "",
      listChanges: list.changed ? list.changes || "The list changes." : "",
      autoSend: await autoSendOn(),
      serviceFee,
      bookedBreakdown: serviceFee && bp ? serviceFeeBreakdown(bp) : null,
      engineBreakdown: serviceFee && p ? serviceFeeBreakdown(p) : null,
      paidCents: recorded?.any ? recorded.cents : null,
      balanceNow: knownBalance(bookedTotal, recorded),
      balanceAfter: p?.new_total != null ? knownBalance(p.new_total, recorded) : null,
    },
  };
}

export type SaveEditResult = { ok: true; version: number; changed: number; pricePending: boolean; held?: boolean } | { ok: false; error: string; status: number };

export async function saveAdminEdit(opts: {
  sessionId: string;
  admin: StaffMember;
  changes: unknown;
  price: unknown;
  expectedVersion: unknown;
  origin: string;
  sendList?: unknown; // "Send updated list to client", on unless the admin unchecked it
}): Promise<SaveEditResult> {
  const session = await getSession(opts.sessionId);
  if (!session || session.status !== "submitted" || !session.event_data) return { ok: false, error: "We could not find that event.", status: 404 };
  const clean = cleanAdminEdit(opts.changes, session.event_data.package);
  if (!clean.ok) return { ok: false, error: clean.error, status: 400 };
  // A surprise event: the guest of honor's number is never the day of contact.
  const sx = session as typeof session & SurpriseColumns;
  if (surpriseActive(sx, new Date(), eventTimeZone(session)) && isHonoree(sx, { phone: clean.partial.day_of_contact_phone })) {
    return { ok: false, error: honoreeRefusal("day of contact"), status: 409 };
  }
  // The barback can only be removed on a Full Bar wedding. The Big Day Bar and Premium always keep theirs.
  if ("barback" in clean.partial && !barbackStatus(session).removable) return { ok: false, error: "The barback is part of this package and cannot be removed.", status: 400 };
  const choice = cleanPriceChoice(opts.price);
  if (!choice.ok) return { ok: false, error: choice.error, status: 400 };
  const expectedVersion = typeof opts.expectedVersion === "number" ? opts.expectedVersion : undefined;
  const editor = { name: firstName(opts.admin.name), staffId: opts.admin.id };

  // "Leave the price pending" is only for a change the engine cannot price:
  // then it saves like a client change would, and the event is price pending.
  if (choice.mode === "pending") {
    const quote = await quoteEventUpdate(opts.sessionId, clean.partial, undefined, { ignoreCutoff: true });
    if (!unpriced(quote?.price)) return { ok: false, error: "The pricing engine can price this change. Keep the total, apply the engine's difference, or enter one by hand.", status: 400 };
  }

  let result;
  try {
    result = await applyEventUpdate(opts.sessionId, clean.partial, {
      source: "manager",
      ignoreCutoff: true,
      priceOverride: choice.mode === "pending" ? undefined : (engine) => adminPrice(engine, choice.mode, choice.total, editor.name),
      customTotal: choice.mode === "manual",
      editor,
      expectedVersion,
    });
  } catch (err) {
    if (err instanceof VersionConflictError) return { ok: false, error: err.message, status: 409 };
    throw err;
  }
  if (!result) return { ok: false, error: "We could not find that event.", status: 404 };
  if (result.rows.length === 0) return { ok: false, error: "Nothing changed.", status: 400 };

  // GHL note and update webhook (updated_by "admin"). Staff are not texted:
  // the change is held as "changes not sent to the team" until someone presses
  // Notify the team (one text listing all of them) or Do not notify.
  // The client gets the updated list only if the list changed and the box was left on.
  await deliverEventUpdates(opts.sessionId, result.rows, {
    clientList: { mode: "admin", send: opts.sendList !== false, by: { id: opts.admin.id, name: editor.name } },
  });
  const fresh = (await getSession(opts.sessionId)) ?? session;
  const held = await holdForTeam(fresh, result.rows, opts.origin);
  // Price pending rule: the admins get one text when a change is saved without a price.
  if (result.pricePending?.fresh) await textPricePending(session, result.pricePending.info);
  return { ok: true, version: result.version, changed: result.rows.reduce((n, r) => n + r.changes.length, 0), pricePending: !!result.pricePending?.fresh, held: held === "held" };
}
