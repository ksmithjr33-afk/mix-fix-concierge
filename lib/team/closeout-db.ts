// Database side of post event closeouts. Server only.
//
// One closeout per bartender per event (unique), editable for 24 hours, with
// every save kept in event_closeout_versions. Photos go to the same private
// bucket as the bar ready photos and are only shown through signed URLs after
// the event access check. Texts go through sendStaffText and the GHL webhook
// never throws, so neither can block a save.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { alertAdmins, getSubmittedSession } from "@/lib/team/events";
import { assignmentRef, claimNotice, punchesFor, siteOrigin } from "@/lib/team/clock-db";
import { sendStaffText } from "@/lib/team/sms";
import { eventData } from "@/lib/team/markets";
import { eventDay } from "@/lib/team/time";
import { BAR_PHOTO_BUCKET, photoExtension, SIGNED_URL_SECONDS } from "@/lib/team/bar-ready";
import {
  canEdit,
  closeoutAlertText,
  closeoutOpen,
  closeoutPhotoPath,
  closeoutReminderText,
  closeoutWebhookPayload,
  CLOSEOUT_REMINDER_HOURS,
  CLOSEOUT_REMINDER_WINDOW_HOURS,
  editUntil,
  needsAlert,
  validateCloseout,
  type CloseoutInput,
  type Rating,
} from "@/lib/team/closeout";

export interface CloseoutRow {
  id: string;
  session_id: string;
  staff_id: string;
  rating: Rating;
  guest_estimate: number | null;
  issues: string;
  gear_items: string[];
  gear_note: string;
  leftover_note: string;
  photo_path: string;
  submitted_at: string;
  updated_at: string;
  edits: number;
}

interface VersionRow {
  id: string;
  closeout_id: string;
  version: number;
  data: Record<string, unknown>;
  photo_path: string;
  created_at: string;
}

export interface CloseoutView {
  id: string;
  staffId: string;
  staffFirstName: string;
  rating: Rating;
  guestEstimate: number | null;
  issues: string;
  gearItems: string[];
  gearNote: string;
  leftoverNote: string;
  photoUrl: string | null;
  submittedAt: string;
  updatedAt: string;
  editUntil: string;
  edits: number;
  versions: { version: number; at: string; rating: string; photoUrl: string | null }[]; // earlier saves, newest first (admins)
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export interface CloseoutState {
  open: boolean; // the card shows and can be sent
  clockedOut: boolean;
  canSubmit: boolean; // assigned and accepted, open, and inside the edit window
  mine: CloseoutView | null;
}

async function signed(paths: string[]): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter(Boolean))];
  if (list.length === 0) return new Map();
  const { data, error } = await supabase.storage.from(BAR_PHOTO_BUCKET).createSignedUrls(list, SIGNED_URL_SECONDS);
  if (error || !data) return new Map();
  return new Map(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl]));
}

async function closeoutRow(sessionId: string, staffId: string): Promise<CloseoutRow | null> {
  const { data, error } = await supabase.from("event_closeouts").select("*").eq("session_id", sessionId).eq("staff_id", staffId).maybeSingle();
  if (error) return null;
  return (data as CloseoutRow | null) ?? null;
}

function toView(r: CloseoutRow, name: string, urls: Map<string, string>, versions: VersionRow[]): CloseoutView {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffFirstName: name,
    rating: r.rating,
    guestEstimate: r.guest_estimate,
    issues: r.issues,
    gearItems: r.gear_items ?? [],
    gearNote: r.gear_note,
    leftoverNote: r.leftover_note,
    photoUrl: urls.get(r.photo_path) ?? null,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
    editUntil: editUntil(r.submitted_at).toISOString(),
    edits: r.edits ?? 0,
    versions: versions
      .filter((v) => v.closeout_id === r.id)
      .sort((a, b) => b.version - a.version)
      .slice(1)
      .map((v) => ({ version: v.version, at: v.created_at, rating: String(v.data.rating ?? ""), photoUrl: urls.get(v.photo_path) ?? null })),
  };
}

/** Whether a clock out was recorded for this person on the event. */
async function clockedOutOn(sessionId: string, staffId: string): Promise<boolean> {
  const a = await assignmentRef(sessionId, staffId);
  if (!a) return false;
  return (await punchesFor(a.id)).some((p) => p.type === "out");
}

/** The closeout card for one bartender. Call after the event access check. */
export async function closeoutState(session: SessionRow, staff: StaffMember, now: Date = new Date()): Promise<CloseoutState> {
  const a = staff.role === "admin" ? null : await assignmentRef(session.id, staff.id);
  const accepted = a?.status === "accepted";
  const clockedOut = accepted ? await clockedOutOn(session.id, staff.id) : false;
  const open = accepted && closeoutOpen(eventData(session), { clockedOut, now });
  const row = accepted ? await closeoutRow(session.id, staff.id) : null;
  const urls = row ? await signed([row.photo_path]) : new Map<string, string>();
  return {
    open: open || !!row,
    clockedOut,
    canSubmit: open && canEdit(row?.submitted_at ?? null, now),
    mine: row ? toView(row, firstName(staff.name), urls, []) : null,
  };
}

/** Every closeout for the event, for the admin event page, with earlier saves. */
export async function closeoutsFor(sessionId: string): Promise<CloseoutView[]> {
  const { data, error } = await supabase.from("event_closeouts").select("*").eq("session_id", sessionId);
  if (error || !data) return [];
  const rows = (data as CloseoutRow[]).sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  if (rows.length === 0) return [];
  const [{ data: vs }, { data: people }] = await Promise.all([
    supabase.from("event_closeout_versions").select("*").in("closeout_id", rows.map((r) => r.id)),
    supabase.from("staff").select("id, name").in("id", rows.map((r) => r.staff_id)),
  ]);
  const versions = (vs as VersionRow[]) ?? [];
  const names = new Map(((people as { id: string; name: string }[]) ?? []).map((p) => [p.id, firstName(p.name)]));
  const urls = await signed([...rows.map((r) => r.photo_path), ...versions.map((v) => v.photo_path)]);
  return rows.map((r) => toView(r, names.get(r.staff_id) || "Bartender", urls, versions));
}

/** Send GHL the follow up webhook for the event, once, on the first closeout. Never throws. */
export async function sendCloseoutWebhook(session: SessionRow, rating: Rating, closeouts: number): Promise<"sent" | "skipped" | "failed"> {
  const url = process.env.GHL_EVENT_CLOSEOUT_WEBHOOK;
  if (!url) {
    console.log("[team] GHL_EVENT_CLOSEOUT_WEBHOOK is not set, skipping the closeout webhook");
    return "skipped";
  }
  if (!(await claimNotice(`closeout_webhook:${session.id}`, "closeout_webhook"))) return "skipped";
  const ed = eventData(session);
  const payload = closeoutWebhookPayload({
    clientEmail: ed.client_email ?? (session as { email?: string | null }).email,
    eventDate: eventDay(ed.event_date ?? session.event_date),
    eventTitle: eventTitle(ed),
    rating,
    closeouts,
  });
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      console.error("[team] closeout webhook failed:", res.status);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("[team] closeout webhook failed:", err instanceof Error ? err.message : String(err));
    return "failed";
  }
}

/**
 * Save a bartender's closeout: the first submit or an edit inside 24 hours.
 * Every save adds a version row. Admins with alerts on are texted right away
 * when it had problems or gear is broken or missing (once per closeout). The
 * first closeout for the event sends GHL the follow up webhook.
 */
export async function submitCloseout(opts: {
  sessionId: string;
  staff: StaffMember;
  raw: Record<string, unknown>;
  photo: Blob | null;
  photoType: string;
  now?: Date;
}): Promise<Result<{ closeout: CloseoutView; first: boolean }>> {
  const now = opts.now ?? new Date();
  const { staff } = opts;
  const session = await getSubmittedSession(opts.sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const a = await assignmentRef(session.id, staff.id);
  if (!a || a.status !== "accepted") return { ok: false, error: "Only a bartender on this event can send its closeout.", status: 403 };
  const clockedOut = await clockedOutOn(session.id, staff.id);
  if (!closeoutOpen(eventData(session), { clockedOut, now })) {
    return { ok: false, error: "The closeout opens after you clock out, or 30 minutes before service ends.", status: 403 };
  }
  const existing = await closeoutRow(session.id, staff.id);
  if (existing && !canEdit(existing.submitted_at, now)) return { ok: false, error: "Closeouts can be edited for 24 hours. This one is locked now.", status: 409 };

  const photo = opts.photo && opts.photo.size > 0 ? opts.photo : null;
  const v = validateCloseout(opts.raw, photo ? { type: opts.photoType, size: photo.size } : null, { hasPhoto: !!existing?.photo_path });
  if (!v.ok) return { ok: false, error: v.error, status: 400 };

  let photoPath = existing?.photo_path ?? "";
  if (photo) {
    photoPath = closeoutPhotoPath(session.id, staff.id, now, photoExtension(opts.photoType));
    const { error: upErr } = await supabase.storage.from(BAR_PHOTO_BUCKET).upload(photoPath, photo, { contentType: opts.photoType, upsert: false });
    if (upErr) {
      console.error("[team] closeout photo upload failed:", upErr.message);
      return { ok: false, error: "The photo did not upload. Tap Retry.", status: 500 };
    }
  }

  const fields = {
    rating: v.value.rating,
    guest_estimate: v.value.guestEstimate,
    issues: v.value.issues,
    gear_items: v.value.gearItems,
    gear_note: v.value.gearNote,
    leftover_note: v.value.leftoverNote,
    photo_path: photoPath,
    updated_at: now.toISOString(),
  };
  let row: CloseoutRow;
  if (existing) {
    const { data, error } = await supabase
      .from("event_closeouts")
      .update({ ...fields, edits: (existing.edits ?? 0) + 1 })
      .eq("id", existing.id)
      .eq("updated_at", existing.updated_at) // two phones saving at once: the second one retries
      .select("*");
    const rows = (data as CloseoutRow[]) ?? [];
    if (error || rows.length === 0) return { ok: false, error: "Someone saved this closeout at the same time. Reload and try again.", status: 409 };
    row = rows[0];
  } else {
    const { data, error } = await supabase
      .from("event_closeouts")
      .insert({ session_id: session.id, staff_id: staff.id, assignment_id: a.id, ...fields, submitted_at: now.toISOString(), edits: 0 })
      .select("*")
      .single();
    if (error || !data) {
      if (photo) await supabase.storage.from(BAR_PHOTO_BUCKET).remove([photoPath]);
      return { ok: false, error: /duplicate|unique/i.test(error?.message ?? "") ? "Your closeout is already in. Reload to edit it." : "Could not save. Try again.", status: 409 };
    }
    row = data as CloseoutRow;
  }

  const { data: count } = await supabase.from("event_closeout_versions").select("id").eq("closeout_id", row.id);
  const { error: vErr } = await supabase.from("event_closeout_versions").insert({
    closeout_id: row.id,
    version: ((count as unknown[]) ?? []).length + 1,
    data: { ...fields },
    photo_path: photoPath,
    edited_by: staff.id,
    created_at: now.toISOString(),
  });
  if (vErr) console.error("[team] closeout version save failed:", vErr.message);

  await afterSave(session, staff, row, v.value, !existing);
  const urls = await signed([row.photo_path]);
  return { ok: true, first: !existing, closeout: toView(row, firstName(staff.name), urls, []) };
}

/** Admin alerts and the GHL webhook. Never throws. */
async function afterSave(session: SessionRow, staff: StaffMember, row: CloseoutRow, c: CloseoutInput, first: boolean): Promise<void> {
  try {
    if (needsAlert(c) && (await claimNotice(`closeout_alert:${row.id}`, "closeout_alert"))) {
      const message = closeoutAlertText({ firstName: firstName(staff.name), title: eventTitle(eventData(session)), c, link: `${siteOrigin()}/team/admin/e/${session.id}` });
      const admins = await alertAdmins();
      await Promise.all(admins.map((ad) => sendStaffText(ad.phone, ad.name, message)));
    }
    if (first) {
      const { data } = await supabase.from("event_closeouts").select("id").eq("session_id", session.id);
      await sendCloseoutWebhook(session, c.rating, ((data as unknown[]) ?? []).length || 1);
    }
  } catch (err) {
    console.error("[team] closeout follow up failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * One text to each bartender who clocked out 2 or more hours ago and has not
 * sent a closeout. Clock outs older than a day are left alone. Returns texts sent.
 */
export async function sendCloseoutReminders(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - CLOSEOUT_REMINDER_WINDOW_HOURS * 3_600_000).toISOString();
  const { data, error } = await supabase.from("time_punches").select("assignment_id, staff_id, session_id, punched_at, type").eq("type", "out").gte("punched_at", since);
  if (error || !data) return 0;
  let sent = 0;
  for (const p of data as { assignment_id: string; staff_id: string; session_id: string; punched_at: string }[]) {
    if (now.getTime() - new Date(p.punched_at).getTime() < CLOSEOUT_REMINDER_HOURS * 3_600_000) continue;
    if (await closeoutRow(p.session_id, p.staff_id)) continue;
    const session = await getSubmittedSession(p.session_id);
    if (!session) continue;
    const a = await assignmentRef(p.session_id, p.staff_id);
    if (!a || a.status !== "accepted") continue;
    const { data: s } = await supabase.from("staff").select("id, name, phone, active").eq("id", p.staff_id).maybeSingle();
    const person = s as { name: string; phone: string; active: boolean } | null;
    if (!person || !person.active) continue;
    if (!(await claimNotice(`closeout_reminder:${p.assignment_id}`, "closeout_reminder"))) continue;
    const ok = await sendStaffText(person.phone, person.name, closeoutReminderText({ firstName: firstName(person.name), title: eventTitle(eventData(session)), link: `${siteOrigin()}/team/e/${p.session_id}` }));
    if (ok) sent++;
  }
  return sent;
}
