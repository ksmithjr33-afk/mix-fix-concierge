// Certifications: the rules. Pure, no database.
//
// Each market requires one certification (config). A bartender's standing
// for that certification is the best of their uploads of that type:
//   ok       approved and not expired
//   pending  uploaded, not reviewed yet, not expired (allowed while waiting)
//   rejected the latest upload was rejected and nothing valid is on file
//   expired  everything on file has expired
//   missing  nothing on file
// A certificate is good through its expiry date and expired the day after.

import { CERT_BY_MARKET, CERT_FILE_TYPES, CERT_MAX_BYTES, CERT_REMINDER_DAYS, CERT_TYPES } from "@/lib/team/cert-config";
import type { Market } from "@/lib/team/markets";

export type CertReview = "pending" | "approved" | "rejected";
export type CertState = "ok" | "pending" | "rejected" | "expired" | "missing";

export interface CertRow {
  id: string;
  staff_id: string;
  cert_type: string;
  file_path: string;
  file_type: string;
  expires_on: string; // YYYY-MM-DD
  status: CertReview;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface CertStanding {
  certType: string;
  state: CertState;
  expiresOn: string | null;
  row: CertRow | null; // the upload the state comes from
}

export const NOTE_MAX = 300;

export function requiredCert(market: Market | null | undefined): string | null {
  return market ? CERT_BY_MARKET[market] ?? null : null;
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

export const isExpired = (expiresOn: string, today: string) => expiresOn < today;

/** Whole days from today to the expiry date (0 on the day, negative after). */
export function daysLeft(expiresOn: string, today: string): number {
  return Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Standing for one certification type from all of this person's uploads. */
export function certStanding(rows: CertRow[], certType: string, today: string): CertStanding {
  const mine = rows.filter((r) => r.cert_type === certType).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const valid = (r: CertRow) => !isExpired(r.expires_on, today);
  const pickLatestExpiry = (list: CertRow[]) => [...list].sort((a, b) => b.expires_on.localeCompare(a.expires_on))[0];
  const approved = mine.filter((r) => r.status === "approved" && valid(r));
  if (approved.length) {
    const r = pickLatestExpiry(approved);
    return { certType, state: "ok", expiresOn: r.expires_on, row: r };
  }
  const pending = mine.filter((r) => r.status === "pending" && valid(r));
  if (pending.length) return { certType, state: "pending", expiresOn: pending[0].expires_on, row: pending[0] };
  if (mine[0]?.status === "rejected") return { certType, state: "rejected", expiresOn: mine[0].expires_on, row: mine[0] };
  const expired = mine.filter((r) => r.status !== "rejected");
  if (expired.length) {
    const r = pickLatestExpiry(expired);
    return { certType, state: "expired", expiresOn: r.expires_on, row: r };
  }
  return { certType, state: "missing", expiresOn: null, row: null };
}

/** Missing, rejected, and expired keep someone from requesting shifts when enforced. */
export const blocks = (state: CertState) => state === "missing" || state === "rejected" || state === "expired";

export const STATE_LABELS: Record<CertState, string> = {
  ok: "Approved",
  pending: "Waiting for review",
  rejected: "Rejected",
  expired: "Expired",
  missing: "Missing",
};

/** "TABC expired" for admin lists. Null when fine. */
export function shortProblem(s: CertStanding): string | null {
  if (!blocks(s.state)) return null;
  return `${s.certType} ${s.state}`;
}

/** What the bartender sees on a shift they cannot request. */
export function blockText(s: CertStanding, marketLabel: string): string {
  const why = s.state === "missing" ? "is not on file" : s.state === "rejected" ? "was not approved" : "has expired";
  return `Your ${s.certType} certification ${why}, so you cannot request ${marketLabel} shifts yet. Upload a current one on My certifications.`;
}

/** The same while enforcement is off: a warning only. */
export function warnText(s: CertStanding, marketLabel: string): string {
  const why = s.state === "missing" ? "is not on file" : s.state === "rejected" ? "was not approved" : "has expired";
  return `Your ${s.certType} certification ${why}. ${marketLabel} shifts need a current one. Upload it on My certifications.`;
}

/** The admin confirm step: "Jordan's TABC certification has expired." */
export function adminProblemText(firstName: string, s: CertStanding): string {
  const why = s.state === "missing" ? "is not on file" : s.state === "rejected" ? "was rejected" : "has expired";
  return `${firstName || "Their"}'s ${s.certType} certification ${why}.`;
}

export interface CertUpload {
  certType: string;
  expiresOn: string;
}

/** A certification upload ready to save, or why not. */
export function validateCertUpload(
  raw: { certType?: unknown; expiresOn?: unknown },
  file: { type: string; size: number } | null,
  today: string
): { ok: true; value: CertUpload } | { ok: false; error: string } {
  const certType = String(raw.certType ?? "");
  if (!CERT_TYPES.includes(certType)) return { ok: false, error: "Pick the certification." };
  const expiresOn = String(raw.expiresOn ?? "").trim();
  if (!isDay(expiresOn)) return { ok: false, error: "Enter the expiry date." };
  if (isExpired(expiresOn, today)) return { ok: false, error: "That certification has already expired." };
  if (daysLeft(expiresOn, today) > 366 * 6) return { ok: false, error: "Check the expiry date." };
  if (!file || file.size <= 0) return { ok: false, error: "Add a photo or PDF of the certificate." };
  if (!CERT_FILE_TYPES.includes(file.type.toLowerCase())) return { ok: false, error: "Upload a photo or a PDF." };
  if (file.size > CERT_MAX_BYTES) return { ok: false, error: "That file is too large. The limit is 10 MB." };
  return { ok: true, value: { certType, expiresOn } };
}

export function certExtension(type: string): string {
  const t = type.toLowerCase();
  if (t === "application/pdf") return "pdf";
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  if (t === "image/heic" || t === "image/heif") return "heic";
  return "jpg";
}

export function certPath(staffId: string, certType: string, at: Date, ext: string): string {
  return `certs/${staffId}/${certType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.getTime()}.${ext}`;
}

/**
 * Which reminder is due: 30, 7, or 0 (the day). The smallest step at or above
 * the days left, so a late upload still gets the right one. Null outside.
 */
export function reminderStep(expiresOn: string, today: string): number | null {
  const left = daysLeft(expiresOn, today);
  if (left < 0) return null;
  const steps = [...CERT_REMINDER_DAYS].sort((a, b) => a - b);
  return steps.find((d) => left <= d) ?? null;
}

function whenText(expiresOn: string, today: string): string {
  const left = daysLeft(expiresOn, today);
  return left === 0 ? "expires today" : `expires in ${left} ${left === 1 ? "day" : "days"}`;
}

export function certReminderText(o: { firstName: string; certType: string; expiresOn: string; today: string; link: string }): string {
  return `Hi ${o.firstName || "there"}, your ${o.certType} certification ${whenText(o.expiresOn, o.today)}. Upload your renewed certificate here: ${o.link}`;
}

export function adminCertReminderText(o: { name: string; certType: string; expiresOn: string; today: string; link: string }): string {
  return `${o.name}'s ${o.certType} certification ${whenText(o.expiresOn, o.today)}. ${o.link}`;
}

export function certUploadedText(o: { name: string; certType: string; link: string }): string {
  return `${o.name} uploaded a ${o.certType} certification to review. ${o.link}`;
}

export function certReviewedText(o: { firstName: string; certType: string; approved: boolean; note: string; link: string }): string {
  return o.approved
    ? `Hi ${o.firstName || "there"}, your ${o.certType} certification was approved.`
    : `Hi ${o.firstName || "there"}, your ${o.certType} certification was not approved: ${o.note} Upload a new one here: ${o.link}`;
}
