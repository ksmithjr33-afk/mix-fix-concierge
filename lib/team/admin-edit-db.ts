// Admin edits of event details from the team portal. Saves through the same
// path as a client update (applyEventUpdate, then deliverEventUpdates), so the
// version bumps, an event_updates row is written, the lists and the needed
// bartender count follow the new event data, the GHL note and update webhook go
// out, and assigned staff are texted. Differences: no six day cutoff, the
// admin's price choice instead of a quote, and the row is marked with the
// admin. Nothing here messages the client. Server only.

import { applyEventUpdate, getSession, quoteEventUpdate, VersionConflictError } from "@/lib/event-updates";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { isPricedField } from "@/lib/event-diff";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { adminPrice, cleanAdminEdit, cleanPriceChoice } from "@/lib/team/admin-edit";

export interface AdminPreview {
  priced: boolean; // a priced field changes, so the price choice matters
  bookedTotal: number | null;
  engineAmount: number | null;
  engineNewTotal: number | null;
  engineText: string;
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
  return {
    ok: true,
    preview: {
      priced: !!quote?.changes.some((c) => isPricedField(c.field)),
      bookedTotal: p?.booked_total ?? null,
      engineAmount: p?.amount ?? null,
      engineNewTotal: p?.new_total ?? null,
      engineText: p?.price_text ?? "",
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
  await deliverEventUpdates(opts.sessionId, result.rows, { staffOrigin: opts.origin });
  return { ok: true, version: result.version, changed: result.rows.reduce((n, r) => n + r.changes.length, 0) };
}
