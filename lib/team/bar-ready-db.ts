// Database and storage side of the "Bar is ready" check in. Server only.
// Photos live in a private bucket and are only shown through signed URLs,
// created after the caller has passed the event access check.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { alertAdmins, checkSnapshot, hasMissingReports } from "@/lib/team/events";
import { sendStaffText } from "@/lib/team/sms";
import {
  BAR_PHOTO_BUCKET,
  barReadyText,
  groupReports,
  photoLimitError,
  photoPath,
  SIGNED_URL_SECONDS,
  snapshotTotals,
} from "@/lib/team/bar-ready";

interface ReportRow {
  id: string;
  session_id: string;
  staff_id: string;
  photo_path: string;
  note: string;
  checklist_checked: number;
  checklist_total: number;
  shopping_checked: number;
  shopping_total: number;
  missing_reported: boolean;
  created_at: string;
  removed_at?: string | null;
}

export interface BarReadyPhoto {
  id: string;
  url: string | null;
  note: string;
  createdAt: string;
  checked: number;
  total: number;
}

/** One person's bar setup photos (up to 4), newest first. Removed and retaken ones are kept in storage but not shown. */
export interface BarReadyEntry {
  staffId: string;
  staffFirstName: string;
  mine: boolean;
  photos: BarReadyPhoto[];
}

const COLUMNS = "*"; // removed_at is read once the column exists

async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await supabase.storage.from(BAR_PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error || !data) {
    console.error("bar photo signed urls failed:", error?.message);
    return new Map();
  }
  return new Map(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl]));
}

async function staffNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("staff").select("id, name").in("id", ids);
  return new Map(((data as { id: string; name: string }[]) ?? []).map((s) => [s.id, firstName(s.name)]));
}

/** Every check in for the event. Call only after the event access check has passed. */
export async function barReadyEntries(sessionId: string, viewer: StaffMember): Promise<BarReadyEntry[]> {
  const { data, error } = await supabase
    .from("bar_ready_reports")
    .select(COLUMNS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  if (error || !data) return []; // before the table exists
  const rows = (data as ReportRow[]).filter((r) => !r.removed_at);
  const [urls, names] = await Promise.all([signedUrls(rows.map((r) => r.photo_path)), staffNames([...new Set(rows.map((r) => r.staff_id))])]);
  return groupReports(rows).map((group) => ({
    staffId: group[0].staff_id,
    staffFirstName: names.get(group[0].staff_id) || "Bartender",
    mine: group[0].staff_id === viewer.id,
    photos: group.map((r) => ({
      id: r.id,
      url: urls.get(r.photo_path) ?? null,
      note: r.note,
      createdAt: r.created_at,
      ...snapshotTotals({
        checklistChecked: r.checklist_checked,
        checklistTotal: r.checklist_total,
        shoppingChecked: r.shopping_checked,
        shoppingTotal: r.shopping_total,
      }),
    })),
  }));
}

/**
 * Save a check in: upload the photo, store the row with a snapshot of the
 * checked counts, and on this person's first check in for the event, text
 * every admin. Replacements are stored as new rows and photos.
 */
export async function submitBarReady(opts: {
  session: SessionRow;
  staff: StaffMember;
  photo: Blob;
  photoType: string;
  note: string;
  eventLink: string;
  replaces?: string | null; // retake: the photo this one takes the place of
}): Promise<void> {
  const { session, staff } = opts;
  const now = new Date();
  const mine = await activePhotos(session.id, staff.id);
  const replacing = opts.replaces ? mine.find((r) => r.id === opts.replaces) ?? null : null;
  if (opts.replaces && !replacing) throw new BarPhotoError("That photo is no longer there. Reload the page.", 404);
  const limit = photoLimitError(mine.length, !!replacing);
  if (limit) throw new BarPhotoError(limit, 409);
  const path = photoPath(session.id, staff.id, now, opts.photoType);

  const { error: upErr } = await supabase.storage
    .from(BAR_PHOTO_BUCKET)
    .upload(path, opts.photo, { contentType: opts.photoType, upsert: false });
  if (upErr) throw new Error(`bar photo upload failed: ${upErr.message}`);

  const [snap, missing, earlier] = await Promise.all([
    checkSnapshot(session, staff),
    hasMissingReports(session.id),
    supabase.from("bar_ready_reports").select("id", { count: "exact", head: true }).eq("session_id", session.id).eq("staff_id", staff.id),
  ]);

  const { error } = await supabase.from("bar_ready_reports").insert({
    session_id: session.id,
    staff_id: staff.id,
    photo_path: path,
    note: opts.note,
    checklist_checked: snap.checklistChecked,
    checklist_total: snap.checklistTotal,
    shopping_checked: snap.shoppingChecked,
    shopping_total: snap.shoppingTotal,
    missing_reported: missing,
    created_at: now.toISOString(),
  });
  if (error) {
    await supabase.storage.from(BAR_PHOTO_BUCKET).remove([path]);
    throw new Error(`bar_ready_reports insert failed: ${error.message}`);
  }

  if (replacing) await supabase.from("bar_ready_reports").update({ removed_at: now.toISOString() }).eq("id", replacing.id);
  if ((earlier.count ?? 0) > 0) return; // another or a retaken photo: admins already got the text
  const totals = snapshotTotals(snap);
  const message = barReadyText({
    firstName: firstName(staff.name),
    eventTitle: eventTitle(session.event_data ?? {}),
    checked: totals.checked,
    total: totals.total,
    missingReported: missing,
    link: opts.eventLink,
  });
  const admins = await alertAdmins();
  await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
}

export class BarPhotoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** This person's photos still shown for the event. */
async function activePhotos(sessionId: string, staffId: string): Promise<ReportRow[]> {
  const { data, error } = await supabase.from("bar_ready_reports").select(COLUMNS).eq("session_id", sessionId).eq("staff_id", staffId);
  if (error || !data) return [];
  return (data as ReportRow[]).filter((r) => !r.removed_at);
}

/** Remove one of your own photos. It stays in the private bucket and stops showing. Returns false when it is not yours. */
export async function removeBarPhoto(sessionId: string, staff: StaffMember, photoId: string): Promise<boolean> {
  const mine = await activePhotos(sessionId, staff.id);
  if (!mine.some((r) => r.id === photoId)) return false;
  const { error } = await supabase.from("bar_ready_reports").update({ removed_at: new Date().toISOString() }).eq("id", photoId).eq("staff_id", staff.id);
  if (error) throw new Error(`bar photo remove failed: ${error.message}`);
  return true;
}

/** How many bar setup photos are in for the event, from anyone. */
export async function barPhotoCount(sessionId: string): Promise<number> {
  const { data, error } = await supabase.from("bar_ready_reports").select(COLUMNS).eq("session_id", sessionId);
  if (error || !data) return 0;
  return (data as ReportRow[]).filter((r) => !r.removed_at).length;
}
