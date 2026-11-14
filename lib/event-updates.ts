// Database side of update mode: record the intake submission as version 1 and
// apply post submission changes as versioned event_updates rows.

import { supabase } from "@/lib/supabase";
import {
  applyChanges,
  computeDeadlines,
  isDrinkField,
  isPricedField,
  UPDATABLE_FIELDS,
  planUpdate,
  snapshotChanges,
  summarizeChanges,
  summarizeRow,
  topField,
  type Deadlines,
  type EventData,
  type FieldChange,
  type PlannedRow,
} from "@/lib/event-diff";
import {
  basisFromEvent,
  bookedAfter,
  buildPriceChange,
  computeBaseline,
  priceText,
  withImpliedChanges,
  toCount,
  withHoursBooked,
  type BookedPrice,
  type PendingChange,
  type PriceChange,
} from "@/lib/price-change";
import { eventTimeZone } from "@/lib/team/markets";
import { addPending, unpriced, unpricedReason, type PricePendingInfo } from "@/lib/price-pending";
import { packageKey } from "@/lib/pricing";
import { autoSendOn, holdChange, listWouldChange } from "@/lib/client-list-db";

export const SESSION_COLUMNS =
  "id, name, email, event_date, package_type, guest_count, event_name, hours_booked, status, event_data, version, submitted_at, updated_at";

export interface SessionRow {
  id: string;
  name: string | null;
  email: string | null;
  event_date: string | null;
  package_type: string | null;
  guest_count: string | null;
  event_name: string | null;
  hours_booked: string | null;
  status: "in_progress" | "submitted";
  event_data: EventData | null;
  version: number;
  submitted_at: string | null;
  updated_at: string | null;
  // Read with select("*"). pending_change is only set by change orders from
  // before every update applied right away, read by /api/manager-update.
  pending_change?: PendingChange | null;
  booked_price?: BookedPrice | null;
  // Set while a saved change could not be priced (supabase/migrations/20261203_price_pending.sql).
  price_pending?: boolean | null;
  price_pending_info?: PricePendingInfo | null;
}

export interface EventUpdateRow {
  id: string;
  session_id: string;
  version: number;
  created_at: string;
  source: "concierge" | "manager";
  changes: FieldChange[];
  summary: string | null;
  within_deadline: boolean | null;
  applied: boolean;
  change_order?: PriceChange | null; // the update's price change, when it changed a priced field
  change_approval_needed?: boolean | null; // the bot passed something to management
  updated_by?: "client" | "admin" | null; // who made the change; null on rows from before this column
  updated_by_name?: string | null; // the admin's first name, for admin edits
  updated_by_staff_id?: string | null;
}

/** An admin who edited the event from the team portal. */
export interface AdminEditor {
  name: string; // first name
  staffId: string;
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    console.error("sessions lookup error:", error);
    return null;
  }
  return (data as SessionRow | null) ?? null;
}

export async function getEventUpdates(sessionId: string): Promise<EventUpdateRow[]> {
  const { data, error } = await supabase
    .from("event_updates")
    .select("*")
    .eq("session_id", sessionId)
    .order("version", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("event_updates lookup error:", error);
    return [];
  }
  return (data as EventUpdateRow[]) ?? [];
}

/** Drop the old intake fields save-event already strips before storing. */
export function stripLegacyFields(eventData: EventData): EventData {
  const { age_range: _age, menu_style: _ms, menu_notes: _mn, menu_design_preference: _mdp, ...rest } =
    eventData;
  return rest;
}

/**
 * Save the full submit_event_data payload on the session row as version 1 and
 * write the version 1 history row. Does nothing if the session row does not
 * exist (chats started without a /s link) or was already submitted.
 */
export async function recordSubmission(sessionId: string, eventData: EventData): Promise<boolean> {
  const { data: bookedRow } = await supabase.from("sessions").select("hours_booked").eq("id", sessionId).maybeSingle();
  const clean = withHoursBooked(stripLegacyFields(eventData), { hours_booked: bookedRow?.hours_booked ?? null });
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("sessions")
    .update({ event_data: clean, status: "submitted", submitted_at: nowIso, updated_at: nowIso, version: 1 })
    .eq("id", sessionId)
    .neq("status", "submitted")
    .select("id");
  if (error) {
    console.error("sessions submission update error:", error);
    return false;
  }
  if (!data || data.length === 0) return false;

  const { error: insertError } = await supabase.from("event_updates").insert({
    session_id: sessionId,
    version: 1,
    source: "concierge",
    changes: snapshotChanges(clean),
    summary: "Initial submission",
    within_deadline: true,
    applied: true,
  });
  if (insertError) console.error("event_updates version 1 insert error:", insertError);
  return true;
}

export type FinalSaveOutcome = "saved" | "already_submitted" | "failed";

/**
 * The concierge's final save: recordSubmission, tried a second time after a
 * short pause when it fails, and a loud [FINAL SAVE FAILED] log line when it
 * still does. A session that ends up here shows on the admin Staffing page
 * under "Finished but not saved" (lib/unsaved-sessions-db.ts).
 */
export async function saveFinalSubmission(
  sessionId: string,
  eventData: EventData,
  opts: { retryDelayMs?: number } = {}
): Promise<FinalSaveOutcome> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ok = await recordSubmission(sessionId, eventData).catch((err) => {
      console.error(`final save attempt ${attempt} threw for session ${sessionId}:`, err);
      return false;
    });
    if (ok) return "saved";
    // false also means the row was already submitted (a repeat call), which is not a failure.
    const { data } = await supabase.from("sessions").select("status, event_data").eq("id", sessionId).maybeSingle();
    if (data?.status === "submitted" && data.event_data) return "already_submitted";
    if (attempt === 1) await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 1500));
  }
  const ed = eventData as Record<string, unknown>;
  console.error(
    `[FINAL SAVE FAILED] session=${sessionId} client=${String(ed.client_name ?? "")} event_date=${String(ed.event_date ?? "")}: ` +
      "the client finished the concierge but the session was not marked submitted. It is listed on the admin Staffing page."
  );
  return "failed";
}

export interface ApplyResult {
  eventData: EventData;
  version: number;
  updatedAt: string | null;
  rows: EventUpdateRow[];
  priceChange: PriceChange | null; // the price change saved with this update
  // Set when the update changed the price but the bot had not quoted this new
  // total. Nothing was saved: the bot states the price and asks for a yes first.
  needsQuote: PriceChange | null;
  // A drink change inside the six day cutoff that could not be saved as a
  // request (the database refused it). Nothing was saved.
  requestFailed: boolean;
  diveMenuSet: boolean; // drink changes on Dive Bar, which has a set menu, dropped
  withinSixDays: boolean;
  paymentPreference: string | null;
  // Inside six days a client drink change, and (auto send on) a client change
  // that would change their shopping list, is not saved: it is a request for an
  // admin to approve or decline. fresh is false when the same request was
  // already waiting, so the admins are only texted once.
  held: { id: string; listChanges: string; fresh: boolean } | null;
  // A saved change the engine could not price: the event is now price pending.
  // fresh is true when this call added it (text the admins), false when nothing new was saved.
  pricePending: { info: PricePendingInfo; fresh: boolean; marked: boolean } | null;
}

function toInsert(
  sessionId: string,
  row: PlannedRow,
  version: number,
  source: "concierge" | "manager",
  extra: { price?: PriceChange | null; change_approval_needed?: boolean; editor?: AdminEditor | null } = {}
) {
  const insert: Record<string, unknown> = {
    session_id: sessionId,
    version,
    source,
    changes: row.changes,
    summary: row.summary,
    within_deadline: row.within_deadline,
    applied: row.applied,
  };
  // The change_order column holds the update's price change. Only written when set.
  if (extra.price) insert.change_order = extra.price;
  if (extra.change_approval_needed) insert.change_approval_needed = true;
  // Admin edits are marked with the admin. Client rows keep the column default.
  if (extra.editor) {
    insert.updated_by = "admin";
    insert.updated_by_name = extra.editor.name;
    insert.updated_by_staff_id = extra.editor.staffId;
  }
  return insert;
}

/**
 * What the client booked. Sessions created before booked prices were stored get
 * one computed from the event as it stands with the engine.
 */
function resolveBookedPrice(session: SessionRow, current: EventData): { booked: BookedPrice | null; computed: boolean } {
  if (session.booked_price && session.booked_price.total !== null && session.booked_price.total !== undefined) {
    return { booked: session.booked_price, computed: false };
  }
  const computed = computeBaseline(current, session, {
    promoCode: session.booked_price?.promo_code ?? null,
    tipJar: session.booked_price?.tip_jar ?? true,
  });
  if (computed && session.booked_price?.deposit_paid) computed.deposit_paid = session.booked_price.deposit_paid;
  return { booked: computed, computed: computed !== null };
}

interface PreparedUpdate {
  current: EventData;
  deadlines: Deadlines;
  applied: PlannedRow | null; // what applies now, implied hours and bartenders included
  requests: PlannedRow | null;
  next: EventData;
  price: PriceChange | null;
  booked: BookedPrice | null;
  bookedComputed: boolean;
  cutoffChanges: FieldChange[]; // drink changes inside the cutoff, for a request
  diveMenuSet: boolean;
}

/** Plan and price an update without saving anything. */
function prepareUpdate(
  session: SessionRow & { event_data: EventData },
  partial: EventData,
  options: { managerRequest?: string | null; now?: Date; ignoreCutoff?: boolean }
): PreparedUpdate {
  // Sessions submitted before hours_booked was saved get it filled in here.
  const current = withHoursBooked(session.event_data, session);
  // Days are counted in the event's market time zone.
  const deadlines = computeDeadlines(current.event_date ?? session.event_date, options.now, eventTimeZone(session));
  // Admins are not bound by the six day cutoff.
  const planDeadlines = options.ignoreCutoff ? { ...deadlines, withinSixDays: false } : deadlines;
  const plan = planUpdate(current, partial, { managerRequest: options.managerRequest, deadlines: planDeadlines });

  let applied = plan.applied;
  let next = plan.next;
  let price: PriceChange | null = null;
  let booked: BookedPrice | null = null;
  let bookedComputed = false;

  const asked = applied?.changes ?? [];
  const priced = asked.filter((c) => isPricedField(c.field));
  if (priced.length > 0) {
    ({ booked, computed: bookedComputed } = resolveBookedPrice(session, current));
    const original =
      booked?.basis ??
      (booked ? basisFromEvent(current, session, { tipJar: booked.tip_jar, bartenders: booked.bartenders }) : null);
    price = buildPriceChange({
      booked: booked ?? {
        package_price: null, gratuity: null, total: null, bartenders: null, promo_code: null,
        custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: 150, source: "computed",
      },
      original,
      stored: current,
      nextEvent: next,
      session,
      changes: priced,
      baseVersion: session.version,
      now: options.now,
    });
    // While an earlier change waits for its price, the total this would build on is unknown.
    if (session.price_pending && price.new_total !== null) {
      price = { ...price, amount: null, new_total: null, package_price: null, gratuity: null, price_text: priceText(null, null) };
    }
    // Hours follow new times, and bartenders follow what the change was priced with.
    const all = withImpliedChanges(current, { changes: asked, basis: price.basis }, booked?.bartenders ?? original?.bartenders ?? null);
    if (all.length > asked.length) {
      next = applyChanges(current, all);
      applied = { changes: all, applied: true, within_deadline: true, summary: summarizeRow({ changes: all, applied: true, within_deadline: true }) };
    }
  }

  return { current, deadlines, applied, requests: plan.requests, next, price, booked, bookedComputed, cutoffChanges: plan.cutoffChanges, diveMenuSet: plan.diveMenuSet };
}

export interface QuoteResult {
  price: PriceChange | null; // null when nothing priced changes
  listHold: boolean; // saving it will send it to an admin as a request: it changes the shopping list inside six days
  diveMenuSet: boolean;
  withinSixDays: boolean;
  changes: FieldChange[]; // what would apply, implied changes included
}

/** Price a proposed update for the bot to quote. Saves nothing. Null if the session is not submitted. */
export async function quoteEventUpdate(
  sessionId: string,
  partial: EventData,
  now?: Date,
  opts: { ignoreCutoff?: boolean } = {}
): Promise<QuoteResult | null> {
  const session = await getSession(sessionId);
  if (!session || session.status !== "submitted" || !session.event_data) return null;
  const prep = prepareUpdate(session as SessionRow & { event_data: EventData }, partial, { now, ignoreCutoff: opts.ignoreCutoff });
  const listHold =
    !opts.ignoreCutoff && prep.deadlines.withinSixDays && !!prep.applied && listWouldChange(prep.current, prep.next).changed && (await autoSendOn());
  return {
    price: prep.price,
    listHold,
    diveMenuSet: prep.diveMenuSet,
    withinSixDays: prep.deadlines.withinSixDays,
    changes: prep.applied?.changes ?? [],
  };
}

/** True when the bot quoted this price change's new total before saving. */
export function quoteMatches(price: PriceChange, quotedNewTotal: unknown): boolean {
  if (price.new_total === null) return true; // nothing to quote, our team confirms the price
  const n = typeof quotedNewTotal === "number" ? quotedNewTotal : toCount(quotedNewTotal);
  return n !== null && Math.round(n) === Math.round(price.new_total);
}

/**
 * Apply a confirmed update right away: merge it into event_data and bump the
 * version, price any priced field against what the client booked and move the
 * booked price to the new total, and record extra drink requests as unapplied
 * rows. Inside the six day cutoff a client drink change (and, with auto send
 * on, a client change to their shopping list) is saved as a request for an
 * admin instead (see requestParts). With
 * requireQuote, an update that changes the price saves nothing unless
 * quotedNewTotal matches. Returns null if the session is not submitted.
 */
export async function applyEventUpdate(
  sessionId: string,
  partial: EventData,
  options: {
    managerRequest?: string | null;
    changeApprovalNeeded?: boolean;
    source?: "concierge" | "manager";
    requireQuote?: boolean;
    quotedNewTotal?: unknown;
    now?: Date;
    // Admin edits from the team portal: no six day cutoff, the admin's price
    // choice replaces the engine's price, and the row is marked with the admin.
    ignoreCutoff?: boolean;
    priceOverride?: (engine: PriceChange) => PriceChange;
    customTotal?: boolean; // the admin typed the new total
    editor?: AdminEditor | null;
    // Refuse to save when someone else changed the event since this version was read.
    expectedVersion?: number;
    // A price the client says they were quoted, for the price pending summary.
    clientQuoted?: string | null;
  } = {}
): Promise<ApplyResult | null> {
  const source = options.source ?? "concierge";

  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await getSession(sessionId);
    if (!session || session.status !== "submitted" || !session.event_data) return null;

    if (options.expectedVersion !== undefined && session.version !== options.expectedVersion) {
      throw new VersionConflictError();
    }
    const prep = prepareUpdate(session as SessionRow & { event_data: EventData }, partial, options);
    const { current, requests, booked } = prep;
    let { applied, next } = prep;
    const price = prep.price && options.priceOverride ? options.priceOverride(prep.price) : prep.price;
    let version = session.version;
    let updatedAt = session.updated_at ?? session.submitted_at;
    const base = {
      priceChange: null,
      needsQuote: null,
      requestFailed: false,
      diveMenuSet: prep.diveMenuSet,
      withinSixDays: prep.deadlines.withinSixDays,
      paymentPreference: (current.payment_preference as string | undefined) || null,
      held: null as ApplyResult["held"],
      pricePending: (session.price_pending && session.price_pending_info
        ? { info: session.price_pending_info, fresh: false, marked: true }
        : null) as ApplyResult["pricePending"],
    };

    if (price && options.requireQuote && !quoteMatches(price, options.quotedNewTotal)) {
      return { ...base, eventData: current, version, updatedAt, rows: [], needsQuote: price };
    }

    // Inside six days a client change can become a request for an admin: drink
    // changes always, and with auto send on anything that changes the client's
    // shopping list. Manager requests in the same update are still recorded
    // below. Admin edits (ignoreCutoff) are never held.
    const cutoff = prep.cutoffChanges;
    if (source === "concierge" && !options.ignoreCutoff && prep.deadlines.withinSixDays) {
      const listHold = !!applied && listWouldChange(current, next).changed && (await autoSendOn());
      if (listHold || cutoff.length > 0) {
        const parts = requestParts(current, partial, listHold ? applied!.changes : [], cutoff);
        const would = listWouldChange(current, applyChanges(current, parts.changes));
        const hold = await holdChange({
          sessionId,
          partial: parts.partial,
          changes: parts.changes,
          summary: summarizeChanges(parts.changes),
          listChanges: would.changes,
          price: listHold ? price : null,
          baseVersion: version,
        });
        if (hold) {
          base.held = { id: hold.id, listChanges: would.changes, fresh: hold.fresh === true };
          if (listHold) {
            applied = null;
            next = current;
          }
        } else if (cutoff.length > 0) {
          // Nothing is saved when the request could not be recorded.
          base.requestFailed = true;
          applied = null;
          next = current;
        }
      }
    }

    const nowIso = new Date().toISOString();
    const sessionUpdate: Record<string, unknown> = {};
    if (applied) {
      sessionUpdate.event_data = next;
      sessionUpdate.version = version + 1;
      // Keep the summary columns in step with the event.
      const touched = new Set(applied.changes.map((c) => c.field));
      if (touched.has("event_date")) sessionUpdate.event_date = next.event_date;
      if (touched.has("guest_count")) sessionUpdate.guest_count = String(next.guest_count ?? "");
      if (touched.has("package")) sessionUpdate.package_type = next.package;
      if (touched.has("hours_booked")) sessionUpdate.hours_booked = String(next.hours_booked ?? "");
      if (price && booked) {
        sessionUpdate.booked_price =
          price.new_total !== null
            ? {
                ...bookedAfter(booked, price, toCount(next.bartenders), nowIso),
                ...(options.customTotal ? { custom_price: price.new_total } : {}),
              }
            : booked;
      }
    } else if (requests && current !== session.event_data) {
      sessionUpdate.event_data = current;
    }

    if (Object.keys(sessionUpdate).length > 0) {
      sessionUpdate.updated_at = nowIso;
      // Only succeeds if nobody bumped the version since we read it.
      const { data, error } = await supabase
        .from("sessions")
        .update(sessionUpdate)
        .eq("id", sessionId)
        .eq("version", version)
        .select("id");
      if (error) throw new Error(`sessions update failed: ${error.message}`);
      if (!data || data.length === 0) continue;
      if (applied) version += 1;
      updatedAt = nowIso;
    }

    const approval = { change_approval_needed: options.changeApprovalNeeded === true, editor: options.editor ?? null };
    const inserts = [
      applied ? toInsert(sessionId, applied, version, source, { ...approval, price }) : null,
      requests ? toInsert(sessionId, requests, version, source, approval) : null,
    ].filter((r): r is Record<string, unknown> => r !== null);

    let rows: EventUpdateRow[] = [];
    if (inserts.length > 0) {
      const { data, error } = await supabase.from("event_updates").insert(inserts).select("*");
      if (error) throw new Error(`event_updates insert failed: ${error.message}`);
      rows = (data as EventUpdateRow[]) ?? [];
    }

    // Saved but not priced (rule: save it anyway, price later): mark the event
    // price pending. The admin's own total (priceOverride) is never pending.
    if (applied && rows.length > 0 && unpriced(price) && !options.priceOverride) {
      const pkgChange = applied.changes.find((c) => c.field === "package");
      const oldPackage = String(pkgChange?.old ?? current.package ?? session.package_type ?? "") || null;
      const info = addPending(session.price_pending ? session.price_pending_info : null, {
        changes: price!.changes,
        oldPackage,
        newPackage: pkgChange ? String(pkgChange.new ?? "") || null : null,
        oldTotal: booked?.total ?? null,
        clientQuoted: options.clientQuoted ?? null,
        reason: unpricedReason(oldPackage, packageKey(oldPackage) !== null, booked?.total ?? null),
        at: nowIso,
      });
      const { error: markErr } = await supabase
        .from("sessions")
        .update({ price_pending: true, price_pending_info: info, ...(session.price_pending ? {} : { price_pending_at: nowIso }) })
        .eq("id", sessionId);
      if (markErr) console.error(`[PRICE PENDING NOT MARKED] session=${sessionId}: ${markErr.message}. The change is saved; the admins are still texted.`);
      base.pricePending = { info, fresh: true, marked: !markErr };
    }

    const eventData = applied ? next : current;
    return {
      ...base,
      eventData,
      version,
      updatedAt,
      rows,
      priceChange: applied ? price : null,
      paymentPreference: (eventData.payment_preference as string | undefined) || null,
    };
  }

  throw new Error("event update kept conflicting with a concurrent update");
}

/**
 * What goes into a request inside the six day cutoff: the field changes the
 * admin sees (before and after), and the partial update that Approve applies
 * through the normal update path. Non drink fields come from what the client
 * asked for, so Approve prices and works out hours exactly as a normal update
 * would. Drink fields come from the event with the drink changes applied.
 */
export function requestParts(
  current: EventData,
  partial: EventData,
  heldApplied: FieldChange[],
  cutoff: FieldChange[]
): { partial: EventData; changes: FieldChange[] } {
  const out: EventData = {};
  if (heldApplied.length > 0) {
    for (const [k, v] of Object.entries(partial)) {
      if ((UPDATABLE_FIELDS as readonly string[]).includes(k) && v !== undefined && !isDrinkField(k)) out[k] = v;
    }
  }
  if (cutoff.length > 0) {
    const after = applyChanges(current, cutoff);
    for (const key of new Set(cutoff.map((c) => topField(c.field)))) {
      if ((UPDATABLE_FIELDS as readonly string[]).includes(key)) out[key] = after[key];
    }
  }
  return { partial: out, changes: [...heldApplied, ...cutoff] };
}

/** The event changed since the admin opened the form. */
export class VersionConflictError extends Error {
  constructor() {
    super("This event changed since you opened it. Reload the page and try again.");
  }
}

/**
 * Every change applied in this chat, oldest first: applied rows after
 * startVersion, with the booked total before the first price change and after
 * the last one.
 */
export async function changesSince(
  sessionId: string,
  startVersion: number
): Promise<{ changes: FieldChange[]; totalBefore: number | null; totalAfter: number | null }> {
  const rows = (await getEventUpdates(sessionId)).filter((r) => r.applied && r.version > startVersion && r.version > 1);
  const priced = rows.map((r) => r.change_order).filter((p): p is PriceChange => !!p && p.new_total !== null);
  return {
    changes: rows.flatMap((r) => r.changes),
    totalBefore: priced[0]?.booked_total ?? null,
    totalAfter: priced.at(-1)?.new_total ?? null,
  };
}
