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
import { alertRecipients } from "@/lib/team/assignments";
import { checklistFor, checklistKeys, type ResolvedGroup } from "@/lib/team/checklist-config";
import { allShopItems, buildStaffShopping, type StaffShopping } from "@/lib/team/shopping";
import { activeConfirmation, canConfirm, clearsConfirmation, mergeChecks, progress, type CheckRow, type CheckState, type ListName } from "@/lib/team/checks";

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
  confirmedAt: string | null;
  shopping: StaffShopping;
  shoppingState: Record<string, CheckState>;
}

function checklistState(pkg: unknown, rows: CheckRow[]): Record<string, CheckState> {
  return mergeChecks(checklistKeys(pkg).map((key) => ({ key, quantity: "" })), rows, { trackChanges: false });
}

export async function getConfirmation(staffId: string, sessionId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("staff_confirmations")
    .select("confirmed_at")
    .eq("staff_id", staffId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) return null; // before the table exists
  return (data?.confirmed_at as string | undefined) ?? null;
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

  const [checklistRows, initialShopRows, confirmedAt] = await Promise.all([
    checkRows(staff.id, session.id, "checklist"),
    checkRows(staff.id, session.id, "shopping"),
    getConfirmation(staff.id, session.id),
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

  const clState = checklistState(view.package, checklistRows);
  return {
    view,
    checklist,
    checklistState: clState,
    confirmedAt: activeConfirmation(confirmedAt, clState),
    shopping,
    shoppingState: mergeChecks(shopItems, shopRows, { trackChanges: true }),
  };
}

/** How many checklist and shopping items this staff member has checked right now. */
export async function checkSnapshot(session: SessionRow, staff: StaffMember) {
  const ed = session.event_data ?? {};
  const [clRows, shopRows] = await Promise.all([
    checkRows(staff.id, session.id, "checklist"),
    checkRows(staff.id, session.id, "shopping"),
  ]);
  const cl = progress(checklistState(ed.package ?? session.package_type, clRows));
  const sh = progress(mergeChecks(allShopItems(buildStaffShopping(ed)), shopRows, { trackChanges: true }));
  return { checklistChecked: cl.checked, checklistTotal: cl.total, shoppingChecked: sh.checked, shoppingTotal: sh.total };
}

/** "I have everything": saved only when every checklist box is checked. Returns the confirmed time, or null. */
export async function confirmChecklist(session: SessionRow, staff: StaffMember): Promise<string | null> {
  const ed = session.event_data ?? {};
  const state = checklistState(ed.package ?? session.package_type, await checkRows(staff.id, session.id, "checklist"));
  if (!canConfirm(state)) return null;
  const confirmedAt = new Date().toISOString();
  const { error } = await supabase
    .from("staff_confirmations")
    .upsert({ staff_id: staff.id, session_id: session.id, confirmed_at: confirmedAt }, { onConflict: "staff_id,session_id" });
  if (error) throw new Error(`staff_confirmations save failed: ${error.message}`);
  return confirmedAt;
}

async function clearConfirmation(staffId: string, sessionId: string): Promise<void> {
  const { error } = await supabase.from("staff_confirmations").delete().eq("staff_id", staffId).eq("session_id", sessionId);
  if (error) console.error("staff_confirmations clear failed:", error.message);
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
  if (clearsConfirmation(list, checked)) await clearConfirmation(staff.id, session.id);
  return true;
}

/**
 * Admins who get alert texts (declines, missing items, bar ready): active
 * admins with alerts on. Alerts count as on until the column exists.
 */
export async function alertAdmins(): Promise<StaffMember[]> {
  const { data, error } = await supabase.from("staff").select("*").eq("role", "admin").eq("active", true);
  if (error) {
    console.error("admin lookup failed:", error.message);
    return [];
  }
  return alertRecipients((data as (StaffMember & { alerts?: boolean | null })[]) ?? []);
}

/** Keep a record of "Something is missing" reports, so the bar ready text can mention them. Never throws. */
export async function recordMissing(sessionId: string, staffId: string, items: string[], note: string): Promise<void> {
  const { error } = await supabase.from("missing_reports").insert({ session_id: sessionId, staff_id: staffId, items, note });
  if (error) console.error("missing_reports insert failed:", error.message);
}

export async function hasMissingReports(sessionId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("missing_reports")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) return false;
  return (count ?? 0) > 0;
}

/** The event details for the admin manager view: everyone on the event as "Also working", and what the last update changed. */
export async function managerEventView(session: SessionRow) {
  const [mates, update] = await Promise.all([teammates(session.id, ""), latestUpdate(session.id)]);
  return buildStaffEventView(session, { teammates: mates, latestUpdate: update });
}

export interface MissingReport {
  id: string;
  staffFirstName: string;
  items: string[];
  note: string;
  createdAt: string;
}

/** Every "Something is missing" report for the event, newest first. Admins only. */
export async function missingReports(sessionId: string): Promise<MissingReport[]> {
  const { data, error } = await supabase.from("missing_reports").select("*").eq("session_id", sessionId).order("created_at", { ascending: false });
  if (error || !data) return [];
  const rows = data as { id: string; staff_id: string; items: unknown; note: string | null; created_at: string }[];
  const ids = [...new Set(rows.map((r) => r.staff_id))];
  const { data: staff } = ids.length ? await supabase.from("staff").select("id, name").in("id", ids) : { data: [] };
  const names = new Map(((staff as { id: string; name: string }[]) ?? []).map((s) => [s.id, firstName(s.name)]));
  return rows.map((r) => ({
    id: r.id,
    staffFirstName: names.get(r.staff_id) || "A bartender",
    items: Array.isArray(r.items) ? r.items.map(String) : [],
    note: r.note ?? "",
    createdAt: r.created_at,
  }));
}
