// Database side of update mode: record the intake submission as version 1 and
// apply post submission changes as versioned event_updates rows.

import { supabase } from "@/lib/supabase";
import {
  applyChanges,
  computeDeadlines,
  isPricedField,
  planUpdate,
  snapshotChanges,
  summarizeRow,
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
  withImpliedChanges,
  toCount,
  withHoursBooked,
  type BookedPrice,
  type PendingChange,
  type PriceChange,
} from "@/lib/price-change";

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

export interface ApplyResult {
  eventData: EventData;
  version: number;
  updatedAt: string | null;
  rows: EventUpdateRow[];
  priceChange: PriceChange | null; // the price change saved with this update
  // Set when the update changed the price but the bot had not quoted this new
  // total. Nothing was saved: the bot states the price and asks for a yes first.
  needsQuote: PriceChange | null;
  refusedDrinks: boolean; // drink changes inside the six day cutoff, dropped
  withinSixDays: boolean;
  paymentPreference: string | null;
}

function toInsert(
  sessionId: string,
  row: PlannedRow,
  version: number,
  source: "concierge" | "manager",
  extra: { price?: PriceChange | null; change_approval_needed?: boolean } = {}
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
  refusedDrinks: boolean;
}

/** Plan and price an update without saving anything. */
function prepareUpdate(
  session: SessionRow & { event_data: EventData },
  partial: EventData,
  options: { managerRequest?: string | null; now?: Date }
): PreparedUpdate {
  // Sessions submitted before hours_booked was saved get it filled in here.
  const current = withHoursBooked(session.event_data, session);
  const deadlines = computeDeadlines(current.event_date ?? session.event_date, options.now);
  const plan = planUpdate(current, partial, { managerRequest: options.managerRequest, deadlines });

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
    // Hours follow new times, and bartenders follow what the change was priced with.
    const all = withImpliedChanges(current, { changes: asked, basis: price.basis }, booked?.bartenders ?? original?.bartenders ?? null);
    if (all.length > asked.length) {
      next = applyChanges(current, all);
      applied = { changes: all, applied: true, within_deadline: true, summary: summarizeRow({ changes: all, applied: true, within_deadline: true }) };
    }
  }

  return { current, deadlines, applied, requests: plan.requests, next, price, booked, bookedComputed, refusedDrinks: plan.refusedDrinks };
}

export interface QuoteResult {
  price: PriceChange | null; // null when nothing priced changes
  refusedDrinks: boolean;
  withinSixDays: boolean;
  changes: FieldChange[]; // what would apply, implied changes included
}

/** Price a proposed update for the bot to quote. Saves nothing. Null if the session is not submitted. */
export async function quoteEventUpdate(sessionId: string, partial: EventData, now?: Date): Promise<QuoteResult | null> {
  const session = await getSession(sessionId);
  if (!session || session.status !== "submitted" || !session.event_data) return null;
  const prep = prepareUpdate(session as SessionRow & { event_data: EventData }, partial, { now });
  return {
    price: prep.price,
    refusedDrinks: prep.refusedDrinks,
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
 * rows. Drink changes inside the six day cutoff are dropped. With
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
  } = {}
): Promise<ApplyResult | null> {
  const source = options.source ?? "concierge";

  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await getSession(sessionId);
    if (!session || session.status !== "submitted" || !session.event_data) return null;

    const prep = prepareUpdate(session as SessionRow & { event_data: EventData }, partial, options);
    const { current, applied, requests, next, price, booked } = prep;
    let version = session.version;
    let updatedAt = session.updated_at ?? session.submitted_at;
    const base = {
      priceChange: null,
      needsQuote: null,
      refusedDrinks: prep.refusedDrinks,
      withinSixDays: prep.deadlines.withinSixDays,
      paymentPreference: (current.payment_preference as string | undefined) || null,
    };

    if (price && options.requireQuote && !quoteMatches(price, options.quotedNewTotal)) {
      return { ...base, eventData: current, version, updatedAt, rows: [], needsQuote: price };
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
          price.new_total !== null ? bookedAfter(booked, price, toCount(next.bartenders), nowIso) : booked;
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

    const approval = { change_approval_needed: options.changeApprovalNeeded === true };
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
