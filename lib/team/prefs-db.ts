// Each person's remembered calendar choices (view, market filter, layout). Server only.

import { supabase } from "@/lib/supabase";
import { MARKETS } from "@/lib/team/markets";
import { cleanPrefs, DEFAULT_PREFS, type CalPrefs } from "@/lib/team/calendar";

export async function getPrefs(staffId: string): Promise<CalPrefs> {
  const { data, error } = await supabase.from("staff_prefs").select("calendar").eq("staff_id", staffId).maybeSingle();
  if (error || !data) return { ...DEFAULT_PREFS }; // before the table exists, or nothing saved yet
  return cleanPrefs((data as { calendar: unknown }).calendar, MARKETS);
}

/** Merge a change into the saved choices. Never throws: a failed save only loses the memory. */
export async function savePrefs(staffId: string, patch: Partial<CalPrefs>, current?: CalPrefs): Promise<CalPrefs> {
  const base = current ?? (await getPrefs(staffId));
  const next = cleanPrefs({ ...base, ...patch }, MARKETS);
  const { error } = await supabase.from("staff_prefs").upsert({ staff_id: staffId, calendar: next, updated_at: new Date().toISOString() }, { onConflict: "staff_id" });
  if (error) console.error("[team] saving calendar choices failed:", error.message);
  return next;
}
