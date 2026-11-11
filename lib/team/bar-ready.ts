// "Bar is ready" check in: rules for who can submit or view a bar photo, when
// the card opens, the upload limits, and the text to admins. Pure, no database.

import { canOpenEvent, type AssignmentLike, type StaffMember } from "@/lib/team/event-view";
import { eventDayStart, eventSchedule } from "@/lib/team/time";

export const BAR_PHOTO_BUCKET = "bar-photos";
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // phones resize first, this only stops runaway uploads
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const MAX_NOTE_LENGTH = 500;
export const SIGNED_URL_SECONDS = 30 * 60; // short lived links, made fresh on each page load
import { MAX_BAR_PHOTOS } from "@/lib/team/bar-photo-labels";
export { BAR_PHOTO_BUTTON, BAR_PHOTO_TITLE, MAX_BAR_PHOTOS } from "@/lib/team/bar-photo-labels";

/** The card opens at arrival time on the event day, or at the start of the day when there is no start time. */
export function barReadyOpensAt(ed: Record<string, unknown>): Date | null {
  const s = eventSchedule(ed);
  if (s.arrival) return s.arrival;
  return eventDayStart(ed);
}

export function barReadyOpen(ed: Record<string, unknown>, now: Date = new Date()): boolean {
  const at = barReadyOpensAt(ed);
  return !!at && now.getTime() >= at.getTime();
}

/** Photos can be added, retaken, and removed until the event ends: service end, or the end of the event day with no end time. */
export function barPhotosCloseAt(ed: Record<string, unknown>): Date | null {
  const s = eventSchedule(ed);
  if (s.end) return s.end;
  const day = eventDayStart(ed);
  return day ? new Date(day.getTime() + 24 * 3_600_000) : null;
}

export function barPhotosOpen(ed: Record<string, unknown>, now: Date = new Date()): boolean {
  const close = barPhotosCloseAt(ed);
  return barReadyOpen(ed, now) && (!close || now.getTime() < close.getTime());
}

/** No bar setup photo from anyone once bar service has started: a gentle reminder for the bartender, a flag for managers. */
export function barPhotoMissing(ed: Record<string, unknown>, now: Date, photos: number): boolean {
  const start = eventSchedule(ed).start;
  return photos === 0 && !!start && now.getTime() >= start.getTime();
}

/** Room for one more photo, or a retake of one already there. */
export function photoLimitError(active: number, replacing: boolean): string | null {
  return !replacing && active >= MAX_BAR_PHOTOS ? `Up to ${MAX_BAR_PHOTOS} photos. Remove or retake one first.` : null;
}

/** Assigned staff and admins can see bar photos for an event. Nobody else. */
export function canViewBarPhotos(staff: StaffMember | null, assignment: AssignmentLike | null): boolean {
  return canOpenEvent(staff, assignment);
}

/** Assigned staff and admins can submit from arrival time on the event day. */
export function canSubmitBarReady(
  staff: StaffMember | null,
  assignment: AssignmentLike | null,
  ed: Record<string, unknown>,
  now: Date = new Date()
): boolean {
  return canOpenEvent(staff, assignment) && barPhotosOpen(ed, now);
}

export interface PhotoLike {
  type: string;
  size: number;
}

export type BarReadyCheck = { ok: true; note: string } | { ok: false; error: string };

/** A photo is required. The note is optional. */
export function validateBarReady(photo: PhotoLike | null | undefined, note: unknown): BarReadyCheck {
  if (!photo || photo.size <= 0) return { ok: false, error: "Add a photo of the bar setup." };
  if (!PHOTO_TYPES.includes(photo.type.toLowerCase())) return { ok: false, error: "That file is not a photo. Take or choose a photo." };
  if (photo.size > MAX_PHOTO_BYTES) return { ok: false, error: "That photo is too large. Try again." };
  return { ok: true, note: String(note ?? "").trim().slice(0, MAX_NOTE_LENGTH) };
}

export function photoExtension(type: string): string {
  const t = type.toLowerCase();
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  if (t === "image/heic" || t === "image/heif") return "heic";
  return "jpg";
}

/** Storage path: one folder per event and staff member, one file per submit, so replacements are kept. */
export function photoPath(sessionId: string, staffId: string, at: Date, type: string): string {
  return `${sessionId}/${staffId}/${at.getTime()}.${photoExtension(type)}`;
}

export interface CountSnapshot {
  checklistChecked: number;
  checklistTotal: number;
  shoppingChecked: number;
  shoppingTotal: number;
}

export function snapshotTotals(s: CountSnapshot): { checked: number; total: number } {
  return { checked: s.checklistChecked + s.shoppingChecked, total: s.checklistTotal + s.shoppingTotal };
}

/** "Jordan's bar is ready for Justin · Wedding. 40 of 42 items checked. <link>", plus a line when items were reported missing. */
export function barReadyText(opts: {
  firstName: string;
  eventTitle: string;
  checked: number;
  total: number;
  missingReported: boolean;
  link: string;
}): string {
  const who = opts.firstName ? `${opts.firstName}'s` : "The";
  return [
    `${who} bar is ready for ${opts.eventTitle}. ${opts.checked} of ${opts.total} items checked.`,
    opts.missingReported ? "Items were reported missing for this event." : "",
    opts.link,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface BarReadyRow {
  id: string;
  staff_id: string;
  created_at: string;
}

/** Reports grouped by who sent them, newest first in each group, newest group first. */
export function groupReports<T extends BarReadyRow>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const g = groups.get(r.staff_id) ?? [];
    g.push(r);
    groups.set(r.staff_id, g);
  }
  return [...groups.values()];
}
