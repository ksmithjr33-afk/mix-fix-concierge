// Post event closeout: rules, limits, texts, and the GHL payload. Pure, no database.
//
// Each bartender on an event sends one closeout, as part of the wrap up
// (lib/team/wrapup.ts), once bar service has started or they clocked out: how
// it went, a guest estimate, the inventory, anything we should know, and a
// required photo of the bar broken down and the area cleaned. It can be edited
// until an admin marks it reviewed, and every save is kept.

import { CHECKLIST } from "@/lib/team/checklist-config";
import { eventSchedule } from "@/lib/team/time";
import { PHOTO_TYPES, MAX_PHOTO_BYTES, type PhotoLike } from "@/lib/team/bar-ready";

export const CLOSEOUT_REMINDER_MIN = 30; // one text 30 minutes after clocking out with no wrap up
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

/** Open once bar service has started (the Wrap up tab shows), or once they clocked out. */
export function closeoutOpen(ed: Record<string, unknown>, o: { clockedOut: boolean; now: Date }): boolean {
  if (o.clockedOut) return true;
  const start = eventSchedule(ed).start;
  return !!start && o.now.getTime() >= start.getTime();
}

/** Editable until an admin marks it reviewed. */
export function canEdit(reviewedAt: string | null | undefined): boolean {
  return !reviewedAt;
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
  return `Hi ${o.firstName || "there"}, please do your wrap up for ${o.title}: how it went, what is left, the equipment, and a photo of the bar broken down. ${o.link}`;
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
