// The approved menu: the final menu graphic an admin uploads after the client
// approves it. Pure, no database.
//
// Who sees it: admins, the staff on the event (not declined), the person
// picking up the printed menu, and the client on their own event page. Nobody
// else. Uploading a new one replaces the current one; the old ones stay in a
// short history only admins open.

import { pickupDeadline } from "@/lib/team/menu-pickup";

export const MENU_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"];
export const MENU_MAX_BYTES = 15 * 1024 * 1024;
/** The manager Details count and the events list marker start this long before the event. */
export const MENU_MISSING_HOURS = 72;
/** Links to the file last this long. Pages link through our server, which makes a fresh one each time. */
export const MENU_LINK_SECONDS = 10 * 60;
/** How many replaced menus admins can open. */
export const MENU_HISTORY = 5;

export interface MenuFileRow {
  id: string;
  session_id: string;
  file_path: string;
  file_type: string;
  file_name: string | null;
  size_bytes: number | null;
  status: "pending" | "current" | "replaced";
  client_approved_on: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  replaced_at: string | null;
  created_at: string;
}

/** Why a menu file cannot be uploaded, or null when it is fine. */
export function menuFileError(file: { type: string; size: number } | null): string | null {
  if (!file || !(file.size > 0)) return "Choose the menu file first.";
  if (!MENU_FILE_TYPES.includes(String(file.type).toLowerCase())) return "Upload a PDF, PNG or JPG.";
  if (file.size > MENU_MAX_BYTES) return "That file is too large. The limit is 15 MB.";
  return null;
}

export function menuExtension(type: string): string {
  const t = type.toLowerCase();
  return t === "application/pdf" ? "pdf" : t === "image/png" ? "png" : "jpg";
}

export function menuPath(sessionId: string, at: Date, ext: string): string {
  return `menus/${sessionId.replace(/[^A-Za-z0-9_-]/g, "")}/${at.getTime()}.${ext}`;
}

/** The file name a download gets: "menu-justins-30th.pdf". */
export function downloadName(title: string, type: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `menu${slug ? `-${slug}` : ""}.${menuExtension(type)}`;
}

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** "Client approved on": a real date, not after today. */
export function cleanApprovedOn(raw: unknown, today: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? "").trim();
  if (!isDay(v)) return { ok: false, error: "Enter the date the client approved the menu." };
  if (v > today) return { ok: false, error: "The approval date cannot be in the future." };
  return { ok: true, value: v };
}

export interface MenuViewer {
  role: string;
  active: boolean;
}

/**
 * Who may open the approved menu: admins; staff on the event (offered or
 * accepted, not declined); and the person assigned to pick up the printed
 * menu, who may not be working the event.
 */
export function canSeeMenu(viewer: MenuViewer, assignmentStatus: string | null, isPickupPerson: boolean): boolean {
  if (!viewer.active) return false;
  if (viewer.role === "admin") return true;
  if (isPickupPerson) return true;
  return assignmentStatus === "offered" || assignmentStatus === "accepted";
}

/**
 * Inside 72 hours of the event (and before it) with no approved menu
 * uploaded. Events marked "No printed menu" do not count.
 */
export function menuMissing(hasCurrent: boolean, notNeeded: boolean, ed: Record<string, unknown>, now: Date): boolean {
  if (hasCurrent || notNeeded) return false;
  const at = pickupDeadline(ed);
  if (!at) return false;
  const left = at.getTime() - now.getTime();
  return left > 0 && left <= MENU_MISSING_HOURS * 3_600_000;
}

export function typeLabel(type: string): string {
  return type === "application/pdf" ? "PDF" : type === "image/png" ? "PNG" : "JPG";
}

export const isImage = (type: string) => type === "image/png" || type === "image/jpeg";
