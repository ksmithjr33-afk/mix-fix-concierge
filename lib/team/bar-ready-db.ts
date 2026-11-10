// Database and storage side of the "Bar is ready" check in. Server only.
// Photos live in a private bucket and are only shown through signed URLs,
// created after the caller has passed the event access check.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { activeAdmins, checkSnapshot, hasMissingReports } from "@/lib/team/events";
import { sendStaffText } from "@/lib/team/sms";
import {
  BAR_PHOTO_BUCKET,
  barReadyText,
  groupReports,
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
}

export interface BarReadyPhoto {
  id: string;
  url: string | null;
  note: string;
  createdAt: string;
  checked: number;
  total: number;
}

/** One person's check in: their latest photo first, then earlier ones they replaced. */
export interface BarReadyEntry {
  staffId: string;
  staffFirstName: string;
  mine: boolean;
  photos: BarReadyPhoto[];
}

const COLUMNS =
  "id, session_id, staff_id, photo_path, note, checklist_checked, checklist_total, shopping_checked, shopping_total, missing_reported, created_at";

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
  const rows = data as ReportRow[];
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
}): Promise<void> {
  const { session, staff } = opts;
  const now = new Date();
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

  if ((earlier.count ?? 0) > 0) return; // a replacement photo: admins already got the text
  const totals = snapshotTotals(snap);
  const message = barReadyText({
    firstName: firstName(staff.name),
    eventTitle: eventTitle(session.event_data ?? {}),
    checked: totals.checked,
    total: totals.total,
    missingReported: missing,
    link: opts.eventLink,
  });
  const admins = await activeAdmins();
  await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
}
