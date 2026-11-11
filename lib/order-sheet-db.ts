// Database side of the order sheet: hand edits, store choices, Ordered checks,
// added lines, and the note, all saved per event in order_sheet_lines and
// order_sheet_meta. Nothing here writes to sessions or event_updates, so an
// order sheet edit never changes the event, the client's shopping list, the
// calculation, or any other event. Server only, admins only.

import { supabase } from "@/lib/supabase";
import { teamSetting, SUGGEST_STORES_KEY } from "@/lib/client-list-db";
import {
  buildSheet,
  byStore,
  calculatedLines,
  FIELD_NAMES,
  isSection,
  isStore,
  itemKey,
  recipes,
  sheetHeader,
  staleRows,
  type CalcLine,
  type FieldName,
  type Fields,
  type OrderStatus,
  type Recipe,
  type SavedLine,
  type Sheet,
  type SheetHeader,
  type SheetLine,
  type Store,
} from "@/lib/order-sheet";

type EventData = Record<string, unknown>;

interface SessionLike {
  id: string;
  event_date?: string | null;
  event_data: EventData | null;
}

export interface Editor {
  id: string;
  name: string; // first name
}

export interface SheetMeta {
  note: string;
  noteBy: string | null;
  noteAt: string | null;
  deliveryDayOf: boolean;
}

export interface SheetView {
  sessionId: string;
  header: SheetHeader;
  recipes: Recipe[];
  sheet: Sheet;
  byStore: ReturnType<typeof byStore>;
  meta: SheetMeta;
  suggestions: boolean; // the team setting
}

function eventDataOf(s: SessionLike): EventData {
  const ed = { ...(s.event_data ?? {}) };
  if (!ed.event_date && s.event_date) ed.event_date = s.event_date;
  return ed;
}

async function savedRows(sessionId: string): Promise<SavedLine[]> {
  const { data, error } = await supabase.from("order_sheet_lines").select("*").eq("session_id", sessionId);
  if (error) return [];
  return (data as SavedLine[]) ?? [];
}

async function meta(sessionId: string): Promise<SheetMeta> {
  const { data } = await supabase.from("order_sheet_meta").select("*").eq("session_id", sessionId).maybeSingle();
  const m = (data ?? {}) as { note?: string | null; note_by_name?: string | null; note_at?: string | null; delivery_day_of?: boolean | null };
  return { note: m.note ?? "", noteBy: m.note_by_name ?? null, noteAt: m.note_at ?? null, deliveryDayOf: m.delivery_day_of === true };
}

/**
 * The store each item was last given on another event, by item name. Used
 * only as a suggestion on lines with no store, never set by itself.
 */
async function lastStores(sessionId: string): Promise<Map<string, Store>> {
  const { data, error } = await supabase.from("order_sheet_lines").select("session_id, store, store_item, store_at").neq("session_id", sessionId);
  const out = new Map<string, Store>();
  if (error || !data) return out;
  const rows = (data as { session_id: string; store: unknown; store_item: string | null; store_at: string | null }[])
    .filter((r) => isStore(r.store) && r.store_item)
    .sort((a, b) => String(a.store_at ?? "").localeCompare(String(b.store_at ?? "")));
  for (const r of rows) out.set(r.store_item!, r.store as Store); // later ones win
  return out;
}

async function build(session: SessionLike): Promise<{ calc: CalcLine[]; saved: SavedLine[]; sheet: Sheet; suggestions: boolean }> {
  const ed = eventDataOf(session);
  const calc = calculatedLines(ed);
  const [saved, suggestions] = await Promise.all([savedRows(session.id), teamSetting(SUGGEST_STORES_KEY)]);
  const last = suggestions ? await lastStores(session.id) : new Map<string, Store>();
  const sheet = buildSheet(calc, saved, (name) => last.get(itemKey(name)) ?? null);
  return { calc, saved, sheet, suggestions };
}

export async function getSheetView(session: SessionLike): Promise<SheetView> {
  const ed = eventDataOf(session);
  const [{ sheet, suggestions }, m] = await Promise.all([build(session), meta(session.id)]);
  return { sessionId: session.id, header: sheetHeader(ed), recipes: recipes(ed), sheet, byStore: byStore(sheet), meta: m, suggestions };
}

/**
 * After an update: delete saved rows for lines that left the calculation and
 * nobody edited or ordered, so a line that comes back starts fresh. Edited or
 * ordered lines stay and show as no longer calculated. Never throws.
 */
export async function syncOrderSheet(session: SessionLike): Promise<number> {
  try {
    const saved = await savedRows(session.id);
    if (saved.length === 0) return 0;
    const stale = staleRows(calculatedLines(eventDataOf(session)), saved);
    if (stale.length > 0) await supabase.from("order_sheet_lines").delete().in("id", stale);
    return stale.length;
  } catch (err) {
    console.error("[order-sheet] sync failed:", err);
    return 0;
  }
}

/** Order status for each event on the admin list. */
export async function orderStatuses(sessions: SessionLike[]): Promise<Map<string, OrderStatus>> {
  const out = new Map<string, OrderStatus>();
  if (sessions.length === 0) return out;
  const { data, error } = await supabase.from("order_sheet_lines").select("*").in("session_id", sessions.map((s) => s.id));
  const rows = error ? [] : ((data as SavedLine[]) ?? []);
  for (const s of sessions) {
    try {
      out.set(s.id, buildSheet(calculatedLines(eventDataOf(s)), rows.filter((r) => r.session_id === s.id)).status);
    } catch {
      out.set(s.id, "not_started");
    }
  }
  return out;
}

// ----- Actions -----

export type ActionResult = { ok: true; view: SheetView } | { ok: false; error: string; status: number };

const MAX = 200;
const text = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX);

async function insertRow(row: Record<string, unknown>): Promise<SavedLine | null> {
  const { data, error } = await supabase.from("order_sheet_lines").insert(row).select("*").single();
  if (error) {
    console.error("[order-sheet] insert failed:", error.message);
    return null;
  }
  return data as SavedLine;
}

async function updateRow(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from("order_sheet_lines").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) console.error("[order-sheet] update failed:", error.message);
  return !error;
}

interface Target {
  line: SheetLine | null; // as shown on the sheet (null for a removed line)
  calc: CalcLine | null;
  saved: SavedLine | null;
}

function findTarget(ref: unknown, calc: CalcLine[], saved: SavedLine[], sheet: Sheet): Target | null {
  if (typeof ref !== "string") return null;
  const lines = [...sheet.sections.flatMap((s) => s.lines), ...sheet.removed];
  const line = lines.find((l) => l.ref === ref) ?? null;
  if (ref.startsWith("k:")) {
    const key = ref.slice(2);
    const c = calc.find((x) => x.key === key) ?? null;
    const s = saved.find((x) => x.line_key === key) ?? null;
    return c || s ? { line, calc: c, saved: s } : null;
  }
  if (ref.startsWith("i:")) {
    const s = saved.find((x) => x.id === ref.slice(2) && x.kind === "added") ?? null;
    return s ? { line, calc: null, saved: s } : null;
  }
  return null;
}

/** The saved row for a calculated line, created the first time someone touches it. */
async function rowFor(sessionId: string, t: Target): Promise<SavedLine | null> {
  if (t.saved) return t.saved;
  if (!t.calc) return null;
  return insertRow({ session_id: sessionId, line_key: t.calc.key, section: t.calc.section, kind: "calc" });
}

const calcFields = (c: CalcLine): Fields => ({ name: c.name, quantity: c.quantity, size: c.size, detail: c.detail });

export async function applySheetAction(session: SessionLike, editor: Editor, body: Record<string, unknown>): Promise<ActionResult> {
  const { calc, saved, sheet } = await build(session);
  const now = new Date().toISOString();
  const who = { by: editor.id, name: editor.name || "Admin" };
  const bad = (error: string, status = 400): ActionResult => ({ ok: false, error, status });

  switch (body.action) {
    case "edit": {
      const field = body.field as FieldName;
      if (!(FIELD_NAMES as readonly string[]).includes(field)) return bad("Unknown field.");
      const t = findTarget(body.ref, calc, saved, sheet);
      if (!t) return bad("That line is no longer on the sheet. Reload the page.", 404);
      const value = text(body.value);
      if (field === "name" && !value) return bad("A line needs an item name.");
      const row = await rowFor(session.id, t);
      if (!row) return bad("Could not save. Try again.", 500);
      if (row.kind === "added") {
        await updateRow(row.id, { [field]: value, edited_by: who.by, edited_by_name: who.name, edited_at: now });
        break;
      }
      // Typing the calculated value back clears the hand edit for that field.
      const calcValue = t.calc ? calcFields(t.calc)[field] : null;
      const override = calcValue !== null && value === calcValue ? null : value;
      const patch: Record<string, unknown> = { [field]: override };
      const otherOverrides = FIELD_NAMES.some((k) => k !== field && row[k] !== null && row[k] !== undefined);
      if (override !== null && t.calc && (!row.base || !otherOverrides)) patch.base = calcFields(t.calc);
      if (override === null && !otherOverrides) patch.base = null;
      Object.assign(patch, override !== null || otherOverrides ? { edited_by: who.by, edited_by_name: who.name, edited_at: now } : { edited_by: null, edited_by_name: null, edited_at: null });
      await updateRow(row.id, patch);
      break;
    }
    case "reset": {
      const t = findTarget(body.ref, calc, saved, sheet);
      if (!t?.saved || t.saved.kind !== "calc") return bad("Only calculated lines can be reset.");
      await updateRow(t.saved.id, { name: null, quantity: null, size: null, detail: null, base: null, edited_by: null, edited_by_name: null, edited_at: null });
      break;
    }
    case "keep": {
      // Keep my hand edit: the new calculated value is acknowledged, the edit stays.
      const t = findTarget(body.ref, calc, saved, sheet);
      if (!t?.saved) return bad("Nothing to keep.");
      if (t.calc) {
        await updateRow(t.saved.id, { base: calcFields(t.calc) });
      } else if (t.line) {
        // No longer calculated: it stays on this sheet as a line of our own.
        const f = t.line.fields;
        await updateRow(t.saved.id, { kind: "added", line_key: null, name: f.name, quantity: f.quantity, size: f.size, detail: f.detail, base: null });
      }
      break;
    }
    case "use_new": {
      const t = findTarget(body.ref, calc, saved, sheet);
      if (!t?.saved) return bad("Nothing to change.");
      if (t.calc) await updateRow(t.saved.id, { name: null, quantity: null, size: null, detail: null, base: null, edited_by: null, edited_by_name: null, edited_at: null });
      else await supabase.from("order_sheet_lines").delete().eq("id", t.saved.id);
      break;
    }
    case "add": {
      if (!isSection(body.section)) return bad("Pick a section.");
      const name = text(body.name);
      if (!name) return bad("A line needs an item name.");
      const row = await insertRow({
        session_id: session.id,
        line_key: null,
        section: body.section,
        kind: "added",
        name,
        quantity: text(body.quantity),
        size: text(body.size),
        detail: text(body.detail),
        edited_by: who.by,
        edited_by_name: who.name,
        edited_at: now,
      });
      if (!row) return bad("Could not save. Try again.", 500);
      break;
    }
    case "remove": {
      const t = findTarget(body.ref, calc, saved, sheet);
      if (!t) return bad("That line is no longer on the sheet. Reload the page.", 404);
      if (t.saved?.kind === "added") {
        await supabase.from("order_sheet_lines").delete().eq("id", t.saved.id);
        break;
      }
      const row = await rowFor(session.id, t);
      if (!row) return bad("Could not save. Try again.", 500);
      await updateRow(row.id, { removed: true, edited_by: who.by, edited_by_name: who.name, edited_at: now });
      break;
    }
    case "restore": {
      const t = findTarget(body.ref, calc, saved, sheet);
      if (!t?.saved) return bad("Nothing to restore.");
      await updateRow(t.saved.id, { removed: false });
      break;
    }
    case "store": {
      const t = findTarget(body.ref, calc, saved, sheet);
      if (!t?.line) return bad("That line is no longer on the sheet. Reload the page.", 404);
      const store = body.store === null || body.store === "" ? null : body.store;
      if (store !== null && !isStore(store)) return bad("Pick a store from the list.");
      const row = await rowFor(session.id, t);
      if (!row) return bad("Could not save. Try again.", 500);
      await updateRow(row.id, storePatch(store, t.line.fields.name, who, now));
      break;
    }
    case "section_store": {
      if (!isSection(body.section)) return bad("Pick a section.");
      const store = body.store === null || body.store === "" ? null : body.store;
      if (store !== null && !isStore(store)) return bad("Pick a store from the list.");
      const lines = sheet.sections.find((s) => s.id === body.section)!.lines;
      for (const l of lines) {
        const t = findTarget(l.ref, calc, saved, sheet);
        if (!t) continue;
        const row = await rowFor(session.id, t);
        if (row) await updateRow(row.id, storePatch(store, l.fields.name, who, now));
      }
      break;
    }
    case "ordered": {
      const t = findTarget(body.ref, calc, saved, sheet);
      if (!t?.line) return bad("That line is no longer on the sheet. Reload the page.", 404);
      const on = body.on === true;
      const row = await rowFor(session.id, t);
      if (!row) return bad("Could not save. Try again.", 500);
      await updateRow(row.id, on ? { ordered: true, ordered_by: who.by, ordered_by_name: who.name, ordered_at: now } : { ordered: false, ordered_by: null, ordered_by_name: null, ordered_at: null });
      break;
    }
    case "note": {
      const note = String(body.note ?? "").trim().slice(0, 2000);
      const { error } = await supabase
        .from("order_sheet_meta")
        .upsert({ session_id: session.id, note, note_by: who.by, note_by_name: who.name, note_at: now, updated_at: now }, { onConflict: "session_id" });
      if (error) return bad("Could not save. Try again.", 500);
      break;
    }
    case "delivery": {
      const { error } = await supabase
        .from("order_sheet_meta")
        .upsert({ session_id: session.id, delivery_day_of: body.on === true, delivery_by_name: who.name, delivery_at: now, updated_at: now }, { onConflict: "session_id" });
      if (error) return bad("Could not save. Try again.", 500);
      break;
    }
    default:
      return bad("Unknown action.");
  }
  return { ok: true, view: await getSheetView(session) };
}

function storePatch(store: Store | null, name: string, who: { by: string; name: string }, now: string) {
  return store
    ? { store, store_item: itemKey(name), store_by: who.by, store_by_name: who.name, store_at: now }
    : { store: null, store_item: null, store_by: null, store_by_name: null, store_at: null };
}
