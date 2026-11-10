// Database side of the staff event page: access, the staff view, and checkbox
// state. Server only.

import { supabase } from "@/lib/supabase";
import type { EventUpdateRow, SessionRow } from "@/lib/event-updates";
import {
  buildStaffEventView,
  canOpenEvent,
  firstName,
  type AssignmentLike,
  type StaffEventView,
  type StaffMember,
} from "@/lib/team/event-view";
import { checklistFor, checklistKeys, type ResolvedGroup } from "@/lib/team/checklist-config";
import { allShopItems, buildStaffShopping, type StaffShopping } from "@/lib/team/shopping";
import { mergeChecks, type CheckRow, type CheckState, type ListName } from "@/lib/team/checks";

/** The staff member's assignment to an event. Null when there is none, or before the assignments table exists. */
export async function getAssignment(sessionId: string, staffId: string): Promise<AssignmentLike | null> {
  const { data, error } = await supabase
    .from("event_assignments")
    .select("status")
    .eq("session_id", sessionId)
    .eq("staff_id", staffId)
    .maybeSingle();
  if (error) return null;
  return (data as AssignmentLike | null) ?? null;
}

/** First names of everyone else assigned and not declined. Empty before the assignments table exists. */
async function teammates(sessionId: string, staffId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("event_assignments")
    .select("status, staff:staff_id (id, name)")
    .eq("session_id", sessionId)
    .neq("status", "declined");
  if (error || !data) return [];
  return data
    .map((r) => (Array.isArray(r.staff) ? r.staff[0] : r.staff) as { id: string; name: string } | null)
    .filter((s): s is { id: string; name: string } => !!s && s.id !== staffId)
    .map((s) => firstName(s.name))
    .filter(Boolean);
}

export async function getSubmittedSession(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error || !data) return null;
  const row = data as SessionRow;
  return row.status === "submitted" && row.event_data ? row : null;
}

async function latestUpdate(sessionId: string): Promise<EventUpdateRow | null> {
  const { data } = await supabase
    .from("event_updates")
    .select("changes, created_at, version, applied")
    .eq("session_id", sessionId)
    .eq("applied", true)
    .gt("version", 1)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as EventUpdateRow | null) ?? null;
}

export type EventAccess =
  | { ok: false; reason: "not_found" | "not_assigned" }
  | { ok: true; session: SessionRow };

export async function openEvent(sessionId: string, staff: StaffMember): Promise<EventAccess> {
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, reason: "not_found" };
  const assignment = staff.role === "admin" ? null : await getAssignment(sessionId, staff.id);
  return canOpenEvent(staff, assignment) ? { ok: true, session } : { ok: false, reason: "not_assigned" };
}

async function checkRows(staffId: string, sessionId: string, list: ListName): Promise<CheckRow[]> {
  const { data, error } = await supabase
    .from("staff_checks")
    .select("item_key, checked, quantity")
    .eq("staff_id", staffId)
    .eq("session_id", sessionId)
    .eq("list", list);
  if (error) throw new Error(`staff_checks lookup failed: ${error.message}`);
  return (data as CheckRow[]) ?? [];
}

export interface EventPageData {
  view: StaffEventView;
  checklist: ResolvedGroup[];
  checklistState: Record<string, CheckState>;
  shopping: StaffShopping;
  shoppingState: Record<string, CheckState>;
}

/**
 * Everything the event page renders. The first time a staff member opens the
 * shopping list, every item is saved unchecked with its quantity, so later
 * changes from client updates can be spotted.
 */
export async function eventPageData(session: SessionRow, staff: StaffMember): Promise<EventPageData> {
  const ed = session.event_data ?? {};
  const [mates, update] = await Promise.all([teammates(session.id, staff.id), latestUpdate(session.id)]);
  const view = buildStaffEventView(session, { teammates: mates, latestUpdate: update });

  const checklist = checklistFor(view.package);
  const shopping = buildStaffShopping(ed);
  const shopItems = allShopItems(shopping);

  const [checklistRows, initialShopRows] = await Promise.all([
    checkRows(staff.id, session.id, "checklist"),
    checkRows(staff.id, session.id, "shopping"),
  ]);
  let shopRows = initialShopRows;
  if (shopRows.length === 0 && shopItems.length > 0) {
    shopRows = shopItems.map((i) => ({ item_key: i.key, checked: false, quantity: i.quantity }));
    const { error } = await supabase.from("staff_checks").upsert(
      shopRows.map((r) => ({ ...r, staff_id: staff.id, session_id: session.id, list: "shopping" })),
      { onConflict: "staff_id,session_id,list,item_key", ignoreDuplicates: true }
    );
    if (error) console.error("staff_checks seed failed:", error.message);
  }

  return {
    view,
    checklist,
    checklistState: mergeChecks(
      checklistKeys(view.package).map((key) => ({ key, quantity: "" })),
      checklistRows,
      { trackChanges: false }
    ),
    shopping,
    shoppingState: mergeChecks(shopItems, shopRows, { trackChanges: true }),
  };
}

/**
 * Save one checkbox. The quantity is read from the current lists on the
 * server, so a checked item stays checked until its quantity changes.
 */
export async function saveCheck(
  session: SessionRow,
  staff: StaffMember,
  list: ListName,
  key: string,
  checked: boolean
): Promise<boolean> {
  const ed = session.event_data ?? {};
  let quantity = "";
  if (list === "checklist") {
    if (!checklistKeys(ed.package ?? session.package_type).includes(key)) return false;
  } else {
    const item = allShopItems(buildStaffShopping(ed)).find((i) => i.key === key);
    if (!item) return false;
    quantity = item.quantity;
  }
  const { error } = await supabase.from("staff_checks").upsert(
    { staff_id: staff.id, session_id: session.id, list, item_key: key, checked, quantity, updated_at: new Date().toISOString() },
    { onConflict: "staff_id,session_id,list,item_key" }
  );
  if (error) throw new Error(`staff_checks save failed: ${error.message}`);
  return true;
}

export async function activeAdmins(): Promise<StaffMember[]> {
  const { data, error } = await supabase.from("staff").select("id, name, phone, role, active").eq("role", "admin").eq("active", true);
  if (error) {
    console.error("admin lookup failed:", error.message);
    return [];
  }
  return (data as StaffMember[]) ?? [];
}
