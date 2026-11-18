// Database and storage side of bar and venue photos. Server only.
// Files go in the same private bucket as bar setup photos and are only shown
// through short lived signed URLs, made after the caller passed the access
// check. Every read tolerates the tables not existing yet (the migration not
// run): the Location card then loads with no photos.

import { supabase } from "@/lib/supabase";
import { BAR_PHOTO_BUCKET, MAX_PHOTO_BYTES, PHOTO_TYPES, photoExtension } from "@/lib/team/bar-ready";
import { signedUrls } from "@/lib/team/bar-ready-db";
import {
  canManageVenuePhotos,
  canViewVenuePhotos,
  cleanCaption,
  MAX_EVENT_VENUE_PHOTOS,
  NOT_READY,
  reorderIds,
  venueKey,
  venuePhotoPath,
} from "@/lib/team/venue-photos";

interface Viewer {
  id: string;
  role: unknown;
  active: boolean;
}

interface SessionLike {
  id: string;
  event_data: Record<string, unknown> | null;
}

interface PhotoRow {
  id: string;
  venue_key: string;
  session_id: string | null;
  photo_path: string;
  caption: string;
  position: number;
  source: "upload" | "bar_setup";
  bar_report_id: string | null;
  added_by: string | null;
  created_at: string;
  removed_at: string | null;
}

export interface VenuePhoto {
  id: string;
  url: string | null;
  caption: string;
  addedAt: string;
  source: "upload" | "bar_setup";
}

export interface VenuePhotoView {
  ready: boolean; // false until the migration runs
  canManage: boolean;
  own: VenuePhoto[]; // added on this event, in the order admins set
  past: VenuePhoto[]; // from other events at this address, newest first, hidden ones left out
  hidden: VenuePhoto[]; // carried over but hidden for this event: admins and managers only
  keptBarReports: string[]; // bar setup photos already kept as venue photos: admins and managers only
}

export class VenuePhotoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const EMPTY = (canManage: boolean, ready: boolean): VenuePhotoView => ({ ready, canManage, own: [], past: [], hidden: [], keptBarReports: [] });

const live = (rows: PhotoRow[]) => rows.filter((r) => !r.removed_at);
const ordered = (rows: PhotoRow[]) => [...rows].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

async function ownRows(sessionId: string): Promise<PhotoRow[] | null> {
  const { data, error } = await supabase.from("venue_photos").select("*").eq("session_id", sessionId);
  if (error || !data) return null;
  return ordered(live(data as PhotoRow[]));
}

function manager(staff: Viewer | null): asserts staff is Viewer {
  if (!canManageVenuePhotos(staff)) throw new VenuePhotoError("Admins and managers only.", 403);
}

/**
 * The photos for an event's Location card, or null when this viewer may not
 * see them (unassigned or declined staff). Admins and managers also get the
 * hidden ones and which bar setup photos are already kept. This event's own
 * photos follow its current address, so an address change moves them to the
 * new venue and rechecks the carried over ones.
 */
export async function venuePhotosFor(session: SessionLike, viewer: Viewer, assignment: { status: string } | null): Promise<VenuePhotoView | null> {
  if (!canViewVenuePhotos(viewer, assignment)) return null;
  const canManage = canManageVenuePhotos(viewer);
  const key = venueKey(session.event_data?.event_address);
  const own = await ownRows(session.id);
  if (!own) return EMPTY(canManage, false); // before the migration

  const stale = own.filter((r) => r.venue_key !== key);
  if (stale.length) {
    await supabase.from("venue_photos").update({ venue_key: key }).eq("session_id", session.id).neq("venue_key", key);
    for (const r of stale) r.venue_key = key;
  }

  let past: PhotoRow[] = [];
  if (key) {
    const { data } = await supabase.from("venue_photos").select("*").eq("venue_key", key).order("created_at", { ascending: false });
    const seen = new Set(own.map((r) => r.photo_path));
    past = live((data as PhotoRow[]) ?? []).filter((r) => {
      if (r.session_id === session.id || seen.has(r.photo_path)) return false;
      seen.add(r.photo_path);
      return true;
    });
  }
  const hides = past.length ? await hiddenIds(session.id) : new Set<string>();
  const shownPast = past.filter((r) => !hides.has(r.id));
  const hiddenPast = canManage ? past.filter((r) => hides.has(r.id)) : [];

  const rows = [...own, ...shownPast, ...hiddenPast];
  const urls = await signedUrls(rows.map((r) => r.photo_path));
  const shape = (r: PhotoRow): VenuePhoto => ({ id: r.id, url: urls.get(r.photo_path) ?? null, caption: r.caption ?? "", addedAt: r.created_at, source: r.source });
  return {
    ready: true,
    canManage,
    own: own.map(shape),
    past: shownPast.map(shape),
    hidden: hiddenPast.map(shape),
    keptBarReports: canManage ? own.map((r) => r.bar_report_id).filter((id): id is string => !!id) : [],
  };
}

async function hiddenIds(sessionId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("venue_photo_hides").select("photo_id").eq("session_id", sessionId);
  if (error || !data) return new Set();
  return new Set((data as { photo_id: string }[]).map((h) => h.photo_id));
}

async function nextPosition(own: PhotoRow[]): Promise<number> {
  return own.reduce((m, r) => Math.max(m, r.position), -1) + 1;
}

async function ownOrThrow(sessionId: string): Promise<PhotoRow[]> {
  const own = await ownRows(sessionId);
  if (!own) throw new VenuePhotoError(NOT_READY, 503);
  return own;
}

export interface PhotoFile {
  blob: Blob;
  type: string; // already read from the name when the phone sent none
}

/** A photo's type and size, against the bar setup photo limits. */
export function photoFileError(f: { type: string; size: number } | null): string | null {
  if (!f || f.size <= 0) return "Add a photo.";
  if (!PHOTO_TYPES.includes(f.type.toLowerCase())) return "That file is not a photo. Take or choose a photo.";
  if (f.size > MAX_PHOTO_BYTES) return "That photo is too large. Try again.";
  return null;
}

/** Upload one photo with its optional caption, at the end of this event's photos. */
export async function addVenuePhoto(opts: { session: SessionLike; staff: Viewer; file: PhotoFile; caption: unknown; at?: Date }): Promise<void> {
  manager(opts.staff);
  const bad = photoFileError({ type: opts.file.type, size: opts.file.blob.size });
  if (bad) throw new VenuePhotoError(bad, 400);
  const own = await ownOrThrow(opts.session.id);
  if (own.length >= MAX_EVENT_VENUE_PHOTOS) throw new VenuePhotoError(`Up to ${MAX_EVENT_VENUE_PHOTOS} photos on one event. Delete one first.`, 409);
  const at = opts.at ?? new Date();
  const path = venuePhotoPath(opts.session.id, at, photoExtension(opts.file.type), Math.floor(Math.random() * 1e6));
  const { error: upErr } = await supabase.storage.from(BAR_PHOTO_BUCKET).upload(path, opts.file.blob, { contentType: opts.file.type, upsert: false });
  if (upErr) throw new Error(`venue photo upload failed: ${upErr.message}`);
  const { error } = await supabase.from("venue_photos").insert({
    venue_key: venueKey(opts.session.event_data?.event_address),
    session_id: opts.session.id,
    photo_path: path,
    caption: cleanCaption(opts.caption),
    position: await nextPosition(own),
    source: "upload",
    added_by: opts.staff.id,
  });
  if (error) throw new Error(`venue photo save failed: ${error.message}`);
}

function findOwn(own: PhotoRow[], photoId: unknown): PhotoRow {
  const row = own.find((r) => r.id === photoId);
  if (!row) throw new VenuePhotoError("That photo is no longer on this event. Reload the page.", 404);
  return row;
}

export async function setVenueCaption(sessionId: string, staff: Viewer, photoId: unknown, caption: unknown): Promise<void> {
  manager(staff);
  const row = findOwn(await ownOrThrow(sessionId), photoId);
  const { error } = await supabase.from("venue_photos").update({ caption: cleanCaption(caption) }).eq("id", row.id);
  if (error) throw new Error(`venue caption failed: ${error.message}`);
}

export async function reorderVenuePhotos(sessionId: string, staff: Viewer, ids: unknown): Promise<void> {
  manager(staff);
  const own = await ownOrThrow(sessionId);
  const next = reorderIds(own.map((r) => r.id), ids);
  if (!next) throw new VenuePhotoError("Bad request", 400);
  await Promise.all(
    next.map((id, position) => (own.find((r) => r.id === id)!.position === position ? null : supabase.from("venue_photos").update({ position }).eq("id", id)))
  );
}

/** Delete from the event and the venue. The file stays in the private bucket and stops showing, like a removed bar setup photo. */
export async function deleteVenuePhoto(sessionId: string, staff: Viewer, photoId: unknown): Promise<void> {
  manager(staff);
  const row = findOwn(await ownOrThrow(sessionId), photoId);
  const { error } = await supabase.from("venue_photos").update({ removed_at: new Date().toISOString() }).eq("id", row.id);
  if (error) throw new Error(`venue photo delete failed: ${error.message}`);
}

/** Hide (or show again) a carried over photo for this event only. It stays on the venue for other events. */
export async function hidePastPhoto(session: SessionLike, staff: Viewer, photoId: unknown, hide: boolean): Promise<void> {
  manager(staff);
  await ownOrThrow(session.id);
  const key = venueKey(session.event_data?.event_address);
  const { data } = typeof photoId === "string" ? await supabase.from("venue_photos").select("*").eq("id", photoId).maybeSingle() : { data: null };
  const row = data as PhotoRow | null;
  if (!row || row.removed_at || !key || row.venue_key !== key || row.session_id === session.id) {
    throw new VenuePhotoError("That photo is not from a past event at this address.", 404);
  }
  if (hide) {
    const { error } = await supabase.from("venue_photo_hides").upsert({ session_id: session.id, photo_id: row.id, hidden_by: staff.id }, { onConflict: "session_id,photo_id", ignoreDuplicates: true });
    if (error) throw new Error(`venue photo hide failed: ${error.message}`);
  } else {
    const { error } = await supabase.from("venue_photo_hides").delete().eq("session_id", session.id).eq("photo_id", row.id);
    if (error) throw new Error(`venue photo show failed: ${error.message}`);
  }
}

/**
 * Keep one of this event's bar setup photos as a venue photo: the same file,
 * no copy, with an empty caption (the bartender's note is not carried over,
 * so nothing about the client lands on a venue photo by itself).
 */
export async function keepBarPhoto(session: SessionLike, staff: Viewer, reportId: unknown): Promise<void> {
  manager(staff);
  const own = await ownOrThrow(session.id);
  if (typeof reportId !== "string") throw new VenuePhotoError("Bad request", 400);
  const { data } = await supabase.from("bar_ready_reports").select("*").eq("id", reportId).maybeSingle();
  const report = data as { id: string; session_id: string; photo_path: string; removed_at?: string | null } | null;
  if (!report || report.session_id !== session.id || report.removed_at) throw new VenuePhotoError("That bar setup photo is no longer on this event.", 404);
  if (own.some((r) => r.bar_report_id === report.id)) return; // already kept
  if (own.length >= MAX_EVENT_VENUE_PHOTOS) throw new VenuePhotoError(`Up to ${MAX_EVENT_VENUE_PHOTOS} photos on one event. Delete one first.`, 409);
  const { error } = await supabase.from("venue_photos").insert({
    venue_key: venueKey(session.event_data?.event_address),
    session_id: session.id,
    photo_path: report.photo_path,
    caption: "",
    position: await nextPosition(own),
    source: "bar_setup",
    bar_report_id: report.id,
    added_by: staff.id,
  });
  if (error) throw new Error(`venue photo keep failed: ${error.message}`);
}
