// Announcement drafts: the database side. Server only.
//
// Only admins and managers can see, save, send, test or delete a draft, and
// any of them can work on any draft. A draft has no recipient rows, so saving
// one never texts anyone, never adds to an unread count and never shows to
// staff. Sending goes through the same path as a new announcement
// (sendAnnouncement), quiet hours and Send now included, and marks the draft
// sent. "Send a test to me" texts only the person asking and changes nothing.
//
// Before the migration runs every read here comes back empty, so the page
// still loads; saving says drafts are not set up yet.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { sendStaffText } from "@/lib/team/sms";
import { siteOrigin } from "@/lib/team/clock-db";
import { isAdminRole } from "@/lib/team/roles";
import { announcementText, validateAnnouncement } from "@/lib/team/announcements";
import { sendAnnouncement } from "@/lib/team/announcements-db";
import { attachmentHref } from "@/lib/team/media-db";
import { draftIsEmpty, draftToAnnouncement, isDraftId, isNewerEditByOther, validateDraft, type DraftRow } from "@/lib/team/announcement-drafts";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number; conflict?: DraftConflict; needsConfirm?: boolean };

export interface DraftConflict {
  by: string; // who saved it
  at: string; // when
  draft: DraftItem; // their version, so the writer can load it
}

export interface DraftItem {
  id: string;
  title: string;
  body: string;
  audience: "everyone" | "markets";
  markets: string[];
  bartendersOnly: boolean;
  sendNow: boolean;
  attachment: { id: string; kind: "gif" | "photo"; url: string } | null;
  createdBy: string | null;
  authorName: string;
  updatedBy: string | null;
  updatedByName: string;
  updatedAt: string;
}

const NOT_READY = "Drafts are not set up yet. Ask an admin to run the latest database update.";
const GONE = "That draft was already sent or deleted.";

export function draftPreviewLink(id: string): string {
  return `${siteOrigin()}/team/announcements/drafts/${encodeURIComponent(id)}`;
}

async function names(ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const { data } = await supabase.from("staff").select("id, name").in("id", want);
  return new Map(((data as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name]));
}

async function pictures(ids: (string | null)[]): Promise<Map<string, { kind: "gif" | "photo"; status: string }>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const { data, error } = await supabase.from("team_attachments").select("id, kind, status").in("id", want);
  if (error || !data) return new Map();
  return new Map((data as { id: string; kind: "gif" | "photo"; status: string }[]).map((a) => [a.id, { kind: a.kind, status: a.status }]));
}

async function toItems(rows: DraftRow[]): Promise<DraftItem[]> {
  const who = await names(rows.flatMap((r) => [r.created_by, r.updated_by]));
  const pics = await pictures(rows.map((r) => r.attachment_id));
  return rows.map((r) => {
    const pic = r.attachment_id ? pics.get(r.attachment_id) : undefined;
    return {
      id: r.id,
      title: r.title ?? "",
      body: r.body ?? "",
      audience: r.audience === "markets" ? "markets" : "everyone",
      markets: r.markets ?? [],
      bartendersOnly: !!r.bartenders_only,
      sendNow: !!r.send_now,
      attachment: r.attachment_id && pic && pic.status === "pending" ? { id: r.attachment_id, kind: pic.kind, url: attachmentHref(r.attachment_id) } : null,
      createdBy: r.created_by,
      authorName: (r.created_by && who.get(r.created_by)) || "Former staff",
      updatedBy: r.updated_by,
      updatedByName: (r.updated_by && who.get(r.updated_by)) || "Former staff",
      updatedAt: r.updated_at,
    };
  });
}

async function draftRow(id: string): Promise<{ row: DraftRow | null; error: boolean }> {
  const { data, error } = await supabase.from("announcement_drafts").select("*").eq("id", id).maybeSingle();
  if (error) return { row: null, error: true };
  return { row: (data as DraftRow | null) ?? null, error: false };
}

/** Open drafts, last saved first. Admins and managers only; empty for everyone else and before the migration. */
export async function draftsFor(staff: StaffMember): Promise<DraftItem[]> {
  if (!isAdminRole(staff.role)) return [];
  const { data, error } = await supabase.from("announcement_drafts").select("*").eq("status", "draft").order("updated_at", { ascending: false });
  if (error || !data) return [];
  const rows = (data as DraftRow[]).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return toItems(rows);
}

/** One open draft, for the test view. Null for staff, or when it is not an open draft. */
export async function draftFor(staff: StaffMember, id: string): Promise<DraftItem | null> {
  if (!isAdminRole(staff.role) || !isDraftId(id)) return null;
  const { row } = await draftRow(id);
  if (!row || row.status !== "draft") return null;
  return (await toItems([row]))[0];
}

/** The picture may go on a draft: a pending announcement upload, this person's own or already on this draft. */
async function pictureAllowed(staff: StaffMember, id: string, current: string | null): Promise<boolean> {
  if (id === current) return true;
  const { data, error } = await supabase.from("team_attachments").select("id, scope, status, uploaded_by").eq("id", id).maybeSingle();
  if (error || !data) return false;
  const a = data as { scope: string; status: string; uploaded_by: string | null };
  return a.scope === "announcement" && a.status === "pending" && a.uploaded_by === staff.id;
}

async function conflictOf(row: DraftRow): Promise<DraftConflict> {
  const item = (await toItems([row]))[0];
  return { by: item.updatedByName, at: row.updated_at, draft: item };
}

/**
 * Save the form as a draft: { id, title, body, audience, markets,
 * bartendersOnly, sendNow, attachmentId, baseUpdatedAt, force }. The browser
 * picks the id of a new draft, so a repeated save (autosave, or a save sent as
 * the page closes) never makes two. Refused with the newer version when
 * someone else saved after baseUpdatedAt, unless force (the writer chose
 * "Keep mine" after the warning).
 */
export async function saveDraft(staff: StaffMember, raw: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ id: string; updatedAt: string }>> {
  if (!isAdminRole(staff.role) || !staff.active) return { ok: false, error: "Admins only.", status: 403 };
  if (!isDraftId(raw.id)) return { ok: false, error: "Bad request", status: 400 };
  const v = validateDraft(raw);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const d = v.value;
  const base = typeof raw.baseUpdatedAt === "string" ? raw.baseUpdatedAt : null;
  const force = raw.force === true;
  const fields = {
    title: d.title,
    body: d.body,
    audience: d.audience,
    markets: d.audience === "markets" ? d.markets : [],
    bartenders_only: d.bartendersOnly,
    send_now: d.sendNow,
    attachment_id: d.attachmentId,
    updated_by: staff.id,
    updated_at: now.toISOString(),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const found = await draftRow(raw.id);
    if (found.error) return { ok: false, error: NOT_READY, status: 503 };
    const row = found.row;
    if (!row) {
      if (draftIsEmpty(d)) return { ok: false, error: "Write something first.", status: 400 };
      if (d.attachmentId && !(await pictureAllowed(staff, d.attachmentId, null))) return { ok: false, error: "That picture did not upload. Attach it again.", status: 400 };
      const { error } = await supabase.from("announcement_drafts").insert({ id: raw.id, ...fields, status: "draft", created_by: staff.id, created_at: now.toISOString() });
      if (!error) return { ok: true, id: raw.id, updatedAt: fields.updated_at };
      continue; // someone saved it first (the same draft from another tab): check again
    }
    if (row.status !== "draft") return { ok: false, error: GONE, status: 410 };
    if (!force && isNewerEditByOther(row, staff.id, base)) {
      return { ok: false, error: "Someone else saved this draft after you opened it.", status: 409, conflict: await conflictOf(row) };
    }
    if (d.attachmentId && !(await pictureAllowed(staff, d.attachmentId, row.attachment_id))) return { ok: false, error: "That picture did not upload. Attach it again.", status: 400 };
    // Compare and set: only if nobody saved in between.
    const { data, error } = await supabase.from("announcement_drafts").update(fields).eq("id", row.id).eq("status", "draft").eq("updated_at", row.updated_at).select("id");
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    if (((data as unknown[]) ?? []).length === 1) return { ok: true, id: row.id, updatedAt: fields.updated_at };
  }
  const again = await draftRow(raw.id);
  if (again.row && again.row.status === "draft" && again.row.updated_by !== staff.id) {
    return { ok: false, error: "Someone else saved this draft after you opened it.", status: 409, conflict: await conflictOf(again.row) };
  }
  return { ok: false, error: "Could not save. Try again.", status: 500 };
}

/** Delete a draft. It is marked deleted, so a late autosave cannot bring it back. */
export async function deleteDraft(staff: StaffMember, id: unknown, now: Date = new Date()): Promise<Result> {
  if (!isAdminRole(staff.role) || !staff.active) return { ok: false, error: "Admins only.", status: 403 };
  if (!isDraftId(id)) return { ok: false, error: "Bad request", status: 400 };
  const { data, error } = await supabase
    .from("announcement_drafts")
    .update({ status: "deleted", updated_by: staff.id, updated_at: now.toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: NOT_READY, status: 503 };
  if (((data as unknown[]) ?? []).length === 0) return { ok: false, error: GONE, status: 410 };
  return { ok: true };
}

/**
 * Send a draft to staff: { id, baseUpdatedAt, confirmOthers }. Follows every
 * rule of a new announcement (title and message required, audience, quiet
 * hours, Send now). A draft written by someone else needs confirmOthers.
 * Refused when someone saved it after baseUpdatedAt, so nobody sends a version
 * they have not seen. Claimed first, so two admins cannot send it twice.
 */
export async function sendDraft(
  staff: StaffMember,
  raw: { id?: unknown; baseUpdatedAt?: unknown; confirmOthers?: unknown },
  now: Date = new Date()
): Promise<Result<{ announcementId: string; recipients: number; texted: number; held: number }>> {
  if (!isAdminRole(staff.role) || !staff.active) return { ok: false, error: "Admins only.", status: 403 };
  if (!isDraftId(raw.id)) return { ok: false, error: "Bad request", status: 400 };
  const found = await draftRow(raw.id);
  if (found.error) return { ok: false, error: NOT_READY, status: 503 };
  const row = found.row;
  if (!row || row.status !== "draft") return { ok: false, error: GONE, status: 410 };
  if (row.created_by !== staff.id && raw.confirmOthers !== true) {
    const who = (await names([row.created_by])).get(row.created_by ?? "") ?? "someone else";
    return { ok: false, error: `This draft was written by ${who}. Confirm to send it.`, status: 409, needsConfirm: true };
  }
  const base = typeof raw.baseUpdatedAt === "string" ? raw.baseUpdatedAt : null;
  if (base && new Date(row.updated_at).getTime() !== new Date(base).getTime()) {
    return { ok: false, error: "This draft changed since you opened it. Open it to check before sending.", status: 409, conflict: await conflictOf(row) };
  }
  const shaped = draftToAnnouncement(row);
  if ("error" in shaped) return { ok: false, error: String(shaped.error), status: 400 };
  const v = validateAnnouncement(shaped);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  // Claim it so a second send (another admin, a double tap) finds nothing.
  const { data: claimed, error: cErr } = await supabase
    .from("announcement_drafts")
    .update({ status: "sending" })
    .eq("id", row.id)
    .eq("status", "draft")
    .eq("updated_at", row.updated_at)
    .select("id");
  if (cErr) return { ok: false, error: "Could not send. Try again.", status: 500 };
  if (((claimed as unknown[]) ?? []).length === 0) return { ok: false, error: "This draft changed or was sent a moment ago. Check the list and try again.", status: 409 };
  const r = await sendAnnouncement(staff, v.value, row.attachment_id ? { id: row.attachment_id, anyUploader: true } : null, now);
  if (!r.ok) {
    await supabase.from("announcement_drafts").update({ status: "draft" }).eq("id", row.id).eq("status", "sending");
    return r;
  }
  await supabase.from("announcement_drafts").update({ status: "sent", announcement_id: r.id }).eq("id", row.id);
  return { ok: true, announcementId: r.id, recipients: r.recipients, texted: r.texted, held: r.held };
}

/**
 * "Send a test to me": the same text staff would get, to the person asking
 * only, right away, with a link to the draft shown the way staff will see it.
 * Nobody else is texted and the draft is not changed.
 */
export async function testDraft(staff: StaffMember, id: unknown): Promise<Result<{ to: string }>> {
  if (!isAdminRole(staff.role) || !staff.active) return { ok: false, error: "Admins only.", status: 403 };
  if (!isDraftId(id)) return { ok: false, error: "Bad request", status: 400 };
  const found = await draftRow(id);
  if (found.error) return { ok: false, error: NOT_READY, status: 503 };
  const row = found.row;
  if (!row || row.status !== "draft") return { ok: false, error: GONE, status: 410 };
  if (!row.title.trim()) return { ok: false, error: "Add a title.", status: 400 };
  if (!row.body.trim()) return { ok: false, error: "Add a message.", status: 400 };
  const { data: me } = await supabase.from("staff").select("id, name, phone").eq("id", staff.id).maybeSingle();
  const person = (me as { name: string; phone: string } | null) ?? null;
  if (!person?.phone) return { ok: false, error: "Add your phone number to your profile first.", status: 400 };
  const pic = row.attachment_id ? (await pictures([row.attachment_id])).get(row.attachment_id) : undefined;
  const kind = pic && pic.status === "pending" ? pic.kind : null;
  const ok = await sendStaffText(person.phone, person.name, announcementText({ title: row.title, link: draftPreviewLink(row.id), attachment: kind }));
  if (!ok) return { ok: false, error: "The test text did not go through. Try again.", status: 502 };
  return { ok: true, to: person.phone };
}
