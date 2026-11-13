// Images and GIFs in event chat and announcements: the database side. Server only.
//
// An attachment starts "pending" (uploaded, not sent yet) and only its
// uploader can see it. Sending the message or announcement claims it: the
// stored file is checked again (type and real size) and it becomes
// "attached", visible to exactly the people who can see that chat thread or
// announcement. Admins can remove any attachment; the file is deleted.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { threadAccess } from "@/lib/team/chat-db";
import { confirmUpload, shortLink, signedUploadUrl } from "@/lib/team/direct-upload";
import {
  giphyByIdUrl,
  giphyEnabled,
  giphyFileUrl,
  giphyResult,
  giphySearchUrl,
  isGiphyId,
  isGiphyMediaUrl,
  mediaError,
  mediaExtension,
  mediaKind,
  mediaPath,
  MEDIA_LINK_SECONDS,
  MEDIA_MAX_BYTES,
  MEDIA_TYPES,
  type AttachmentRow,
  type GiphyGif,
  type MediaKind,
  type MediaScope,
} from "@/lib/team/media";

export const MEDIA_BUCKET = "team-media";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export interface AttachmentView {
  id: string;
  kind: MediaKind;
  url: string; // our own route: checks the viewer, then sends them to a 10 minute link
  removed: boolean;
}

export const attachmentHref = (id: string) => `/api/team/media/file?id=${encodeURIComponent(id)}`;

async function row(id: string): Promise<AttachmentRow | null> {
  const { data, error } = await supabase.from("team_attachments").select("*").eq("id", id).maybeSingle();
  if (error) return null;
  return (data as AttachmentRow | null) ?? null;
}

/** Whether this person may attach to (and so upload for) this chat or announcement. */
async function mayAttach(staff: StaffMember, scope: MediaScope, sessionId: string | null): Promise<Result> {
  if (!staff.active) return { ok: false, error: "Sign in again.", status: 401 };
  if (scope === "announcement") return staff.role === "admin" ? { ok: true } : { ok: false, error: "Admins only.", status: 403 };
  if (scope !== "chat" || !sessionId) return { ok: false, error: "Bad request", status: 400 };
  const access = await threadAccess(sessionId, staff);
  if (!access.ok) return { ok: false, error: access.reason === "not_found" ? "We could not find that event." : "You are not on this event.", status: access.reason === "not_found" ? 404 : 403 };
  return { ok: true };
}

async function insertPending(staff: StaffMember, scope: MediaScope, sessionId: string | null, path: string, type: string, size: number, source: "upload" | "giphy", now: Date): Promise<string | null> {
  const { data, error } = await supabase
    .from("team_attachments")
    .insert({
      scope,
      session_id: scope === "chat" ? sessionId : null,
      file_path: path,
      file_type: type,
      size_bytes: Math.round(size),
      kind: mediaKind(type),
      source,
      status: "pending",
      uploaded_by: staff.id,
      created_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/**
 * Step 1 of attaching a picture from the phone: check the type and size it
 * says it has and hand back a one time upload link. Sending the message is
 * step 2 (claimAttachment), which checks the stored file again.
 */
export async function startMediaUpload(
  staff: StaffMember,
  o: { scope: unknown; sessionId?: unknown; type: unknown; size: unknown },
  now: Date = new Date()
): Promise<Result<{ id: string; uploadUrl: string; kind: MediaKind }>> {
  const scope = o.scope === "announcement" ? "announcement" : o.scope === "chat" ? "chat" : null;
  if (!scope) return { ok: false, error: "Bad request", status: 400 };
  const sessionId = typeof o.sessionId === "string" ? o.sessionId : null;
  const may = await mayAttach(staff, scope, sessionId);
  if (!may.ok) return may;
  const file = { type: String(o.type ?? "").toLowerCase(), size: Number(o.size ?? 0) };
  const bad = mediaError(file);
  if (bad) return { ok: false, error: bad, status: 400 };
  const path = mediaPath(scope, scope === "chat" ? sessionId! : "announcements", staff.id, now, mediaExtension(file.type));
  const uploadUrl = await signedUploadUrl(MEDIA_BUCKET, path);
  if (!uploadUrl) return { ok: false, error: "Could not start the upload. Try again.", status: 500 };
  const id = await insertPending(staff, scope, sessionId, path, file.type, file.size, "upload", now);
  if (!id) return { ok: false, error: "Could not start the upload. Try again.", status: 500 };
  return { ok: true, id, uploadUrl, kind: mediaKind(file.type) };
}

// ----- GIPHY -----

async function giphyJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`giphy ${res.status}`);
  return res.json();
}

/** GIPHY search, rated G only. Empty when the key is not set. */
export async function searchGiphy(staff: StaffMember, q: unknown): Promise<Result<{ results: NonNullable<ReturnType<typeof giphyResult>>[] }>> {
  if (!staff.active) return { ok: false, error: "Sign in again.", status: 401 };
  if (!giphyEnabled()) return { ok: false, error: "GIF search is off.", status: 404 };
  const query = String(q ?? "").trim().slice(0, 50);
  if (!query) return { ok: true, results: [] };
  try {
    const data = (await giphyJson(giphySearchUrl(process.env.GIPHY_API_KEY!.trim(), query))) as { data?: GiphyGif[] };
    return { ok: true, results: (data.data ?? []).map(giphyResult).filter((r): r is NonNullable<typeof r> => !!r) };
  } catch (err) {
    console.error("[media] giphy search failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "GIF search is not working right now.", status: 502 };
  }
}

/**
 * Attach a GIF chosen from GIPHY: look it up by id (so only rated G GIFs from
 * GIPHY itself are taken), copy it into the private bucket, and keep it
 * pending until the message is sent.
 */
export async function importGiphy(
  staff: StaffMember,
  o: { scope: unknown; sessionId?: unknown; giphyId: unknown },
  now: Date = new Date()
): Promise<Result<{ id: string; kind: MediaKind }>> {
  if (!giphyEnabled()) return { ok: false, error: "GIF search is off.", status: 404 };
  const scope = o.scope === "announcement" ? "announcement" : o.scope === "chat" ? "chat" : null;
  if (!scope || !isGiphyId(o.giphyId)) return { ok: false, error: "Bad request", status: 400 };
  const sessionId = typeof o.sessionId === "string" ? o.sessionId : null;
  const may = await mayAttach(staff, scope, sessionId);
  if (!may.ok) return may;
  try {
    const data = (await giphyJson(giphyByIdUrl(process.env.GIPHY_API_KEY!.trim(), o.giphyId))) as { data?: GiphyGif };
    const url = data.data ? giphyFileUrl(data.data) : null;
    if (!url || !isGiphyMediaUrl(url)) return { ok: false, error: "That GIF is not available.", status: 400 };
    const res = await fetch(url);
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() || "image/gif";
    if (!res.ok) return { ok: false, error: "That GIF is not available.", status: 400 };
    const blob = await res.blob();
    const bad = mediaError({ type, size: blob.size });
    if (bad) return { ok: false, error: bad, status: 400 };
    const path = mediaPath(scope, scope === "chat" ? sessionId! : "announcements", staff.id, now, mediaExtension(type));
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (error) return { ok: false, error: "Could not attach that GIF. Try again.", status: 500 };
    const id = await insertPending(staff, scope, sessionId, path, type, blob.size, "giphy", now);
    if (!id) return { ok: false, error: "Could not attach that GIF. Try again.", status: 500 };
    return { ok: true, id, kind: mediaKind(type) };
  } catch (err) {
    console.error("[media] giphy import failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "Could not attach that GIF. Try again.", status: 502 };
  }
}

// ----- Sending -----

/**
 * Check a pending attachment before it is sent with a message or
 * announcement: it is this person's, for this chat (or an announcement), and
 * the stored file really is a GIF, PNG, JPG or WEBP under 8 MB.
 */
export async function claimAttachment(staff: StaffMember, id: unknown, scope: MediaScope, sessionId: string | null): Promise<Result<{ row: AttachmentRow }>> {
  if (typeof id !== "string" || !id) return { ok: false, error: "Bad request", status: 400 };
  const r = await row(id);
  if (!r || r.status !== "pending" || r.uploaded_by !== staff.id || r.scope !== scope || (scope === "chat" && r.session_id !== sessionId)) {
    return { ok: false, error: "That picture did not upload. Attach it again.", status: 400 };
  }
  const stored = await confirmUpload(MEDIA_BUCKET, r.file_path, { types: MEDIA_TYPES, maxBytes: MEDIA_MAX_BYTES });
  if (!stored.ok) {
    await supabase.from("team_attachments").delete().eq("id", r.id).eq("status", "pending");
    return { ok: false, error: stored.error, status: 400 };
  }
  return { ok: true, row: { ...r, file_type: stored.type, size_bytes: stored.size, kind: mediaKind(stored.type) } };
}

/** Mark a claimed attachment as sent with this message or announcement. */
export async function attach(id: string, link: { message_id?: string; announcement_id?: string }, row: Pick<AttachmentRow, "file_type" | "size_bytes" | "kind">): Promise<void> {
  const { error } = await supabase
    .from("team_attachments")
    .update({ status: "attached", file_type: row.file_type, size_bytes: row.size_bytes, kind: row.kind, ...link })
    .eq("id", id)
    .eq("status", "pending");
  if (error) console.error("[media] attaching failed:", error.message);
}

// ----- Viewing -----

/**
 * Whether this person may see the attachment: a pending one only its
 * uploader; a chat one, anyone who can open that event's thread; an
 * announcement one, admins and the people it was sent to. Removed: nobody.
 */
export async function canViewAttachment(viewer: StaffMember, r: AttachmentRow): Promise<boolean> {
  if (!viewer.active || r.status === "removed") return false;
  if (r.status === "pending") return r.uploaded_by === viewer.id;
  if (r.scope === "chat") return !!r.session_id && (await threadAccess(r.session_id, viewer)).ok;
  if (viewer.role === "admin") return true;
  if (!r.announcement_id) return false;
  const { data } = await supabase.from("announcement_recipients").select("id").eq("announcement_id", r.announcement_id).eq("staff_id", viewer.id).maybeSingle();
  return !!data;
}

/** A 10 minute link to the attachment, or null when this person may not see it. */
export async function attachmentLink(viewer: StaffMember, id: string): Promise<string | null> {
  const r = await row(id);
  if (!r || !(await canViewAttachment(viewer, r))) return null;
  return shortLink(MEDIA_BUCKET, r.file_path, MEDIA_LINK_SECONDS);
}

/** The attachments for these ids, for showing a thread or an announcement the viewer already passed the check for. */
export async function attachmentViews(ids: (string | null | undefined)[]): Promise<Map<string, AttachmentView>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Map();
  const { data, error } = await supabase.from("team_attachments").select("id, kind, status").in("id", want);
  if (error || !data) return new Map();
  return new Map((data as { id: string; kind: MediaKind; status: string }[]).map((a) => [a.id, { id: a.id, kind: a.kind, url: attachmentHref(a.id), removed: a.status === "removed" }]));
}

/** The kind of an announcement's picture, for its text. */
export async function attachmentKind(id: string | null | undefined): Promise<MediaKind | null> {
  if (!id) return null;
  const r = await row(id);
  return r && r.status === "attached" ? r.kind : null;
}

/** Admins: remove any attachment. The file is deleted; the message stays and says the picture was removed. */
export async function removeAttachment(admin: StaffMember, id: string, now: Date = new Date()): Promise<Result> {
  if (admin.role !== "admin" || !admin.active) return { ok: false, error: "Only an admin can remove a picture.", status: 403 };
  const r = await row(id);
  if (!r) return { ok: false, error: "We could not find that picture.", status: 404 };
  if (r.status === "removed") return { ok: true };
  const { error } = await supabase.from("team_attachments").update({ status: "removed", removed_by: admin.id, removed_at: now.toISOString() }).eq("id", id);
  if (error) return { ok: false, error: "Could not remove it. Try again.", status: 500 };
  await supabase.storage.from(MEDIA_BUCKET).remove([r.file_path]);
  return { ok: true };
}
