// The Syrup recipes library (syrup_recipes), admins and managers only. Admins
// add, edit, and remove recipes; the Shopping list and the bartender Supplies
// tab read them (lib/syrups.ts). Before the table exists the library is empty,
// so every syrup shows "Recipe needed". Server only.

import { supabase } from "@/lib/supabase";
import { cleanSyrupRecipe, normalName, type SyrupIngredient, type SyrupRecipe } from "@/lib/syrups";

interface SyrupRow {
  id: string;
  name: string;
  aliases: string[] | null;
  ingredients: SyrupIngredient[] | null;
  ratio: string | null;
  method: string | null;
  yield_amount: number | string | null;
  yield_unit: string | null;
  shelf_life: string | null;
  bought: boolean | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

const toRecipe = (r: SyrupRow): SyrupRecipe => ({
  id: r.id,
  name: r.name,
  aliases: Array.isArray(r.aliases) ? r.aliases : [],
  ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
  ratio: r.ratio ?? "",
  method: r.method ?? "",
  yieldAmount: r.yield_amount === null || r.yield_amount === undefined || r.yield_amount === "" ? null : Number(r.yield_amount),
  yieldUnit: r.yield_unit ?? "",
  shelfLife: r.shelf_life ?? "",
  bought: r.bought === true,
  updatedBy: r.updated_by_name ?? null,
  updatedAt: r.updated_at ?? null,
});

/** Every recipe, by name. Empty when the table is missing or the read fails. */
export async function listSyrups(): Promise<SyrupRecipe[]> {
  const { data, error } = await supabase.from("syrup_recipes").select("*");
  if (error) {
    console.error("[syrups] could not read the library:", error.message);
    return [];
  }
  return ((data as SyrupRow[]) ?? []).map(toRecipe).sort((a, b) => a.name.localeCompare(b.name));
}

export type SyrupResult = { ok: true; syrups: SyrupRecipe[] } | { ok: false; error: string; status: number };

const bad = (error: string, status = 400): SyrupResult => ({ ok: false, error, status });

/** A name or alias another recipe already answers to, so one ingredient never matches two recipes. */
function taken(all: SyrupRecipe[], self: string | null, words: string[]): string | null {
  const mine = new Set(words.map(normalName));
  for (const r of all) {
    if (r.id === self) continue;
    const hit = [r.name, ...r.aliases].find((w) => mine.has(normalName(w)));
    if (hit) return `${r.name} already uses the name ${hit}.`;
  }
  return null;
}

/** Add a recipe (no id) or save changes to one. */
export async function saveSyrup(actor: { id: string; name: string }, raw: Record<string, unknown>): Promise<SyrupResult> {
  const clean = cleanSyrupRecipe(raw);
  if (!clean.ok) return bad(clean.error);
  const v = clean.value;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const all = await listSyrups();
  if (id && !all.some((r) => r.id === id)) return bad("That recipe is gone. Reload the page.", 404);
  const clash = taken(all, id, [v.name, ...v.aliases]);
  if (clash) return bad(clash, 409);
  const row = {
    name: v.name,
    aliases: v.aliases,
    ingredients: v.ingredients,
    ratio: v.ratio,
    method: v.method,
    yield_amount: v.yieldAmount,
    yield_unit: v.yieldUnit,
    shelf_life: v.shelfLife,
    bought: v.bought,
    updated_by: actor.id,
    updated_by_name: actor.name,
    updated_at: new Date().toISOString(),
  };
  const { error } = id ? await supabase.from("syrup_recipes").update(row).eq("id", id) : await supabase.from("syrup_recipes").insert(row);
  if (error) return bad(/duplicate|unique/i.test(error.message) ? "A recipe with that name already exists." : "Could not save. Try again.", /duplicate|unique/i.test(error.message) ? 409 : 500);
  return { ok: true, syrups: await listSyrups() };
}

/** Remove a recipe. An event that edited it for itself keeps nothing: with no library recipe it shows Recipe needed. */
export async function deleteSyrup(id: unknown): Promise<SyrupResult> {
  if (typeof id !== "string" || !id) return bad("Pick a recipe.");
  const { error } = await supabase.from("syrup_recipes").delete().eq("id", id);
  if (error) return bad("Could not remove it. Try again.", 500);
  return { ok: true, syrups: await listSyrups() };
}
