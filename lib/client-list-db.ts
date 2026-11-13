// Database side of the automatic client shopping list: the team settings,
// the last list each client was sent, holds waiting for an admin, and the send
// log shown on the admin event page. Server only.
//
// With "Auto send client shopping list" off, every decision below is still
// made and logged (marked as a dry run) so admins can see what would have
// happened, but client_shopping_list_send is always false and nothing is held:
// client updates apply exactly as they do with the feature off.

import { supabase } from "@/lib/supabase";
import { siteOrigin } from "@/lib/team/clock-db";
import { replayHistory, type FieldChange } from "@/lib/event-diff";
import {
  clientList,
  clientListFields,
  clientListUrl,
  completionAction,
  hasCustomRecipe,
  listChanges,
  listIsEmpty,
  NOT_SENT_TEXT,
  orderSheetUrl,
  sameList,
  updateAction,
  type ClientList,
  type ClientListFields,
  type ListReason,
  type UpdateMode,
} from "@/lib/client-list";
import type { PriceChange } from "@/lib/price-change";

type EventData = Record<string, unknown>;

interface SessionLike {
  id: string;
  version?: number;
  event_data: EventData | null;
}

interface RowLike {
  id: string;
  version: number;
  applied: boolean;
}

export interface Actor {
  id: string;
  name: string; // first name
}

// ----- Team settings -----

export const AUTO_SEND_KEY = "auto_send_client_shopping_list";
export const SUGGEST_STORES_KEY = "order_sheet_store_suggestions";
export const SETTING_DEFAULTS: Record<string, boolean> = { [AUTO_SEND_KEY]: false, [SUGGEST_STORES_KEY]: true };

export async function teamSetting(key: string): Promise<boolean> {
  const fallback = SETTING_DEFAULTS[key] ?? false;
  const { data, error } = await supabase.from("team_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  const v = (data as { value: unknown }).value;
  return typeof v === "boolean" ? v : fallback;
}

export async function setTeamSetting(admin: { id: string; role: string }, key: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  if (!(key in SETTING_DEFAULTS)) return { ok: false, error: "Unknown setting.", status: 400 };
  const { error } = await supabase
    .from("team_settings")
    .upsert({ key, value: on, updated_by: admin.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true };
}

export const autoSendOn = () => teamSetting(AUTO_SEND_KEY);

// ----- Links -----

export const clientListLink = (sessionId: string) => clientListUrl(siteOrigin(), sessionId);
export const orderSheetLink = (sessionId: string) => orderSheetUrl(siteOrigin(), sessionId);

// ----- State: the list as the client last got it -----

export interface ListState {
  session_id: string;
  last_list: ClientList | null; // what the client was last sent (or would have been, in a dry run)
  released: boolean; // false while the first list waits for custom recipe review
  first_sent_at: string | null;
  last_sent_at: string | null;
}

export async function listState(sessionId: string): Promise<ListState | null> {
  const { data, error } = await supabase.from("client_list_state").select("*").eq("session_id", sessionId).maybeSingle();
  if (error || !data) return null;
  return data as ListState;
}

async function saveState(sessionId: string, patch: Partial<ListState>): Promise<void> {
  const { error } = await supabase
    .from("client_list_state")
    .upsert({ session_id: sessionId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "session_id" });
  if (error) console.error("[client-list] state save failed:", error.message);
}

// ----- Log -----

export type LogAction = "sent" | "held" | "approved" | "declined" | "not_sent";

export interface LogRow {
  id: string;
  session_id: string;
  created_at: string;
  action: LogAction;
  reason: ListReason | null;
  detail: string;
  changes: string | null;
  list_text: string | null;
  update_id: string | null;
  hold_id: string | null;
  by_staff_id: string | null;
  by_name: string | null; // who approved, declined, or sent it; null for automatic sends
  dry_run: boolean;
  version: number | null;
}

async function log(entry: Omit<LogRow, "id" | "created_at">): Promise<void> {
  const { error } = await supabase.from("client_list_log").insert(entry);
  if (error) console.error("[client-list] log insert failed:", error.message);
}

export async function listLog(sessionId: string): Promise<LogRow[]> {
  const { data, error } = await supabase.from("client_list_log").select("*").eq("session_id", sessionId).order("created_at", { ascending: false });
  if (error) return [];
  return (data as LogRow[]) ?? [];
}

// ----- Holds -----

export interface HoldRow {
  id: string;
  session_id: string;
  created_at: string;
  kind: "change" | "custom_recipe";
  status: "pending" | "approved" | "declined";
  partial: EventData | null; // the held update, applied as is on approve
  changes: FieldChange[] | null;
  summary: string | null; // what the client asked to change
  list_changes: string | null; // what it would change on the list
  price: PriceChange | null; // the price the client said yes to
  base_version: number | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  admin_text_after?: string | null; // the admin text waits for 8 AM after quiet hours
  admin_texted_at?: string | null; // the admins were texted about this request
}

export async function holdsFor(sessionId: string, status?: HoldRow["status"]): Promise<HoldRow[]> {
  let q = supabase.from("client_list_holds").select("*").eq("session_id", sessionId);
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) return [];
  return (data as HoldRow[]) ?? [];
}

export async function getHold(id: string): Promise<HoldRow | null> {
  const { data, error } = await supabase.from("client_list_holds").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as HoldRow;
}

/** Sessions with a change or a first list waiting on an admin, for the events list. */
export async function sessionsWithPendingHolds(sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();
  const { data, error } = await supabase.from("client_list_holds").select("session_id").eq("status", "pending").in("session_id", sessionIds);
  if (error) return new Set();
  return new Set(((data as { session_id: string }[]) ?? []).map((r) => r.session_id));
}

/** Sessions with a client change request waiting on an admin, for the events list and calendar marker. */
export async function sessionsWithPendingRequests(sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();
  const { data, error } = await supabase.from("client_list_holds").select("session_id").eq("status", "pending").eq("kind", "change").in("session_id", sessionIds);
  if (error) return new Set();
  return new Set(((data as { session_id: string }[]) ?? []).map((r) => r.session_id));
}

/**
 * A client request inside six days, held for an admin: a drink change, or
 * (auto send on) a change that would change their list. The same change asked
 * for twice is held once; fresh is true only for a new request.
 */
export async function holdChange(o: {
  sessionId: string;
  partial: EventData;
  changes: FieldChange[];
  summary: string;
  listChanges: string;
  price: PriceChange | null;
  baseVersion: number;
}): Promise<(HoldRow & { fresh: boolean }) | null> {
  const pending = await holdsFor(o.sessionId, "pending");
  const same = pending.find((h) => h.kind === "change" && JSON.stringify(h.partial) === JSON.stringify(o.partial));
  if (same) return { ...same, fresh: false };
  const { data, error } = await supabase
    .from("client_list_holds")
    .insert({
      session_id: o.sessionId,
      kind: "change",
      status: "pending",
      partial: o.partial,
      changes: o.changes,
      summary: o.summary,
      list_changes: o.listChanges,
      price: o.price,
      base_version: o.baseVersion,
    })
    .select("*")
    .single();
  if (error) {
    console.error("[client-list] hold insert failed:", error.message);
    return null;
  }
  const hold = data as HoldRow;
  await log({
    session_id: o.sessionId,
    action: "held",
    reason: null,
    detail: `Client change request inside 6 days, waiting for admin approval: ${o.summary.split("\n")[0]}`,
    changes: o.listChanges,
    list_text: null,
    update_id: null,
    hold_id: hold.id,
    by_staff_id: null,
    by_name: null,
    dry_run: false,
    version: o.baseVersion,
  });
  return { ...hold, fresh: true };
}

/** Marks a pending hold approved or declined. False when someone already decided it. */
export async function decideHold(id: string, status: "approved" | "declined", by: Actor): Promise<boolean> {
  const { data, error } = await supabase
    .from("client_list_holds")
    .update({ status, decided_by: by.id, decided_by_name: by.name, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  return !error && !!data && data.length > 0;
}

// ----- Decisions -----

/** The list before an update, for events that started before list state was kept. */
async function legacyBaseline(sessionId: string, version: number): Promise<ClientList | null> {
  const { data, error } = await supabase.from("event_updates").select("version, applied, changes").eq("session_id", sessionId);
  if (error || !data) return null;
  const before = replayHistory(data as { version: number; applied: boolean; changes: FieldChange[] }[], version - 1);
  return before ? clientList(before) : null;
}

/**
 * Intake completion: send the first list (also when booked inside six days),
 * or hold it for review when a drink has a custom recipe. Decided once per
 * event: a repeat call returns the same decision without logging again.
 */
export async function completionFields(sessionId: string): Promise<ClientListFields & { order_sheet_url: string }> {
  const url = clientListLink(sessionId);
  const order_sheet_url = orderSheetLink(sessionId);
  const { data: row } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  const session = row as (SessionLike & { status?: string; created_by?: string | null; send_client_list?: boolean | null }) | null;
  const enabled = await autoSendOn();
  if (!session?.event_data || session.status !== "submitted") {
    return { ...clientListFields({ enabled, send: false, reason: null, changes: "", url, list: { sections: [], notes: [] } }), order_sheet_url };
  }
  const list = clientList(session.event_data);
  const prior = await listState(sessionId);
  if (prior) {
    // Already decided (a repeat of the intake webhook): the first list never goes out twice.
    return { ...clientListFields({ enabled, send: false, reason: null, changes: "", url, list }), order_sheet_url };
  }

  const action = completionAction({ customRecipe: hasCustomRecipe(session.event_data), empty: listIsEmpty(list) });
  const base = { session_id: sessionId, update_id: null, by_staff_id: null, by_name: null, dry_run: !enabled, version: session.version ?? 1 };
  // An event an admin added by hand never sends the client a list unless the admin ticked "Send the client their list".
  if (session.created_by === "admin" && session.send_client_list !== true && action !== "no_list") {
    await saveState(sessionId, { last_list: list, released: true });
    await log({ ...base, action: "not_sent", reason: null, detail: "Not sent: the event was added by hand and Send the client their list was not ticked.", changes: null, list_text: null, hold_id: null });
    return { ...clientListFields({ enabled, send: false, reason: null, changes: "", url, list }), order_sheet_url };
  }
  if (action === "no_list") {
    await saveState(sessionId, { last_list: list, released: true });
    await log({ ...base, action: "not_sent", reason: null, detail: "Not sent: this package has no client shopping list.", changes: null, list_text: null, hold_id: null });
    return { ...clientListFields({ enabled, send: false, reason: null, changes: "", url, list }), order_sheet_url };
  }
  if (action === "hold_custom" && enabled) {
    const { data, error } = await supabase
      .from("client_list_holds")
      .insert({ session_id: sessionId, kind: "custom_recipe", status: "pending", base_version: session.version ?? 1 })
      .select("id")
      .single();
    const holdId = error ? null : (data as { id: string }).id;
    await saveState(sessionId, { last_list: null, released: false });
    await log({ ...base, action: "held", reason: "first", detail: "First list held: a drink has a custom recipe. Review and send it from the admin event page.", changes: null, list_text: null, hold_id: holdId });
    return { ...clientListFields({ enabled, send: false, reason: null, changes: "", url, list }), order_sheet_url };
  }
  const now = new Date().toISOString();
  await saveState(sessionId, { last_list: list, released: true, first_sent_at: now, last_sent_at: now });
  await log({
    ...base,
    action: "sent",
    reason: "first",
    detail: enabled
      ? "First list sent on completion."
      : action === "hold_custom"
        ? "Dry run (auto send off): the first list would have been held for review of a custom recipe."
        : "Dry run (auto send off): the first list would have been sent on completion.",
    changes: null,
    list_text: null,
    hold_id: null,
  });
  return { ...clientListFields({ enabled, send: true, reason: "first", changes: "", url, list }), order_sheet_url };
}

export interface DeliveryListOptions {
  mode: UpdateMode;
  send?: boolean; // admin edits: the "Send updated list to client" checkbox
  by?: Actor | null;
  holdId?: string | null;
}

/**
 * The client list fields for each row of an update being delivered. Only the
 * applied row carries a send. A row delivered before (a manual retry) gets the
 * decision it got the first time, so a retry never sends a second time or skips the first.
 */
export async function deliveryFields(
  session: SessionLike,
  rows: RowLike[],
  opts: DeliveryListOptions = { mode: "client" },
  locked: boolean,
): Promise<Map<string, ClientListFields & { order_sheet_url: string }>> {
  const out = new Map<string, ClientListFields & { order_sheet_url: string }>();
  const url = clientListLink(session.id);
  const order_sheet_url = orderSheetLink(session.id);
  const enabled = await autoSendOn();
  const list = clientList(session.event_data ?? {});
  const blank = { ...clientListFields({ enabled, send: false, reason: null, changes: "", url, list }), order_sheet_url };
  for (const r of rows) out.set(r.id, blank);

  const row = rows.find((r) => r.applied);
  if (!row) return out;

  const earlier = (await listLog(session.id)).find((l) => l.update_id === row.id);
  if (earlier) {
    const send = earlier.action === "sent" || earlier.action === "approved";
    out.set(row.id, { ...clientListFields({ enabled, send: send && !earlier.dry_run, reason: earlier.reason, changes: earlier.changes ?? "", url, list }), order_sheet_url });
    return out;
  }

  const state = await listState(session.id);
  const baseline = state ? state.last_list : await legacyBaseline(session.id, row.version);
  const released = state ? state.released : true;
  const changed = !sameList(baseline, list);
  const action = updateAction({ mode: opts.mode, released, changed, locked, adminSend: opts.send });
  const changes = listChanges(baseline, list);
  const base = { session_id: session.id, update_id: row.id, hold_id: opts.holdId ?? null, by_staff_id: opts.by?.id ?? null, by_name: opts.by?.name ?? null, dry_run: !enabled, version: row.version };

  if (!action.send) {
    if (action.why !== "unchanged") {
      const detail = action.why === "locked" && !enabled
        ? "Dry run (auto send off): this change would have been held for admin approval, the list is locked within 6 days."
        : NOT_SENT_TEXT[action.why];
      await log({ ...base, action: "not_sent", reason: null, detail, changes, list_text: null });
    }
    return out;
  }

  const now = new Date().toISOString();
  await saveState(session.id, { last_list: list, released: true, last_sent_at: now });
  const who = opts.by?.name ? ` by ${opts.by.name}` : "";
  const detail =
    action.reason === "approved"
      ? `Held change approved${who}, updated list sent.`
      : opts.mode === "admin"
        ? `Admin edit${who} changed the list, updated list sent.`
        : "Client update changed the list, updated list sent.";
  await log({ ...base, action: action.reason === "approved" ? "approved" : "sent", reason: action.reason, detail: enabled ? detail : `Dry run (auto send off): ${detail.replace(/sent\.$/, "would have been sent.")}`, changes, list_text: null });
  out.set(row.id, { ...clientListFields({ enabled, send: true, reason: action.reason, changes, url, list }), order_sheet_url });
  return out;
}

/** True when the client update would change the client's list. */
export function listWouldChange(before: EventData, after: EventData): { changed: boolean; changes: string } {
  const a = clientList(before);
  const b = clientList(after);
  return { changed: !sameList(a, b), changes: listChanges(a, b) };
}

/** Records the first list going out after a custom recipe review. */
export async function releaseFirstList(session: SessionLike, holdId: string, by: Actor): Promise<ClientListFields & { order_sheet_url: string }> {
  const enabled = await autoSendOn();
  const list = clientList(session.event_data ?? {});
  const now = new Date().toISOString();
  await saveState(session.id, { last_list: list, released: true, first_sent_at: now, last_sent_at: now });
  await log({
    session_id: session.id,
    action: "approved",
    reason: "first",
    detail: `Custom recipe reviewed by ${by.name || "an admin"}, first list sent.`,
    changes: null,
    list_text: null,
    update_id: null,
    hold_id: holdId,
    by_staff_id: by.id,
    by_name: by.name,
    dry_run: !enabled,
    version: session.version ?? null,
  });
  return { ...clientListFields({ enabled, send: true, reason: "first", changes: "", url: clientListLink(session.id), list }), order_sheet_url: orderSheetLink(session.id) };
}

/** Logs a declined hold. */
export async function logDecline(session: SessionLike, hold: HoldRow, by: Actor): Promise<void> {
  await log({
    session_id: session.id,
    action: "declined",
    reason: null,
    detail: `Held change declined by ${by.name || "an admin"}. The event was not changed.`,
    changes: hold.list_changes,
    list_text: null,
    update_id: null,
    hold_id: hold.id,
    by_staff_id: by.id,
    by_name: by.name,
    dry_run: false,
    version: session.version ?? null,
  });
}

/** Logs an approved hold whose change was already on file, so nothing applied. */
export async function logApprovedNoChange(session: SessionLike, hold: HoldRow, by: Actor, fields: { sent: boolean }): Promise<void> {
  await log({
    session_id: session.id,
    action: "approved",
    reason: "approved",
    detail: `Held change approved by ${by.name || "an admin"}. It was already on file, the list was ${fields.sent ? "sent" : "not sent"}.`,
    changes: null,
    list_text: null,
    update_id: null,
    hold_id: hold.id,
    by_staff_id: by.id,
    by_name: by.name,
    dry_run: !(await autoSendOn()),
    version: session.version ?? null,
  });
}

/** Whether the client's event page shows their list: auto send on, and the first list is not waiting for review. */
export async function clientCanSeeList(sessionId: string): Promise<boolean> {
  if (!(await autoSendOn())) return false;
  const state = await listState(sessionId);
  return state ? state.released : true;
}
