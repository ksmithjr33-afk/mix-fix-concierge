// Client agreements: the signed agreement and any change orders, uploaded by
// an admin or manager on the manager view's Agreement tab. Pure, no database.
//
// Agreements carry pricing, so only admins and managers ever see them:
// bartenders, bar backs, servers and event helpers never do (and neither does
// an admin in Bartender view). Files are PDF, PNG or JPG up to 15 MB, like the
// approved menu, in their own private bucket, opened only through a short
// signed link from our own route.

import { isAdminRole } from "@/lib/team/roles";

export const AGREEMENT_BUCKET = "event-agreements";
export const AGREEMENT_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg"];
export const AGREEMENT_MAX_BYTES = 15 * 1024 * 1024;
export const AGREEMENT_LINK_SECONDS = 10 * 60;
export const AGREEMENT_LABEL_MAX = 80;

export interface AgreementRow {
  id: string;
  session_id: string;
  file_path: string;
  file_type: string;
  file_name: string | null;
  size_bytes: number | null;
  label: string | null;
  status: "pending" | "current" | "replaced" | "removed";
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  replaces_id: string | null;
  removed_at: string | null;
  removed_by_name: string | null;
}

/** Admins and managers only. Everyone else, Bartender view included, never sees an agreement. */
export const canSeeAgreements = (viewer: { role: unknown }): boolean => isAdminRole(viewer.role);

export function agreementFileError(file: { type: string; size: number } | null): string | null {
  if (!file) return "Pick a file.";
  if (!AGREEMENT_FILE_TYPES.includes(String(file.type).toLowerCase())) return "Upload a PDF, PNG or JPG.";
  if (!(file.size > 0)) return "That file is empty.";
  if (file.size > AGREEMENT_MAX_BYTES) return "That file is too large. The limit is 15 MB.";
  return null;
}

export function agreementExtension(type: string): string {
  return type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
}

/** event-agreements/<session>/<time>-<random>.<ext>, chosen by the server. */
export function agreementPath(sessionId: string, at: Date, ext: string, rand: string): string {
  return `${sessionId}/${at.getTime()}-${rand}.${ext}`;
}

/** The optional label ("Original agreement", "Change order 1"): one line, 80 characters. Empty is none. */
export function cleanLabel(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, AGREEMENT_LABEL_MAX);
  return s || null;
}
