// Database side of the approved menu. Server only.
//
// Files live in the private event-menus bucket. Every page links to them
// through our own routes, which check who is asking and then hand out a 10
// minute signed link, so a link copied out of a page stops working.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { eventData } from "@/lib/team/markets";
import { eventSchedule, todayIn } from "@/lib/team/time";
import { getAssignment, getSubmittedSession } from "@/lib/team/events";
import { getPickup, pickupsFor } from "@/lib/team/menu-pickup-db";
import { pickedUpLine, pickupStamp, pickupState, storeName, type PickupState } from "@/lib/team/menu-pickup";
import { confirmUpload, shortLink, signedUploadUrl } from "@/lib/team/direct-upload";
import {
  canSeeMenu,
  cleanApprovedOn,
  downloadName,
  menuExtension,
  menuFileError,
  menuMissing,
  menuPath,
  MENU_FILE_TYPES,
  MENU_HISTORY,
  MENU_LINK_SECONDS,
  MENU_MAX_BYTES,
  typeLabel,
  type MenuFileRow,
} from "@/lib/team/approved-menu";

export const MENU_BUCKET = "event-menus";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export interface MenuFileView {
  id: string;
  type: string; // "application/pdf" | "image/png" | "image/jpeg"
  typeLabel: string; // "PDF"
  fileName: string;
  uploadedBy: string;
  uploadedAt: string; // "Nov 12, 3:40 PM"
  approvedOn: string; // YYYY-MM-DD
}

export interface AdminMenuView {
  sessionId: string;
  current: MenuFileView | null;
  history: MenuFileView[];
  missing: boolean; // inside 72 hours and nothing uploaded
}

/** The bartender's read only menu section on the event's Details tab. */
export interface StaffMenuSection {
  sessionId: string;
  file: { type: string; typeLabel: string; viewHref: string; downloadHref: string } | null;
  notNeeded: boolean;
  store: string;
  pickupPerson: string; // first name, "" when nobody is assigned
  state: PickupState;
  pickedUpLine: string; // "Picked up by Taylor, Nov 12, 3:40 PM"
  isPickupPerson: boolean; // the viewer is picking it up: they keep the "I picked it up" button
}

export const staffFileHref = (sessionId: string, download = false) => `/api/team/menu-file?sessionId=${encodeURIComponent(sessionId)}${download ? "&download=1" : ""}`;
export const clientFileHref = (sessionId: string, download = false) => `/api/menu?id=${encodeURIComponent(sessionId)}${download ? "&download=1" : ""}`;

async function rows(sessionId: string): Promise<MenuFileRow[]> {
  const { data, error } = await supabase.from("event_menu_files").select("*").eq("session_id", sessionId).order("created_at", { ascending: false });
  if (error || !data) return []; // before the table exists
  return data as MenuFileRow[];
}

export async function currentMenu(sessionId: string): Promise<MenuFileRow | null> {
  return (await rows(sessionId)).find((r) => r.status === "current") ?? null;
}

/** The events (of these) that have an approved menu uploaded. */
export async function sessionsWithMenu(sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();
  const { data, error } = await supabase.from("event_menu_files").select("session_id, status").in("session_id", sessionIds).eq("status", "current");
  if (error || !data) return new Set();
  return new Set((data as { session_id: string }[]).map((r) => r.session_id));
}

/** Events inside 72 hours with no approved menu, for the admin events list marker. */
export async function menuMissingIds(sessions: SessionRow[], now: Date = new Date()): Promise<Set<string>> {
  const ids = sessions.map((s) => s.id);
  const [have, pickups] = await Promise.all([sessionsWithMenu(ids), pickupsFor(ids)]);
  return new Set(sessions.filter((s) => menuMissing(have.has(s.id), !!pickups.get(s.id)?.not_needed, eventData(s), now)).map((s) => s.id));
}

function fileView(r: MenuFileRow, tz: string): MenuFileView {
  return {
    id: r.id,
    type: r.file_type,
    typeLabel: typeLabel(r.file_type),
    fileName: r.file_name ?? "",
    uploadedBy: r.uploaded_by_name ?? "an admin",
    uploadedAt: pickupStamp(r.created_at, tz),
    approvedOn: r.client_approved_on ?? "",
  };
}

export async function adminMenuView(session: SessionRow, now: Date = new Date()): Promise<AdminMenuView> {
  const all = await rows(session.id);
  const ed = eventData(session);
  const tz = eventSchedule(ed).tz;
  const current = all.find((r) => r.status === "current") ?? null;
  const pickup = await getPickup(session.id);
  return {
    sessionId: session.id,
    current: current ? fileView(current, tz) : null,
    history: all.filter((r) => r.status === "replaced").slice(0, MENU_HISTORY).map((r) => fileView(r, tz)),
    missing: menuMissing(!!current, !!pickup?.not_needed, ed, now),
  };
}

/**
 * Admin, step 1: check the file the browser is about to send and hand back a
 * one time upload link. The file waits as "pending" until step 2.
 */
export async function startMenuUpload(
  admin: StaffMember,
  sessionId: string,
  file: { type: string; size: number; name?: string },
  now: Date = new Date()
): Promise<Result<{ id: string; uploadUrl: string }>> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const bad = menuFileError(file);
  if (bad) return { ok: false, error: bad, status: 400 };
  const type = file.type.toLowerCase();
  const path = menuPath(sessionId, now, menuExtension(type));
  const uploadUrl = await signedUploadUrl(MENU_BUCKET, path);
  if (!uploadUrl) return { ok: false, error: "Could not start the upload. Try again.", status: 500 };
  const { data, error } = await supabase
    .from("event_menu_files")
    .insert({
      session_id: sessionId,
      file_path: path,
      file_type: type,
      file_name: String(file.name ?? "").slice(0, 200) || null,
      size_bytes: Math.round(file.size),
      status: "pending",
      uploaded_by: admin.id,
      uploaded_by_name: firstName(admin.name) || admin.name,
      created_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not start the upload. Try again.", status: 500 };
  return { ok: true, id: (data as { id: string }).id, uploadUrl };
}

/**
 * Admin, step 2: the file is in storage. Check it really is a PDF, PNG or JPG
 * under 15 MB, record the client approval date, and make it the current menu.
 * The one it replaces goes to the history.
 */
export async function finishMenuUpload(admin: StaffMember, fileId: string, approvedOn: unknown, now: Date = new Date()): Promise<Result<{ view: AdminMenuView }>> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const { data } = await supabase.from("event_menu_files").select("*").eq("id", fileId).maybeSingle();
  const row = data as MenuFileRow | null;
  if (!row || row.status !== "pending") return { ok: false, error: "We could not find that upload. Try again.", status: 404 };
  const session = await getSubmittedSession(row.session_id);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const approved = cleanApprovedOn(approvedOn, todayIn(eventSchedule(eventData(session)).tz, now));
  if (!approved.ok) return { ok: false, error: approved.error, status: 400 };
  const stored = await confirmUpload(MENU_BUCKET, row.file_path, { types: MENU_FILE_TYPES, maxBytes: MENU_MAX_BYTES });
  if (!stored.ok) {
    await supabase.from("event_menu_files").delete().eq("id", fileId).eq("status", "pending");
    return { ok: false, error: stored.error, status: 400 };
  }
  await supabase.from("event_menu_files").update({ status: "replaced", replaced_at: now.toISOString() }).eq("session_id", row.session_id).eq("status", "current");
  const { error } = await supabase
    .from("event_menu_files")
    .update({ status: "current", client_approved_on: approved.value, size_bytes: stored.size, file_type: stored.type })
    .eq("id", fileId)
    .eq("status", "pending");
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, view: await adminMenuView(session, now) };
}

/** Admin: change the "Client approved on" date of the current menu. */
export async function setApprovedOn(admin: StaffMember, sessionId: string, approvedOn: unknown, now: Date = new Date()): Promise<Result<{ view: AdminMenuView }>> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const cur = await currentMenu(sessionId);
  if (!cur) return { ok: false, error: "Upload the approved menu first.", status: 400 };
  const approved = cleanApprovedOn(approvedOn, todayIn(eventSchedule(eventData(session)).tz, now));
  if (!approved.ok) return { ok: false, error: approved.error, status: 400 };
  await supabase.from("event_menu_files").update({ client_approved_on: approved.value }).eq("id", cur.id);
  return { ok: true, view: await adminMenuView(session, now) };
}

/** Whether this staff member may open the event's approved menu. */
export async function staffCanSeeMenu(viewer: StaffMember, sessionId: string): Promise<boolean> {
  if (!viewer.active) return false;
  if (viewer.role === "admin") return true;
  const [assignment, pickup] = await Promise.all([getAssignment(sessionId, viewer.id), getPickup(sessionId)]);
  const isPickupPerson = !!pickup && !pickup.not_needed && pickup.assignee_id === viewer.id;
  return canSeeMenu(viewer, assignment?.status ?? null, isPickupPerson);
}

/**
 * A 10 minute link to the menu for a staff member, or null when they may not
 * see it. Admins can open a replaced one from the history by id; everyone
 * else only gets the current one.
 */
export async function staffMenuLink(viewer: StaffMember, sessionId: string, opts: { download?: boolean; fileId?: string } = {}): Promise<string | null> {
  const session = await getSubmittedSession(sessionId);
  if (!session || !(await staffCanSeeMenu(viewer, sessionId))) return null;
  const all = await rows(sessionId);
  const file = opts.fileId && viewer.role === "admin" ? all.find((r) => r.id === opts.fileId && r.status !== "pending") : all.find((r) => r.status === "current");
  if (!file) return null;
  return shortLink(MENU_BUCKET, file.file_path, MENU_LINK_SECONDS, opts.download ? downloadName(eventTitle(eventData(session)), file.file_type) : undefined);
}

/**
 * The client's own event page: their link (/s?id=) is how they reach it, so
 * the session id is their key. Only a submitted event's current menu.
 */
export async function clientMenuLink(sessionId: string, download = false): Promise<string | null> {
  const session = await getSubmittedSession(sessionId);
  if (!session) return null;
  const file = await currentMenu(sessionId);
  if (!file) return null;
  return shortLink(MENU_BUCKET, file.file_path, MENU_LINK_SECONDS, download ? downloadName(eventTitle(eventData(session)), file.file_type) : undefined);
}

/** What the client's page shows under "Your menu". Null when nothing is uploaded. */
export async function clientMenu(sessionId: string): Promise<{ type: string; typeLabel: string; viewHref: string; downloadHref: string } | null> {
  const file = await currentMenu(sessionId);
  if (!file) return null;
  return { type: file.file_type, typeLabel: typeLabel(file.file_type), viewHref: clientFileHref(sessionId), downloadHref: clientFileHref(sessionId, true) };
}

/**
 * The menu section on a bartender's event page: the approved menu, where it
 * is printed, who is picking it up, and whether it has been. Null for anyone
 * not on the event (the page itself also refuses them).
 */
export async function staffMenuSection(session: SessionRow, viewer: StaffMember): Promise<StaffMenuSection | null> {
  if (!viewer.active) return null;
  const [assignment, pickup, file] = await Promise.all([viewer.role === "admin" ? null : getAssignment(session.id, viewer.id), getPickup(session.id), currentMenu(session.id)]);
  const onEvent = viewer.role === "admin" || (!!assignment && assignment.status !== "declined");
  if (!onEvent) return null;
  let pickupPerson = "";
  if (pickup?.assignee_id) {
    const { data } = await supabase.from("staff").select("name").eq("id", pickup.assignee_id).maybeSingle();
    const name = (data as { name: string } | null)?.name ?? "";
    pickupPerson = firstName(name) || name;
  }
  const tz = eventSchedule(eventData(session)).tz;
  return {
    sessionId: session.id,
    file: file ? { type: file.file_type, typeLabel: typeLabel(file.file_type), viewHref: staffFileHref(session.id), downloadHref: staffFileHref(session.id, true) } : null,
    notNeeded: !!pickup?.not_needed,
    store: storeName(pickup),
    pickupPerson,
    state: pickupState(pickup),
    pickedUpLine: pickedUpLine(pickup, tz),
    isPickupPerson: !!pickup?.assignee_id && pickup.assignee_id === viewer.id && !pickup.not_needed,
  };
}
