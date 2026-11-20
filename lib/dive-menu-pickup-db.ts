// Keeps a Dive Bar event's menu pickup in step with its menu card. Server only.
//
// Dive Bar has no printed menu unless the client asked for a menu card, so a
// Dive Bar event with no card is "No printed menu for this event" and one with
// a card needs its menu picked up like any other event. Called after the final
// save, after an update applies, and when an admin adds an event by hand.
// Other packages are left to the admin, except that an event leaving Dive Bar
// for a package with a printed menu turns "No printed menu" back off.

import { supabase } from "@/lib/supabase";
import { diveNoPrintedMenu, isDiveBarPackage } from "@/lib/dive-menu";
import { packageDrinkCount } from "@/lib/event-diff";

export async function syncDiveMenuPickup(
  sessionId: string,
  ed: Record<string, unknown>,
  opts: { previousPackage?: unknown; now?: Date } = {}
): Promise<void> {
  const leftDive = isDiveBarPackage(opts.previousPackage) && !isDiveBarPackage(ed.package) && packageDrinkCount(ed.package) > 0;
  const want = leftDive ? false : diveNoPrintedMenu(ed);
  if (want === null) return;
  const now = opts.now ?? new Date();
  try {
    const { data, error } = await supabase.from("event_menu_pickups").select("session_id, not_needed").eq("session_id", sessionId).maybeSingle();
    if (error) return; // before the table exists
    const row = data as { not_needed: boolean } | null;
    const nowIso = now.toISOString();
    if (want && !row?.not_needed) {
      const { error: e } = await supabase
        .from("event_menu_pickups")
        .upsert({ session_id: sessionId, not_needed: true, updated_at: nowIso }, { onConflict: "session_id" });
      if (e) throw new Error(e.message);
    } else if (!want && row?.not_needed) {
      const { error: e } = await supabase.from("event_menu_pickups").update({ not_needed: false, updated_at: nowIso }).eq("session_id", sessionId);
      if (e) throw new Error(e.message);
    } else {
      return;
    }
    await supabase.from("event_menu_pickup_log").insert({
      session_id: sessionId,
      action: want ? "not_needed" : "needed",
      detail: want ? "Dive Bar with no menu card" : leftDive ? "No longer Dive Bar" : "Dive Bar menu card",
      by_id: null,
      by_name: "Concierge",
      created_at: nowIso,
    });
  } catch (err) {
    console.error(`[dive menu pickup] ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
