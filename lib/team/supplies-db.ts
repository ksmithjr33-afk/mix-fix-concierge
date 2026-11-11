// Database side of the bartender Supplies tab. Server only.
//
// The list is read from the admin Shopping list (staffSheet), so it always
// matches it. What a bartender last saw is kept in staff_supply_views, for the
// "Updated" note. Admin edits inside 48 hours of the event text assigned staff
// once the edits settle (sendSupplyNotices, from the 5 minute cron).

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { settledStaffListChanges, staffSheet } from "@/lib/order-sheet-db";
import type { SheetRecipe } from "@/lib/order-sheet";
import { updateText } from "@/lib/team/assignments";
import { sendStaffText } from "@/lib/team/sms";
import { eventDay, shortDate } from "@/lib/team/time";
import { siteOrigin } from "@/lib/team/clock-db";
import { seenItems, suppliesFromSheet, supplyChanges, suppliesTextLine, type SeenItem, type Supplies } from "@/lib/team/supplies";

type SessionLike = Pick<SessionRow, "id" | "event_date" | "event_data">;

export async function staffSupplies(session: SessionLike): Promise<{ list: Supplies; recipes: SheetRecipe[] }> {
  const { sheet, recipes } = await staffSheet(session);
  return { list: suppliesFromSheet(sheet), recipes };
}

async function seenRow(staffId: string, sessionId: string): Promise<SeenItem[] | null> {
  const { data, error } = await supabase.from("staff_supply_views").select("items").eq("staff_id", staffId).eq("session_id", sessionId).maybeSingle();
  if (error || !data) return null;
  return Array.isArray(data.items) ? (data.items as SeenItem[]) : null;
}

/** Save the list as this bartender sees it now. */
export async function markSuppliesSeen(staffId: string, sessionId: string, list: Supplies): Promise<void> {
  const { error } = await supabase
    .from("staff_supply_views")
    .upsert({ staff_id: staffId, session_id: sessionId, items: seenItems(list), seen_at: new Date().toISOString() }, { onConflict: "staff_id,session_id" });
  if (error) console.error("staff_supply_views save failed:", error.message);
}

/**
 * What changed since this bartender last looked. The first time they open the
 * list it is saved as seen, with no note. After that the note stays until they
 * tap Got it.
 */
export async function supplyUpdates(staffId: string, sessionId: string, list: Supplies): Promise<string[]> {
  const before = await seenRow(staffId, sessionId);
  if (!before) {
    await markSuppliesSeen(staffId, sessionId, list);
    return [];
  }
  return supplyChanges(before, seenItems(list));
}

export const SETTLE_MS = 5 * 60_000; // edits a few minutes apart go out as one text

/**
 * One text to each assigned staff member when an admin changed their supplies
 * list inside 48 hours of the event: the usual update text, with what changed.
 * Returns texts sent.
 */
export async function sendSupplyNotices(now: Date = new Date()): Promise<number> {
  const due = await settledStaffListChanges(now, SETTLE_MS);
  let sent = 0;
  for (const d of due) {
    const { data: session } = await supabase.from("sessions").select("id, event_date, event_data").eq("id", d.sessionId).maybeSingle();
    if (!session) continue;
    const { data } = await supabase.from("event_assignments").select("status, staff:staff_id (name, phone, active)").eq("session_id", d.sessionId).neq("status", "declined");
    const people = ((data ?? []) as { staff: unknown }[])
      .map((r) => (Array.isArray(r.staff) ? r.staff[0] : r.staff) as { name: string; phone: string; active: boolean } | null)
      .filter((s): s is { name: string; phone: string; active: boolean } => !!s && s.active);
    const ed = (session.event_data ?? {}) as Record<string, unknown>;
    const message = updateText({ date: shortDate(eventDay(ed.event_date ?? session.event_date)), link: `${siteOrigin()}/team/e/${d.sessionId}`, supplies: suppliesTextLine(d.changes) });
    for (const p of people) if (await sendStaffText(p.phone, p.name, message)) sent++;
  }
  return sent;
}
