// Admin edits of event details from the team portal. Saves through the same
// path as a client update (applyEventUpdate, then deliverEventUpdates), so the
// version bumps, an event_updates row is written, the lists and the needed
// bartender count follow the new event data, the GHL note and update webhook go
// out, and assigned staff are texted. Differences: no six day cutoff, the
// admin's price choice instead of a quote, and the row is marked with the
// admin. Nothing here messages the client directly: the update payload says
// whether GHL sends the client their updated shopping list, which only happens
// when the list changed and the admin left Send updated list to client on.
// Server only.

import { applyEventUpdate, getSession, quoteEventUpdate, VersionConflictError } from "@/lib/event-updates";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { applyChanges, isPricedField } from "@/lib/event-diff";
import { withHoursBooked } from "@/lib/price-change";
import { autoSendOn, listWouldChange } from "@/lib/client-list-db";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { adminPrice, cleanAdminEdit, cleanPriceChoice } from "@/lib/team/admin-edit";

export interface AdminPreview {
  priced: boolean; // a priced field changes, so the price choice matters
  bookedTotal: number | null;
  engineAmount: number | null;
  engineNewTotal: number | null;
  engineText: string;
  listChanges: string; // what the edit would change on the client's shopping list, empty when nothing
  autoSend: boolean; // the team setting, so the form can say the list will not go out while it is off
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
  return {
    ok: true,
    preview: {
      priced: !!quote?.changes.some((c) => isPricedField(c.field)),
      bookedTotal: p?.booked_total ?? null,
      engineAmount: p?.amount ?? null,
      engineNewTotal: p?.new_total ?? null,
      engineText: p?.price_text ?? "",
      listChanges: list.changed ? list.changes || "The list changes." : "",
      autoSend: await autoSendOn(),
    },
  };
}

export type SaveEditResult = { ok: true; version: number; changed: number } | { ok: false; error: string; status: number };

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
  const choice = cleanPriceChoice(opts.price);
  if (!choice.ok) return { ok: false, error: choice.error, status: 400 };
  const expectedVersion = typeof opts.expectedVersion === "number" ? opts.expectedVersion : undefined;
  const editor = { name: firstName(opts.admin.name), staffId: opts.admin.id };

  let result;
  try {
    result = await applyEventUpdate(opts.sessionId, clean.partial, {
      source: "manager",
      ignoreCutoff: true,
      priceOverride: (engine) => adminPrice(engine, choice.mode, choice.total, editor.name),
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

  // GHL note, update webhook (updated_by "admin"), and texts to assigned staff.
  // The client gets the updated list only if the list changed and the box was left on.
  await deliverEventUpdates(opts.sessionId, result.rows, {
    staffOrigin: opts.origin,
    clientList: { mode: "admin", send: opts.sendList !== false, by: { id: opts.admin.id, name: editor.name } },
  });
  return { ok: true, version: result.version, changed: result.rows.reduce((n, r) => n + r.changes.length, 0) };
}
