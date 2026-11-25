// Database side of client agreements. Server only. Rules in lib/team/agreements.ts.
//
// event_agreements holds one row per file. Upload is two steps, like the
// approved menu: start (check the declared type and size, hand back a one
// time upload link to a path the server chose, row "pending") and finish
// (read the stored file back, check it, make it "current"). Replacing a file
// uploads a new one that points at the old (replaces_id); the old becomes
// "replaced". Removing marks it "removed" and deletes the stored file. Every
// call checks admin or manager here, on the server.

import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { adminEventTitle } from "@/lib/team/event-list";
import { eventData } from "@/lib/team/markets";
import { eventSchedule } from "@/lib/team/time";
import { getTeamSession } from "@/lib/team/events";
import { pickupStamp } from "@/lib/team/menu-pickup";
import { confirmUpload, shortLink, signedUploadUrl } from "@/lib/team/direct-upload";
import { downloadName, typeLabel } from "@/lib/team/approved-menu";
import {
  agreementExtension,
  agreementFileError,
  agreementPath,
  AGREEMENT_BUCKET,
  AGREEMENT_FILE_TYPES,
  AGREEMENT_LINK_SECONDS,
  AGREEMENT_MAX_BYTES,
  canSeeAgreements,
  cleanLabel,
  type AgreementRow,
} from "@/lib/team/agreements";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export interface AgreementView {
  id: string;
  label: string;
  fileName: string;
  typeLabel: string; // "PDF"
  uploadedBy: string;
  uploadedAt: string; // "Nov 12, 3:40 PM"
  viewHref: string;
  downloadHref: string;
}

/** An agreement on the Clients page, with the event it belongs to. */
export interface ClientAgreementView extends AgreementView {
  sessionId: string;
  eventTitle: string;
  eventHref: string;
}

const ADMINS_ONLY = { ok: false as const, error: "Admins and managers only.", status: 403 };

async function rowsFor(sessionIds: string[]): Promise<AgreementRow[]> {
  if (sessionIds.length === 0) return [];
  const { data, error } = await supabase.from("event_agreements").select("*").in("session_id", sessionIds).eq("status", "current");
  if (error || !data) return []; // before the table exists
  return (data as AgreementRow[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function toView(r: AgreementRow, tz: string): AgreementView {
  const href = `/api/team/admin/agreement-file?id=${encodeURIComponent(r.id)}`;
  return {
    id: r.id,
    label: r.label ?? "",
    fileName: r.file_name ?? "",
    typeLabel: typeLabel(r.file_type),
    uploadedBy: r.uploaded_by_name || "someone",
    uploadedAt: pickupStamp(r.created_at, tz),
    viewHref: href,
    downloadHref: `${href}&download=1`,
  };
}

/** The Agreement card on the manager view. Null for anyone but admins and managers. */
export async function agreementsFor(sessionId: string, viewer: { role: unknown }, tz = "America/Chicago"): Promise<AgreementView[] | null> {
  if (!canSeeAgreements(viewer)) return null;
  return (await rowsFor([sessionId])).map((r) => toView(r, tz));
}

/** Every agreement across a client's events, for their Clients page entry. Null for anyone but admins and managers. */
export async function clientAgreements(sessionIds: string[], viewer: { role: unknown }): Promise<ClientAgreementView[] | null> {
  if (!canSeeAgreements(viewer)) return null;
  const rows = await rowsFor(sessionIds);
  const out: ClientAgreementView[] = [];
  const sessions = new Map<string, Awaited<ReturnType<typeof getTeamSession>>>();
  for (const r of rows) {
    if (!sessions.has(r.session_id)) sessions.set(r.session_id, await getTeamSession(r.session_id));
    const s = sessions.get(r.session_id);
    const ed = s ? eventData(s) : {};
    out.push({ ...toView(r, eventSchedule(ed).tz), sessionId: r.session_id, eventTitle: s ? adminEventTitle(ed) : "Event", eventHref: `/team/admin/e/${encodeURIComponent(r.session_id)}?tab=agreement` });
  }
  return out;
}

/** Step 1: check the file and hand back a one time upload link. replaces: the id of the file this one replaces. */
export async function startAgreementUpload(
  admin: StaffMember,
  sessionId: string,
  file: { type: string; size: number; name?: string },
  opts: { label?: unknown; replaces?: unknown } = {},
  now: Date = new Date()
): Promise<Result<{ id: string; uploadUrl: string }>> {
  if (!canSeeAgreements(admin)) return ADMINS_ONLY;
  const session = await getTeamSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const bad = agreementFileError(file);
  if (bad) return { ok: false, error: bad, status: 400 };
  let replaces: AgreementRow | null = null;
  if (typeof opts.replaces === "string" && opts.replaces) {
    const { data } = await supabase.from("event_agreements").select("*").eq("id", opts.replaces).maybeSingle();
    replaces = data as AgreementRow | null;
    if (!replaces || replaces.session_id !== sessionId || replaces.status !== "current") return { ok: false, error: "That file was already replaced or removed. Refresh to see.", status: 409 };
  }
  const type = file.type.toLowerCase();
  const path = agreementPath(sessionId, now, agreementExtension(type), crypto.randomBytes(4).toString("hex"));
  const uploadUrl = await signedUploadUrl(AGREEMENT_BUCKET, path);
  if (!uploadUrl) return { ok: false, error: "Could not start the upload. Try again.", status: 500 };
  const { data, error } = await supabase
    .from("event_agreements")
    .insert({
      session_id: sessionId,
      file_path: path,
      file_type: type,
      file_name: String(file.name ?? "").slice(0, 200) || null,
      size_bytes: Math.round(file.size),
      label: opts.label !== undefined ? cleanLabel(opts.label) : (replaces?.label ?? null),
      status: "pending",
      uploaded_by: admin.id,
      uploaded_by_name: firstName(admin.name) || admin.name,
      replaces_id: replaces?.id ?? null,
      created_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not start the upload. Try again.", status: 500 };
  return { ok: true, id: (data as { id: string }).id, uploadUrl };
}

/** Step 2: the file is in storage. Check it, make it current, and retire the one it replaces. */
export async function finishAgreementUpload(admin: StaffMember, fileId: string, now: Date = new Date()): Promise<Result<{ agreements: AgreementView[] }>> {
  if (!canSeeAgreements(admin)) return ADMINS_ONLY;
  const { data } = await supabase.from("event_agreements").select("*").eq("id", fileId).maybeSingle();
  const row = data as AgreementRow | null;
  if (!row || row.status !== "pending") return { ok: false, error: "We could not find that upload. Try again.", status: 404 };
  const session = await getTeamSession(row.session_id);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const stored = await confirmUpload(AGREEMENT_BUCKET, row.file_path, { types: AGREEMENT_FILE_TYPES, maxBytes: AGREEMENT_MAX_BYTES });
  if (!stored.ok) {
    await supabase.from("event_agreements").delete().eq("id", fileId).eq("status", "pending");
    return { ok: false, error: stored.error, status: 400 };
  }
  if (row.replaces_id) await supabase.from("event_agreements").update({ status: "replaced", removed_at: now.toISOString() }).eq("id", row.replaces_id).eq("status", "current");
  const { error } = await supabase.from("event_agreements").update({ status: "current", size_bytes: stored.size, file_type: stored.type }).eq("id", fileId).eq("status", "pending");
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, agreements: (await agreementsFor(row.session_id, admin, eventSchedule(eventData(session)).tz)) ?? [] };
}

/** Change a file's label. */
export async function labelAgreement(admin: StaffMember, fileId: string, label: unknown): Promise<Result<{ agreements: AgreementView[] }>> {
  if (!canSeeAgreements(admin)) return ADMINS_ONLY;
  const { data } = await supabase.from("event_agreements").select("*").eq("id", fileId).maybeSingle();
  const row = data as AgreementRow | null;
  if (!row || row.status !== "current") return { ok: false, error: "We could not find that file.", status: 404 };
  await supabase.from("event_agreements").update({ label: cleanLabel(label) }).eq("id", fileId);
  return { ok: true, agreements: (await agreementsFor(row.session_id, admin)) ?? [] };
}

/** Remove a file: marked removed (who and when kept), and the stored file deleted. */
export async function removeAgreement(admin: StaffMember, fileId: string, now: Date = new Date()): Promise<Result<{ agreements: AgreementView[] }>> {
  if (!canSeeAgreements(admin)) return ADMINS_ONLY;
  const { data } = await supabase.from("event_agreements").select("*").eq("id", fileId).maybeSingle();
  const row = data as AgreementRow | null;
  if (!row || row.status !== "current") return { ok: false, error: "We could not find that file.", status: 404 };
  await supabase.from("event_agreements").update({ status: "removed", removed_at: now.toISOString(), removed_by_name: firstName(admin.name) || admin.name }).eq("id", fileId);
  await supabase.storage.from(AGREEMENT_BUCKET).remove([row.file_path]);
  return { ok: true, agreements: (await agreementsFor(row.session_id, admin)) ?? [] };
}

/** A 10 minute signed link to one file. Null for anyone but admins and managers. */
export async function agreementLink(viewer: { role: unknown }, fileId: string, download: boolean): Promise<string | null> {
  if (!canSeeAgreements(viewer)) return null;
  const { data } = await supabase.from("event_agreements").select("*").eq("id", fileId).maybeSingle();
  const row = data as AgreementRow | null;
  if (!row || row.status !== "current") return null;
  const session = download ? await getTeamSession(row.session_id) : null;
  const name = download ? downloadName(`${row.label || "Agreement"} ${session ? adminEventTitle(eventData(session)) : ""}`.trim(), row.file_type) : undefined;
  return shortLink(AGREEMENT_BUCKET, row.file_path, AGREEMENT_LINK_SECONDS, name);
}
