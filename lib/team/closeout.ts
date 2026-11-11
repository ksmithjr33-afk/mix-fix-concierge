// Post event closeout: rules, limits, texts, and the GHL payload. Pure, no database.
//
// Each bartender on an event sends one closeout after clocking out, or from
// 30 minutes before scheduled service end: how it went, a guest estimate,
// issues, company gear broken or missing, leftover product, and a required
// photo of the bar broken down and the area cleaned. It can be edited for 24
// hours after the first submit, and every save is kept.

import { CHECKLIST } from "@/lib/team/checklist-config";
import { eventSchedule } from "@/lib/team/time";
import { PHOTO_TYPES, MAX_PHOTO_BYTES, type PhotoLike } from "@/lib/team/bar-ready";

export const CLOSEOUT_LEAD_MIN = 30; // opens 30 minutes before scheduled service end
export const CLOSEOUT_EDIT_HOURS = 24;
export const CLOSEOUT_REMINDER_HOURS = 2; // after clocking out with no closeout
export const CLOSEOUT_REMINDER_WINDOW_HOURS = 26; // stop looking a day later, so old clock outs never text
export const ISSUES_MAX = 1000;
export const NOTE_MAX = 500;
export const MAX_GUESTS = 5000;

export const RATINGS = ["great", "fine", "had_problems"] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_LABELS: Record<Rating, string> = { great: "Great", fine: "Fine", had_problems: "Had problems" };

/** Company gear a closeout can mark broken or missing: the "From The Mix Fix" checklist items. */
export function companyGear(): string[] {
  return CHECKLIST.filter((g) => g.id === "company").flatMap((g) => g.sections.flatMap((s) => s.items));
}

/** 30 minutes before scheduled service end. Null when there is no end time. */
export function closeoutOpensAt(ed: Record<string, unknown>): Date | null {
  const end = eventSchedule(ed).end;
  return end ? new Date(end.getTime() - CLOSEOUT_LEAD_MIN * 60_000) : null;
}

/** Open once they clocked out, or from 30 minutes before scheduled service end. */
export function closeoutOpen(ed: Record<string, unknown>, o: { clockedOut: boolean; now: Date }): boolean {
  if (o.clockedOut) return true;
  const at = closeoutOpensAt(ed);
  return !!at && o.now.getTime() >= at.getTime();
}

/** Editable until 24 hours after the first submit. */
export function editUntil(firstSubmittedAt: string | Date): Date {
  return new Date(new Date(firstSubmittedAt).getTime() + CLOSEOUT_EDIT_HOURS * 3_600_000);
}

export function canEdit(firstSubmittedAt: string | Date | null, now: Date): boolean {
  return !firstSubmittedAt || now.getTime() < editUntil(firstSubmittedAt).getTime();
}

export interface CloseoutInput {
  rating: Rating;
  guestEstimate: number | null;
  issues: string;
  gearItems: string[];
  gearNote: string;
  leftoverNote: string;
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

/**
 * A closeout ready to save, or why not. A photo is required on the first
 * submit; an edit may keep the photo it has.
 */
export function validateCloseout(
  raw: { rating?: unknown; guests?: unknown; issues?: unknown; gear?: unknown; gearNote?: unknown; leftover?: unknown },
  photo: PhotoLike | null | undefined,
  o: { hasPhoto: boolean }
): { ok: true; value: CloseoutInput } | { ok: false; error: string } {
  const rating = String(raw.rating ?? "") as Rating;
  if (!RATINGS.includes(rating)) return { ok: false, error: "Pick how it went." };
  let guestEstimate: number | null = null;
  const g = String(raw.guests ?? "").trim();
  if (g) {
    const n = Number(g);
    if (!Number.isInteger(n) || n < 0 || n > MAX_GUESTS) return { ok: false, error: "Enter the guest count as a whole number." };
    guestEstimate = n;
  }
  const allowed = new Set(companyGear());
  const gearRaw = Array.isArray(raw.gear) ? raw.gear : raw.gear ? [raw.gear] : [];
  const gearItems = [...new Set(gearRaw.map((x) => String(x)))];
  if (gearItems.some((x) => !allowed.has(x))) return { ok: false, error: "Pick gear from the list." };
  if (photo && photo.size > 0) {
    if (!PHOTO_TYPES.includes(photo.type.toLowerCase())) return { ok: false, error: "That file is not a photo. Take or choose a photo." };
    if (photo.size > MAX_PHOTO_BYTES) return { ok: false, error: "That photo is too large. Try again." };
  } else if (!o.hasPhoto) {
    return { ok: false, error: "Add a photo of the bar broken down and the area cleaned." };
  }
  return {
    ok: true,
    value: {
      rating,
      guestEstimate,
      issues: clean(raw.issues, ISSUES_MAX),
      gearItems,
      gearNote: clean(raw.gearNote, NOTE_MAX),
      leftoverNote: clean(raw.leftover, NOTE_MAX),
    },
  };
}

/** Broken or missing company gear was reported. */
export function reportsGear(c: Pick<CloseoutInput, "gearItems" | "gearNote">): boolean {
  return c.gearItems.length > 0 || c.gearNote.trim().length > 0;
}

/** Admins with alerts on hear right away when it had problems or gear is broken or missing. */
export function needsAlert(c: Pick<CloseoutInput, "rating" | "gearItems" | "gearNote">): boolean {
  return c.rating === "had_problems" || reportsGear(c);
}

/** "Closeout from Jordan on Justin's 30th: had problems, gear broken or missing (Bar mats (2)). <link>" */
export function closeoutAlertText(o: { firstName: string; title: string; c: CloseoutInput; link: string }): string {
  const what = [
    o.c.rating === "had_problems" ? "had problems" : "",
    reportsGear(o.c) ? `gear broken or missing${o.c.gearItems.length ? ` (${o.c.gearItems.join(", ")})` : ""}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `Closeout from ${o.firstName || "a bartender"} on ${o.title}: ${what}. ${o.link}`;
}

export function closeoutReminderText(o: { firstName: string; title: string; link: string }): string {
  return `Hi ${o.firstName || "there"}, please send your closeout for ${o.title}: how it went and a photo of the bar broken down. ${o.link}`;
}

/** Storage path in the private bar photo bucket. */
export function closeoutPhotoPath(sessionId: string, staffId: string, at: Date, ext: string): string {
  return `closeout/${sessionId}/${staffId}/${at.getTime()}.${ext}`;
}

export interface CloseoutWebhookPayload {
  client_email: string | null;
  event_date: string | null;
  event_title: string;
  overall_rating: Rating;
  had_problems: boolean;
  closeouts: number;
}

/**
 * The GHL follow up webhook body, sent once when the first closeout for an
 * event comes in. Built from an allowlist: never staff notes, gear, or photos.
 */
export function closeoutWebhookPayload(o: { clientEmail: unknown; eventDate: string | null; eventTitle: string; rating: Rating; closeouts: number }): CloseoutWebhookPayload {
  const email = String(o.clientEmail ?? "").trim();
  return {
    client_email: email.includes("@") ? email : null,
    event_date: o.eventDate,
    event_title: o.eventTitle,
    overall_rating: o.rating,
    had_problems: o.rating === "had_problems",
    closeouts: o.closeouts,
  };
}
