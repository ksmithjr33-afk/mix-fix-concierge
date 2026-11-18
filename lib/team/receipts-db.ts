// Receipts from the database and storage. Server only.
//
// Rows live in event_receipts (supabase/migrations/20261223_receipts.sql).
// Until that migration runs every read comes back empty with ready false, so
// each page still loads, and uploading says the migration is needed.
//
// Photos go in the private bar photos bucket (same size limit, photo types
// and phone resizing as bar setup photos) and are only ever shown through
// short lived signed links, made after the caller passed the access check.
//
// Every rule is checked here, never only in the browser:
//   staff see only receipts they paid for, never anyone else's, never totals;
//   staff add, edit and delete their own only while the event is open to them
//     (on it, not declined, until 14 days after) and only while Submitted;
//   admins and managers read every receipt on an event and upload for anyone;
//   approve, Not approved and reopen are admins only.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { BAR_PHOTO_BUCKET, photoExtension, SIGNED_URL_SECONDS } from "@/lib/team/bar-ready";
import { signedUrls } from "@/lib/team/bar-ready-db";
import { photoFileError } from "@/lib/team/venue-photos-db";
import { eventData } from "@/lib/team/markets";
import { chicagoToday, eventSchedule } from "@/lib/team/time";
import { adminEventTitle } from "@/lib/team/event-list";
import { firstName, scrub } from "@/lib/team/event-view";
import { lineIsPaid, REIMBURSEMENTS_TABLE } from "@/lib/team/reimbursements-db";
import {
  canApproveReceipts,
  canManageReceipts,
  checkPhotoPaths,
  cleanReason,
  COMPANY,
  COMPANY_LABEL,
  duplicateMessage,
  findDuplicate,
  MANAGERS_CANNOT_APPROVE,
  ONLY_SUBMITTED,
  RECEIPTS_NOT_READY,
  receiptPhotoPath,
  receiptPhotoPrefix,
  receiptsOpenUntil,
  staffCanUseReceipts,
  validateReceipt,
  type ApprovedReceipt,
  type Payer,
  type ReceiptKind,
  type ReceiptListItem,
  type ReceiptStatus,
} from "@/lib/team/receipts";

export const RECEIPTS_TABLE = "event_receipts";

interface Viewer {
  id: string;
  name: string;
  role: unknown;
  active: boolean;
}

interface Assignment {
  id: string;
  status: string;
}

type SessionLike = Pick<SessionRow, "id"> & { event_data?: Record<string, unknown> | null };

export interface ReceiptRow {
  id: string;
  session_id: string;
  paid_by: Payer;
  staff_id: string | null;
  assignment_id: string | null;
  kind: ReceiptKind;
  amount_cents: number;
  note: string | null;
  photo_paths: string[];
  status: ReceiptStatus;
  reason: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at?: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  deleted_at?: string | null;
}

export interface ReceiptPhoto {
  url: string | null; // signed, short lived
  href: string; // the app link that opens it full size after the access check
}

export interface Receipt {
  id: string;
  sessionId: string;
  paidBy: Payer;
  staffId: string | null;
  personName: string; // the staff member, or "Company"
  kind: ReceiptKind;
  cents: number;
  note: string;
  status: ReceiptStatus;
  reason: string;
  createdAt: string;
  uploadedByName: string;
  reviewedByName: string;
  reviewedAt: string | null;
  photos: ReceiptPhoto[];
  photoPaths: string[]; // for editing: kept or removed by the person saving
  canEdit: boolean; // Submitted, and this viewer may change it
  paidLocked: boolean; // approved, and its reimbursement is already marked paid
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number; duplicate?: boolean };

const notReady = (message: string | undefined) => /does not exist|relation|schema cache|column/i.test(message ?? "");
const NOT_READY = { ok: false as const, error: RECEIPTS_NOT_READY, status: 503 };
const live = (rows: ReceiptRow[]) => rows.filter((r) => !r.deleted_at);

async function staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Map();
  const { data } = await supabase.from("staff").select("id, name").in("id", want);
  return new Map(((data as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name || "Staff"]));
}

/** Who may change a Submitted receipt: the person who paid, the person who uploaded it, or an admin. */
function mayChange(viewer: Viewer, row: Pick<ReceiptRow, "staff_id" | "uploaded_by">): boolean {
  if (!viewer.active) return false;
  if (canApproveReceipts(viewer)) return true;
  return row.staff_id === viewer.id || (canManageReceipts(viewer) && row.uploaded_by === viewer.id);
}

async function shape(rows: ReceiptRow[], viewer: Viewer, opts: { lockInfo?: boolean } = {}): Promise<Receipt[]> {
  const [urls, names, locked] = await Promise.all([
    signedUrls(rows.flatMap((r) => r.photo_paths ?? [])),
    staffNames(rows.map((r) => r.staff_id)),
    opts.lockInfo ? paidLocks(rows) : Promise.resolve(new Set<string>()),
  ]);
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    paidBy: r.paid_by,
    staffId: r.staff_id,
    personName: r.paid_by === "company" ? COMPANY_LABEL : (names.get(r.staff_id ?? "") ?? "Staff"),
    kind: r.kind,
    cents: Number(r.amount_cents),
    note: r.note ?? "",
    status: r.status,
    reason: r.reason ?? "",
    createdAt: r.created_at,
    uploadedByName: r.uploaded_by_name ?? "",
    reviewedByName: r.reviewed_by_name ?? "",
    reviewedAt: r.reviewed_at ?? null,
    photos: (r.photo_paths ?? []).map((p, n) => ({ url: urls.get(p) ?? null, href: `/api/team/receipts/photo?id=${encodeURIComponent(r.id)}&n=${n}` })),
    photoPaths: r.photo_paths ?? [],
    canEdit: r.status === "submitted" && mayChange(viewer, r),
    paidLocked: locked.has(r.id),
  }));
}

/** The approved staff receipts whose reimbursement is on a line already marked paid. */
async function paidLocks(rows: ReceiptRow[]): Promise<Set<string>> {
  const ids = rows.filter((r) => r.status === "approved" && r.paid_by === "staff").map((r) => r.id);
  const out = new Set<string>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from(REIMBURSEMENTS_TABLE).select("id, receipt_id, assignment_id").in("receipt_id", ids);
  if (error) return out;
  for (const r of (data as { receipt_id: string; assignment_id: string }[]) ?? []) if (await lineIsPaid(r.assignment_id)) out.add(r.receipt_id);
  return out;
}

async function eventRows(sessionId: string): Promise<ReceiptRow[] | null> {
  const { data, error } = await supabase.from(RECEIPTS_TABLE).select("*").eq("session_id", sessionId).order("created_at", { ascending: false });
  if (error) return null;
  return live((data as ReceiptRow[]) ?? []);
}

async function oneRow(id: unknown): Promise<ReceiptRow | null | "not_ready"> {
  if (typeof id !== "string" || !id) return null;
  const { data, error } = await supabase.from(RECEIPTS_TABLE).select("*").eq("id", id).maybeSingle();
  if (error) return notReady(error.message) ? "not_ready" : null;
  const row = (data as ReceiptRow | null) ?? null;
  return row && !row.deleted_at ? row : null;
}

const dayOf = (session: SessionLike) => eventSchedule(eventData(session as SessionRow)).day;

// ----- Reads -----

export interface StaffReceiptsView {
  ready: boolean; // false until the migration runs
  openUntil: string | null; // YYYY-MM-DD, the last day to add one
  receipts: Receipt[]; // only this person's own, newest first
}

/**
 * The staff Receipts tab: only the receipts this person paid for on this
 * event. Null (no tab) for anyone not on the event, declined, or past 14
 * days after it.
 */
export async function staffReceiptsView(session: SessionLike, staff: Viewer, assignment: Assignment | null, now: Date = new Date()): Promise<StaffReceiptsView | null> {
  const day = dayOf(session);
  if (!staffCanUseReceipts(staff, assignment, day, chicagoToday(now))) return null;
  const openUntil = receiptsOpenUntil(day);
  const { data, error } = await supabase.from(RECEIPTS_TABLE).select("*").eq("session_id", session.id).eq("staff_id", staff.id).order("created_at", { ascending: false });
  if (error) return { ready: false, openUntil, receipts: [] };
  return { ready: true, openUntil, receipts: await shape(live((data as ReceiptRow[]) ?? []), staff) };
}

export interface AdminReceiptsView {
  ready: boolean;
  canApprove: boolean; // admins; managers view and upload only
  people: { id: string; name: string }[]; // who can be picked as the payer: on the event, not declined
  receipts: Receipt[]; // every receipt on the event, newest first
}

/** The admin Receipts tab: every receipt on the event. Null for anyone but admins and managers. */
export async function adminReceiptsView(session: SessionLike, viewer: Viewer, people: { staffId: string; name: string; status: string }[]): Promise<AdminReceiptsView | null> {
  if (!canManageReceipts(viewer)) return null;
  const choices = people.filter((p) => p.status !== "declined").map((p) => ({ id: p.staffId, name: p.name || "Staff" }));
  const rows = await eventRows(session.id);
  if (!rows) return { ready: false, canApprove: canApproveReceipts(viewer), people: choices, receipts: [] };
  return { ready: true, canApprove: canApproveReceipts(viewer), people: choices, receipts: await shape(rows, viewer, { lockInfo: true }) };
}

/** Receipts waiting on review on one event: the tab badge. 0 before the migration. */
export async function pendingReceiptCount(sessionId: string): Promise<number> {
  const { data, error } = await supabase.from(RECEIPTS_TABLE).select("id, deleted_at").eq("session_id", sessionId).eq("status", "submitted");
  if (error) return 0;
  return live((data as ReceiptRow[]) ?? []).length;
}

export interface MyReceipt extends Receipt {
  eventTitle: string; // first name and event type, the staff title
  eventDay: string | null;
  open: boolean; // the event's Receipts tab is still open to them
}

/** Me page: every receipt this person paid for, across events, newest first. Only ever their own. */
export async function myReceipts(staff: Viewer, now: Date = new Date()): Promise<{ ready: boolean; receipts: MyReceipt[] }> {
  const { data, error } = await supabase.from(RECEIPTS_TABLE).select("*").eq("staff_id", staff.id).order("created_at", { ascending: false });
  if (error) return { ready: false, receipts: [] };
  const rows = live((data as ReceiptRow[]) ?? []);
  const ids = [...new Set(rows.map((r) => r.session_id))];
  const [shaped, sessions, assignments] = await Promise.all([
    shape(rows, staff),
    ids.length ? supabase.from("sessions").select("id, event_data, event_date").in("id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("event_assignments").select("session_id, status").eq("staff_id", staff.id).in("session_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const byId = new Map(((sessions.data as { id: string; event_data: Record<string, unknown> | null }[]) ?? []).map((s) => [s.id, s]));
  const status = new Map(((assignments.data as { session_id: string; status: string }[]) ?? []).map((a) => [a.session_id, a.status]));
  const today = chicagoToday(now);
  return {
    ready: true,
    receipts: shaped.map((r) => {
      const ed = byId.get(r.sessionId)?.event_data ?? {};
      const day = eventSchedule(ed).day;
      const st = status.get(r.sessionId);
      return {
        ...r,
        eventTitle: [firstName(ed.client_name), scrub(ed.event_type)].filter(Boolean).join(" · ") || "Event",
        eventDay: day,
        open: staffCanUseReceipts(staff, st ? { status: st } : null, day, today),
      };
    }),
  };
}

/** Every receipt across events for the admin page. Null for anyone but an admin (never managers). */
export async function allReceipts(admin: Viewer): Promise<{ ready: boolean; items: ReceiptListItem[]; people: { id: string; name: string }[] } | null> {
  if (!canApproveReceipts(admin)) return null;
  const { data, error } = await supabase.from(RECEIPTS_TABLE).select("*").order("created_at", { ascending: false });
  if (error) return { ready: false, items: [], people: [] };
  const rows = live((data as ReceiptRow[]) ?? []);
  const ids = [...new Set(rows.map((r) => r.session_id))];
  const [sessions, names] = await Promise.all([
    ids.length ? supabase.from("sessions").select("id, event_data, event_date").in("id", ids) : Promise.resolve({ data: [] }),
    staffNames(rows.map((r) => r.staff_id)),
  ]);
  const byId = new Map(((sessions.data as { id: string; event_data: Record<string, unknown> | null }[]) ?? []).map((s) => [s.id, s.event_data ?? {}]));
  const items: ReceiptListItem[] = rows.map((r) => {
    const ed = byId.get(r.session_id) ?? {};
    return {
      id: r.id,
      sessionId: r.session_id,
      eventDay: eventSchedule(ed).day,
      eventTitle: adminEventTitle(ed),
      paidBy: r.paid_by,
      staffId: r.staff_id,
      personName: r.paid_by === "company" ? COMPANY_LABEL : (names.get(r.staff_id ?? "") ?? "Staff"),
      kind: r.kind,
      cents: Number(r.amount_cents),
      note: r.note ?? "",
      status: r.status,
      reason: r.reason ?? "",
      createdAt: r.created_at,
      uploadedByName: r.uploaded_by_name ?? "",
      reviewedByName: r.reviewed_by_name ?? "",
      reviewedAt: r.reviewed_at ?? null,
      photoCount: (r.photo_paths ?? []).length,
    };
  });
  const people = [...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { ready: true, items, people };
}

/** Approved receipts on one event, for the Business tab. Empty before the migration. */
export async function approvedReceiptsFor(sessionId: string): Promise<ApprovedReceipt[]> {
  const { data, error } = await supabase.from(RECEIPTS_TABLE).select("*").eq("session_id", sessionId).eq("status", "approved");
  if (error) return [];
  return live((data as ReceiptRow[]) ?? []).map((r) => ({ kind: r.kind, cents: Number(r.amount_cents), paidBy: r.paid_by }));
}

/** Submitted staff receipts on these events, for the Payroll pickup prompts: session → staff → kind → receipt id. */
export async function submittedReceiptsFor(sessionIds: string[]): Promise<Map<string, Map<string, Partial<Record<ReceiptKind, string>>>>> {
  const out = new Map<string, Map<string, Partial<Record<ReceiptKind, string>>>>();
  const ids = [...new Set(sessionIds)];
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from(RECEIPTS_TABLE).select("*").in("session_id", ids).eq("status", "submitted");
  if (error) return out;
  for (const r of live((data as ReceiptRow[]) ?? [])) {
    if (r.paid_by !== "staff" || !r.staff_id) continue;
    const bySession = out.get(r.session_id) ?? new Map();
    const mine = bySession.get(r.staff_id) ?? {};
    mine[r.kind] ??= r.id;
    bySession.set(r.staff_id, mine);
    out.set(r.session_id, bySession);
  }
  return out;
}

/**
 * One photo, full size: a fresh signed link, only for admins and managers or
 * the staff member who paid. Null for anyone else, a deleted receipt, or a
 * photo that is not there.
 */
export async function receiptPhotoUrl(viewer: Viewer, receiptId: unknown, n: number): Promise<string | null> {
  if (!viewer.active) return null;
  const row = await oneRow(receiptId);
  if (!row || row === "not_ready") return null;
  if (!canManageReceipts(viewer) && row.staff_id !== viewer.id) return null;
  const path = (row.photo_paths ?? [])[n];
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BAR_PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ----- Writes -----

/** May this person add or change receipts on this event at all? Admins and managers always; staff while it is open to them. */
function mayUseEvent(viewer: Viewer, session: SessionLike, assignment: Assignment | null, now: Date): boolean {
  return canManageReceipts(viewer) || staffCanUseReceipts(viewer, assignment, dayOf(session), chicagoToday(now));
}

async function tableReady(): Promise<boolean> {
  const { error } = await supabase.from(RECEIPTS_TABLE).select("id").limit(1);
  return !error;
}

export interface PhotoFile {
  blob: Blob;
  type: string;
}

/** Upload one photo to this person's folder for the event. The receipt is saved after, with the paths. */
export async function uploadReceiptPhoto(session: SessionLike, viewer: Viewer, assignment: Assignment | null, file: PhotoFile, now: Date = new Date()): Promise<Result<{ path: string }>> {
  if (!mayUseEvent(viewer, session, assignment, now)) return { ok: false, error: "You cannot add receipts to this event.", status: 403 };
  const bad = photoFileError({ type: file.type, size: file.blob.size });
  if (bad) return { ok: false, error: bad, status: 400 };
  if (!(await tableReady())) return NOT_READY;
  const path = receiptPhotoPath(session.id, viewer.id, now, photoExtension(file.type), Math.floor(Math.random() * 1e6));
  const { error } = await supabase.storage.from(BAR_PHOTO_BUCKET).upload(path, file.blob, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[receipts] photo upload failed:", error.message);
    return { ok: false, error: "The photo did not upload. Try again.", status: 500 };
  }
  return { ok: true, path };
}

/** Who paid, from what an admin or manager picked: "company", or a staff member on the event who has not declined. */
async function payerFor(viewer: Viewer, session: SessionLike, assignment: Assignment | null, raw: unknown): Promise<Result<{ paidBy: Payer; staffId: string | null; assignmentId: string | null }>> {
  if (!canManageReceipts(viewer)) {
    // Staff: always themselves, whatever was sent.
    if (!assignment) return { ok: false, error: "You are not on this event.", status: 403 };
    return { ok: true, paidBy: "staff", staffId: viewer.id, assignmentId: assignment.id };
  }
  if (raw === COMPANY) return { ok: true, paidBy: "company", staffId: null, assignmentId: null };
  if (typeof raw !== "string" || !raw) return { ok: false, error: "Pick who paid: a staff member or Company.", status: 400 };
  const { data } = await supabase.from("event_assignments").select("id, status").eq("session_id", session.id).eq("staff_id", raw).maybeSingle();
  const a = data as Assignment | null;
  if (!a || a.status === "declined") return { ok: false, error: "That person is not on this event.", status: 400 };
  return { ok: true, paidBy: "staff", staffId: raw, assignmentId: a.id };
}

/**
 * Add or change a receipt:
 *   { id?, kind, amount, note?, photos: [paths], payer? ("company" or a staff id, admins and managers only), confirmDuplicate? }
 * The same person, event, type and amount as a receipt already there answers
 * duplicate: true (409) unless confirmDuplicate is set.
 */
export async function saveReceipt(session: SessionLike, viewer: Viewer, assignment: Assignment | null, body: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ id: string }>> {
  if (!mayUseEvent(viewer, session, assignment, now)) return { ok: false, error: "You cannot add receipts to this event.", status: 403 };
  const editing = body.id !== undefined && body.id !== null && body.id !== "";
  let row: ReceiptRow | null = null;
  if (editing) {
    const r = await oneRow(body.id);
    if (r === "not_ready") return NOT_READY;
    if (!r || r.session_id !== session.id) return { ok: false, error: "That receipt is gone. Reload the page.", status: 404 };
    if (!mayChange(viewer, r)) return { ok: false, error: "You can only change your own receipts.", status: 403 };
    if (r.status !== "submitted") return { ok: false, error: ONLY_SUBMITTED, status: 409 };
    row = r;
  }
  // Staff editing their own keep themselves as the payer; admins and managers may change it.
  const payer = await payerFor(viewer, session, assignment, body.payer ?? (row && canManageReceipts(viewer) ? (row.paid_by === "company" ? COMPANY : row.staff_id) : undefined));
  if (!payer.ok) return payer;
  const v = validateReceipt(body, payer.paidBy);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const photos = checkPhotoPaths(body.photos, receiptPhotoPrefix(session.id, viewer.id), row?.photo_paths ?? []);
  if (!photos.ok) return { ok: false, error: photos.error, status: 400 };

  const existing = await eventRows(session.id);
  if (!existing) return NOT_READY;
  const dup = findDuplicate(
    { id: row?.id ?? null, sessionId: session.id, paidBy: payer.paidBy, staffId: payer.staffId, kind: v.kind, cents: v.cents },
    existing.map((r) => ({ id: r.id, sessionId: r.session_id, paidBy: r.paid_by, staffId: r.staff_id, kind: r.kind, cents: Number(r.amount_cents), status: r.status }))
  );
  if (dup && body.confirmDuplicate !== true) return { ok: false, error: duplicateMessage(dup), status: 409, duplicate: true };

  const fields = { paid_by: payer.paidBy, staff_id: payer.staffId, assignment_id: payer.assignmentId, kind: v.kind, amount_cents: v.cents, note: v.note, photo_paths: photos.paths };
  if (row) {
    // Only while still Submitted: a review that lands first wins.
    const { data, error } = await supabase.from(RECEIPTS_TABLE).update({ ...fields, updated_at: now.toISOString() }).eq("id", row.id).eq("status", "submitted").select("id");
    if (error) return saveFailed(error.message);
    if (!data || (data as unknown[]).length === 0) return { ok: false, error: ONLY_SUBMITTED, status: 409 };
    return { ok: true, id: row.id };
  }
  const { data, error } = await supabase
    .from(RECEIPTS_TABLE)
    .insert({ session_id: session.id, ...fields, status: "submitted", reason: "", uploaded_by: viewer.id, uploaded_by_name: viewer.name, created_at: now.toISOString() })
    .select("id");
  if (error) return saveFailed(error.message);
  return { ok: true, id: String(((data as { id: string }[]) ?? [])[0]?.id ?? "") };
}

function saveFailed(message: string): { ok: false; error: string; status: number } {
  if (notReady(message)) return NOT_READY;
  console.error("[receipts] save failed:", message);
  return { ok: false, error: "Could not save. Try again.", status: 500 };
}

/** Delete one: { id }. Only while Submitted. The row and its files stay, and stop showing. */
export async function deleteReceipt(session: SessionLike, viewer: Viewer, assignment: Assignment | null, id: unknown, now: Date = new Date()): Promise<Result> {
  if (!mayUseEvent(viewer, session, assignment, now)) return { ok: false, error: "You cannot change receipts on this event.", status: 403 };
  const row = await oneRow(id);
  if (row === "not_ready") return NOT_READY;
  if (!row || row.session_id !== session.id) return { ok: false, error: "That receipt is gone. Reload the page.", status: 404 };
  if (!mayChange(viewer, row)) return { ok: false, error: "You can only delete your own receipts.", status: 403 };
  if (row.status !== "submitted") return { ok: false, error: ONLY_SUBMITTED, status: 409 };
  const { data, error } = await supabase.from(RECEIPTS_TABLE).update({ deleted_at: now.toISOString(), deleted_by: viewer.id }).eq("id", row.id).eq("status", "submitted").select("id");
  if (error) return saveFailed(error.message);
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: ONLY_SUBMITTED, status: 409 };
  return { ok: true };
}

/**
 * Admins only (never managers):
 *   { action: "approve", id }        staff paid: the linked reimbursement on Payroll; Company: a cost on the event
 *   { action: "not_approve", id, reason }  the reason is required; the staff member sees it
 *   { action: "reopen", id }         back to Submitted; removes the linked reimbursement, unless that line is marked paid
 */
export async function reviewReceipt(admin: Viewer, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  if (!canApproveReceipts(admin)) return { ok: false, error: MANAGERS_CANNOT_APPROVE, status: 403 };
  const row = await oneRow(body.id);
  if (row === "not_ready") return NOT_READY;
  if (!row) return { ok: false, error: "That receipt is gone. Reload the page.", status: 404 };
  const reviewed = { reviewed_by: admin.id, reviewed_by_name: admin.name, reviewed_at: now.toISOString() };

  if (body.action === "approve") {
    if (row.status !== "submitted") return { ok: false, error: "This receipt was already reviewed. Reopen it first.", status: 409 };
    if (row.paid_by === "company") return claim(row.id, "submitted", { status: "approved", reason: "", ...reviewed });
    // Staff paid: the reimbursement goes on their line on this event.
    const { data: a } = await supabase.from("event_assignments").select("id, status").eq("session_id", row.session_id).eq("staff_id", row.staff_id).maybeSingle();
    const asg = a as Assignment | null;
    if (!asg || asg.status !== "accepted") return { ok: false, error: "That person is not on this event, so there is no Payroll line to reimburse.", status: 409 };
    if (await lineIsPaid(asg.id)) return { ok: false, error: "That person's line on this event is already marked paid. Undo paid on Payroll first.", status: 409 };
    const claimed = await claim(row.id, "submitted", { status: "approved", reason: "", ...reviewed });
    if (!claimed.ok) return claimed;
    const { error } = await supabase.from(REIMBURSEMENTS_TABLE).insert({
      assignment_id: asg.id,
      session_id: row.session_id,
      staff_id: row.staff_id,
      kind: row.kind,
      amount_cents: Number(row.amount_cents),
      note: (row.note || "From receipt").slice(0, 120),
      receipt_id: row.id,
      created_by: admin.id,
      created_by_name: admin.name,
      created_at: now.toISOString(),
    });
    if (error) {
      // Put it back, so nothing is approved without its reimbursement.
      await supabase.from(RECEIPTS_TABLE).update({ status: "submitted", reviewed_by: null, reviewed_by_name: null, reviewed_at: null }).eq("id", row.id);
      console.error("[receipts] reimbursement insert failed:", error.message);
      return { ok: false, error: notReady(error.message) ? RECEIPTS_NOT_READY : "Could not create the reimbursement. Try again.", status: notReady(error.message) ? 503 : 500 };
    }
    return { ok: true };
  }

  if (body.action === "not_approve") {
    const reason = cleanReason(body.reason);
    if (!reason) return { ok: false, error: "Add a reason. The staff member will see it.", status: 400 };
    if (row.status !== "submitted") return { ok: false, error: "This receipt was already reviewed. Reopen it first.", status: 409 };
    return claim(row.id, "submitted", { status: "not_approved", reason, ...reviewed });
  }

  if (body.action === "reopen") {
    if (row.status === "submitted") return { ok: true };
    if (row.status === "approved" && row.paid_by === "staff") {
      const { data, error } = await supabase.from(REIMBURSEMENTS_TABLE).select("id, assignment_id").eq("receipt_id", row.id);
      if (error) return saveFailed(error.message);
      const linked = (data as { id: string; assignment_id: string }[]) ?? [];
      for (const r of linked) {
        if (await lineIsPaid(r.assignment_id)) return { ok: false, error: "Its reimbursement is already marked paid on Payroll, so this receipt cannot be reopened.", status: 409 };
      }
      if (linked.length) {
        const { error: delErr } = await supabase.from(REIMBURSEMENTS_TABLE).delete().eq("receipt_id", row.id);
        if (delErr) return saveFailed(delErr.message);
      }
    }
    return claim(row.id, row.status, { status: "submitted", reason: "", reviewed_by: null, reviewed_by_name: null, reviewed_at: null });
  }

  return { ok: false, error: "Bad request", status: 400 };
}

/** Change a receipt's status only if it is still what we read: two admins reviewing at once cannot both win. */
async function claim(id: string, from: ReceiptStatus, patch: Record<string, unknown>): Promise<Result> {
  const { data, error } = await supabase.from(RECEIPTS_TABLE).update(patch).eq("id", id).eq("status", from).select("id");
  if (error) return saveFailed(error.message);
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: "This receipt just changed. Reload the page.", status: 409 };
  return { ok: true };
}
