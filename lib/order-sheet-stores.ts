// The team's store list for order sheets (order_sheet_stores): the five
// starting stores and any an admin adds. Admins rename, recolor, reorder, and
// retire stores. A retired store stays on old sheets that used it but is not
// offered on new lines. No two stores ever share a color (also a unique index
// in the database). Server only, admins only.

import { supabase } from "@/lib/supabase";
import { DEFAULT_STORES, inPalette, normalColor, type Store, type StoreInfo } from "@/lib/order-sheet-shared";

interface StoreRow {
  id: string;
  name: string;
  color: string;
  position: number;
  retired: boolean;
  last_legend_name: string | null;
}

const toInfo = (r: StoreRow): StoreInfo => ({
  id: r.id,
  name: r.name,
  color: String(r.color).toUpperCase(),
  position: Number(r.position) || 0,
  retired: r.retired === true,
  lastLegendName: r.last_legend_name ?? "",
});

const defaultRow = (s: StoreInfo) => ({ id: s.id, name: s.name, color: s.color, position: s.position, retired: false, last_legend_name: null });

/**
 * Every store, retired ones too, in list order. An empty table gets the five
 * starting stores (the migration adds them too). Before the table exists, the
 * starting five are used as they are.
 */
export async function listStores(): Promise<StoreInfo[]> {
  const { data, error } = await supabase.from("order_sheet_stores").select("*").order("position", { ascending: true });
  if (error) return DEFAULT_STORES;
  const rows = (data as StoreRow[]) ?? [];
  if (rows.length === 0) {
    await supabase.from("order_sheet_stores").upsert(DEFAULT_STORES.map(defaultRow), { onConflict: "id", ignoreDuplicates: true });
    return DEFAULT_STORES;
  }
  return rows.map(toInfo).sort((a, b) => a.position - b.position);
}

export type StoreResult = { ok: true; stores: StoreInfo[]; store?: StoreInfo } | { ok: false; error: string; status: number };

const bad = (error: string, status = 400): StoreResult => ({ ok: false, error, status });
const cleanName = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

function colorProblem(color: string | null, stores: StoreInfo[], self?: Store): string | null {
  if (!color || !inPalette(color)) return "Pick a color from the palette.";
  const taken = stores.find((s) => s.id !== self && s.color === color);
  if (taken) return `${taken.name}${taken.retired ? " (retired)" : ""} already uses that color. Pick another.`;
  return null;
}

function nameProblem(name: string, stores: StoreInfo[], self?: Store): string | null {
  if (!name) return "Give the store a name.";
  const taken = stores.find((s) => s.id !== self && !s.retired && s.name.toLowerCase() === name.toLowerCase());
  return taken ? "There is already a store with that name." : null;
}

/** A refusal from the database, as the admin should read it. */
function dbProblem(message: string): string {
  if (/color/i.test(message) && /duplicate|unique/i.test(message)) return "Another store already uses that color. Pick another.";
  if (/duplicate|unique/i.test(message)) return "There is already a store with that name.";
  return "Could not save. Try again.";
}

export async function addStore(raw: { name?: unknown; color?: unknown }): Promise<StoreResult> {
  const stores = await listStores();
  const name = cleanName(raw.name);
  const color = normalColor(raw.color);
  const problem = nameProblem(name, stores) ?? colorProblem(color, stores);
  if (problem) return bad(problem);
  const position = Math.max(0, ...stores.map((s) => s.position)) + 1;
  const { data, error } = await supabase
    .from("order_sheet_stores")
    .insert({ name, color, position, retired: false, updated_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error || !data) return bad(dbProblem(error?.message ?? ""), error && /duplicate|unique/i.test(error.message) ? 409 : 500);
  return { ok: true, stores: await listStores(), store: toInfo(data as StoreRow) };
}

/** Rename, recolor, retire, or bring back one store. */
export async function updateStore(id: unknown, raw: { name?: unknown; color?: unknown; retired?: unknown }): Promise<StoreResult> {
  const stores = await listStores();
  const store = stores.find((s) => s.id === id);
  if (!store) return bad("We could not find that store.", 404);
  const patch: Record<string, unknown> = {};
  if (raw.name !== undefined) {
    const name = cleanName(raw.name);
    const problem = nameProblem(name, stores, store.id);
    if (problem) return bad(problem);
    patch.name = name;
  }
  if (raw.color !== undefined) {
    const color = normalColor(raw.color);
    const problem = colorProblem(color, stores, store.id);
    if (problem) return bad(problem);
    patch.color = color;
  }
  if (raw.retired !== undefined) {
    const retired = raw.retired === true;
    if (!retired) {
      const problem = nameProblem(store.name, stores, store.id);
      if (problem) return bad(`${problem} Rename one of them first.`);
    }
    patch.retired = retired;
  }
  if (Object.keys(patch).length === 0) return bad("Nothing to change.");
  const { error } = await supabase.from("order_sheet_stores").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", store.id);
  if (error) return bad(dbProblem(error.message), /duplicate|unique/i.test(error.message) ? 409 : 500);
  return { ok: true, stores: await listStores() };
}

/** Move a store up or down the list. */
export async function moveStore(id: unknown, direction: unknown): Promise<StoreResult> {
  const stores = await listStores();
  const at = stores.findIndex((s) => s.id === id);
  if (at < 0) return bad("We could not find that store.", 404);
  // The next store up or down among the active ones (or the retired ones, for a retired store).
  const step = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  if (!step) return bad("Move up or down.");
  let to = at + step;
  while (to >= 0 && to < stores.length && stores[to].retired !== stores[at].retired) to += step;
  if (to < 0 || to >= stores.length) return { ok: true, stores };
  const next = [...stores];
  [next[at], next[to]] = [next[to], next[at]];
  const now = new Date().toISOString();
  for (const [i, s] of next.entries()) {
    if (s.position !== i + 1) await supabase.from("order_sheet_stores").update({ position: i + 1, updated_at: now }).eq("id", s.id);
  }
  return { ok: true, stores: await listStores() };
}

/** The legend name used on an event becomes the default for the next one. */
export async function rememberLegendName(id: Store, name: string): Promise<void> {
  if (!name) return;
  await supabase.from("order_sheet_stores").update({ last_legend_name: name, updated_at: new Date().toISOString() }).eq("id", id);
}
