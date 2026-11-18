// Bar and venue photos on the event Location card: who manages and who sees
// them, how an address becomes a venue, caption and upload checks. Pure, no
// database, and light enough for the photo card in the browser.

import { isAdminRole } from "@/lib/team/roles";

export const MAX_CAPTION_LENGTH = 120;
export const MAX_EVENT_VENUE_PHOTOS = 40; // added on one event
export const MAX_PICK_AT_ONCE = 12;
export const VENUE_PHOTOS_TITLE = "Bar and venue photos";
export const PAST_TITLE = "From past events at this address";
export const NOT_READY = "Venue photos are not set up yet. Run the venue photos migration first.";

interface Viewer {
  role: unknown;
  active: boolean;
}

/** Admins and managers add, caption, reorder, delete, hide and keep. */
export function canManageVenuePhotos(staff: Viewer | null): boolean {
  return !!staff && staff.active && isAdminRole(staff.role);
}

/** Admins, managers, and staff assigned to the event who have not declined. Nobody else, and never clients. */
export function canViewVenuePhotos(staff: Viewer | null, assignment: { status: string } | null): boolean {
  if (!staff || !staff.active) return false;
  if (isAdminRole(staff.role)) return true;
  return !!assignment && assignment.status !== "declined";
}

/**
 * The venue an address points at: case, spacing and punctuation do not
 * matter, so "123 Main St., Dallas, TX" and "123 main st dallas tx" match.
 * Empty for no address, which never matches anything.
 */
export function venueKey(address: unknown): string {
  if (typeof address !== "string") return "";
  return address
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** A caption is optional, one line, and short. It is only ever what an admin typed. */
export function cleanCaption(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CAPTION_LENGTH);
}

const HEIC = /\.(heic|heif)$/i;

/** Phones sometimes send a HEIC photo with no type: read it from the file name. */
export function photoTypeOf(type: string, name = ""): string {
  const t = (type || "").toLowerCase();
  if (t) return t;
  if (HEIC.test(name)) return name.toLowerCase().endsWith(".heif") ? "image/heif" : "image/heic";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "";
}

/** Storage path in the bar photos bucket: one folder per event, one file per upload. */
export function venuePhotoPath(sessionId: string, at: Date, ext: string, n = 0): string {
  return `venue/${sessionId}/${at.getTime()}${n ? `_${n}` : ""}.${ext}`;
}

/** The new order of this event's photos: ids that belong to it, each once, in the order asked, with any left out kept at the end. */
export function reorderIds(current: string[], asked: unknown): string[] | null {
  if (!Array.isArray(asked)) return null;
  const have = new Set(current);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of asked) {
    if (typeof id !== "string" || !have.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return [...next, ...current.filter((id) => !seen.has(id))];
}

/** "Added Oct 3, 2026", in the event's time zone. */
export function addedLabel(iso: string, timeZone = "America/Chicago"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Added ${d.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" })}`;
}
