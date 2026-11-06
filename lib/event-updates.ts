// Database side of update mode: record the intake submission as version 1 and
// apply post submission changes as versioned event_updates rows.

import { supabase } from "@/lib/supabase";
import {
  applyChanges,
  computeDeadlines,
  planUpdate,
  replayHistory,
  snapshotChanges,
  summarizeChanges,
  type EventData,
  type FieldChange,
  type PlannedRow,
} from "@/lib/event-diff";
import {
  basisFromEvent,
  buildPendingChange,
  computeBaseline,
  withHoursBooked,
  type BookedPrice,
  type PendingChange,
} from "@/lib/change-order";

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
  // Read with select("*"), so missing until the change order migration runs.
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
  change_order?: PendingChange | null; // set on change order rows: the pending change as priced then
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
  pendingChange: PendingChange | null; // the session's pending change order after this update
  changeOrderSent: boolean; // this update created or changed the pending change order
  paymentPreference: string | null;
}

function toInsert(
  sessionId: string,
  row: PlannedRow,
  version: number,
  source: "concierge" | "manager",
  extra: { change_order?: PendingChange | null; change_approval_needed?: boolean } = {}
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
  // Only written when set, so updates keep working before the migration adds these columns.
  if (extra.change_order) insert.change_order = extra.change_order;
  if (extra.change_approval_needed) insert.change_approval_needed = true;
  return insert;
}

/**
 * What the client booked. Sessions created before booked prices were stored get
 * one computed from the original (version 1) event with the engine.
 */
async function resolveBookedPrice(
  session: SessionRow
): Promise<{ booked: BookedPrice | null; original: EventData; computed: boolean }> {
  const history = await getEventUpdates(session.id);
  const original = replayHistory(history, 1) ?? session.event_data ?? {};
  if (session.booked_price && session.booked_price.total !== null && session.booked_price.total !== undefined) {
    return { booked: session.booked_price, original, computed: false };
  }
  const computed = computeBaseline(original, session, {
    promoCode: session.booked_price?.promo_code ?? null,
    tipJar: session.booked_price?.tip_jar ?? true,
  });
  if (computed && session.booked_price?.deposit_paid) computed.deposit_paid = session.booked_price.deposit_paid;
  return { booked: computed, original, computed: computed !== null };
}

/**
 * Diff a partial event against the session's current event_data, merge what is
 * allowed now and bump the version, hold change order fields on
 * session.pending_change with their price, and record late drink changes and
 * manager requests as unapplied rows. Returns null if the session is not submitted.
 */
export async function applyEventUpdate(
  sessionId: string,
  partial: EventData,
  options: {
    managerRequest?: string | null;
    changeApprovalNeeded?: boolean;
    source?: "concierge" | "manager";
    now?: Date;
  } = {}
): Promise<ApplyResult | null> {
  const source = options.source ?? "concierge";

  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await getSession(sessionId);
    if (!session || session.status !== "submitted" || !session.event_data) return null;

    // Sessions submitted before hours_booked was saved get it filled in here.
    const current = withHoursBooked(session.event_data, session);
    const deadlines = computeDeadlines(current.event_date ?? session.event_date, options.now);
    const plan = planUpdate(current, partial, {
      managerRequest: options.managerRequest,
      deadlines,
      pending: session.pending_change?.changes ?? null,
    });

    let version = session.version;
    let updatedAt = session.updated_at ?? session.submitted_at;
    const sessionUpdate: Record<string, unknown> = {};

    // Change order: price every pending field against what the client booked.
    let pendingChange: PendingChange | null = session.pending_change ?? null;
    let changeOrderRow: PlannedRow | null = null;
    if (plan.pendingChanges) {
      if (plan.pendingChanges.length === 0) {
        pendingChange = null; // the client went back to the booked details
        changeOrderRow = {
          changes: plan.changeOrder,
          applied: false,
          within_deadline: null,
          summary: `Change order canceled, back to the booked details:\n\n${summarizeChanges(plan.changeOrder, null, 440)}`,
        };
      } else {
        const { booked, original, computed } = await resolveBookedPrice(session);
        if (computed && booked) sessionUpdate.booked_price = booked;
        const originalBasis =
          booked?.basis ??
          (booked ? basisFromEvent(original, session, { tipJar: booked.tip_jar, bartenders: booked.bartenders }) : null);
        pendingChange = buildPendingChange({
          booked: booked ?? {
            package_price: null, gratuity: null, total: null, bartenders: null, promo_code: null,
            custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: 150, source: "computed",
          },
          original: originalBasis,
          nextEvent: applyChanges(plan.next, plan.pendingChanges),
          session,
          pending: plan.pendingChanges,
          baseVersion: version,
          now: options.now,
        });
        const head = `Change order sent: ${pendingChange.price_text}`;
        changeOrderRow = {
          changes: plan.changeOrder,
          applied: false,
          within_deadline: null,
          summary: `${head}\n\n${summarizeChanges(plan.changeOrder, null, Math.max(120, 500 - head.length - 2))}`,
        };
      }
      sessionUpdate.pending_change = pendingChange;
    }

    if (plan.applied) {
      sessionUpdate.event_data = plan.next;
      sessionUpdate.version = version + 1;
    } else if (Object.keys(sessionUpdate).length > 0 && current !== session.event_data) {
      sessionUpdate.event_data = current;
    }

    if (Object.keys(sessionUpdate).length > 0) {
      const nowIso = new Date().toISOString();
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
      if (plan.applied) version += 1;
      updatedAt = nowIso;
    }

    const approval = { change_approval_needed: options.changeApprovalNeeded === true };
    const inserts = [
      plan.applied ? toInsert(sessionId, plan.applied, version, source, approval) : null,
      changeOrderRow
        ? toInsert(sessionId, changeOrderRow, version, source, { ...approval, change_order: pendingChange })
        : null,
      plan.late ? toInsert(sessionId, plan.late, version, source, approval) : null,
      plan.requests ? toInsert(sessionId, plan.requests, version, source, approval) : null,
    ].filter((r): r is Record<string, unknown> => r !== null);

    let rows: EventUpdateRow[] = [];
    if (inserts.length > 0) {
      const { data, error } = await supabase.from("event_updates").insert(inserts).select("*");
      if (error) throw new Error(`event_updates insert failed: ${error.message}`);
      rows = (data as EventUpdateRow[]) ?? [];
    }

    const eventData = plan.applied ? plan.next : current;
    return {
      eventData,
      version,
      updatedAt,
      rows,
      pendingChange,
      changeOrderSent: changeOrderRow !== null,
      paymentPreference: (eventData.payment_preference as string | undefined) || null,
    };
  }

  throw new Error("event update kept conflicting with a concurrent update");
}
