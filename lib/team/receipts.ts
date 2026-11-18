// Receipts: one place per event where receipts are uploaded, reviewed, and
// tied to reimbursements and event costs. Pure, no database, and light enough
// for the receipt cards in the browser.
//
// Who does what (enforced on the server in receipts-db.ts):
//   Staff on the event who have not declined: add their own receipts until 14
//     days after the event; see only their own; edit or delete one only while
//     it is Submitted.
//   Admins and managers: see every receipt on the event, upload one and pick
//     who paid (a staff member on the event, or Company).
//   Admins only (never managers): Approve, Not approved (with a reason), and
//     reopen.
//
// Approving does one of two things:
//   paid by a staff member: the reimbursement for that person on that event
//     in Payroll, same type and amount, linked to the receipt.
//   paid by Company: no reimbursement; it is a cost on the event.
//
// Business: every approved receipt dollar counts exactly once (receiptCosts).

import { isAdminRole, isFullAdmin } from "@/lib/team/roles";
import { money } from "@/lib/team/pay";
import { MAX_REIMBURSEMENT_CENTS } from "@/lib/team/reimbursements";
import { csvCell } from "@/lib/team/timesheet";
import { chicagoToday } from "@/lib/team/time";

export const RECEIPT_KINDS = ["ice", "menu_printing", "supplies", "other"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
export const RECEIPT_KIND_LABEL: Record<ReceiptKind, string> = { ice: "Ice", menu_printing: "Menu printing", supplies: "Supplies", other: "Other" };

export const RECEIPT_STATUSES = ["submitted", "approved", "not_approved"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = { submitted: "Submitted", approved: "Approved", not_approved: "Not approved" };

export type Payer = "staff" | "company";
export const COMPANY = "company";
export const COMPANY_LABEL = "Company";

export const RECEIPTS_TAB = "Receipts";
export const RECEIPTS_PATH = "/team/admin/receipts";
export const RECEIPTS_NOT_READY = "Receipts are not set up yet. Run the receipts migration first.";
export const OPEN_DAYS_AFTER = 14;
export const MAX_RECEIPT_PHOTOS = 6;
export const MAX_STAFF_RECEIPT_CENTS = MAX_REIMBURSEMENT_CENTS; // it becomes a reimbursement
export const MAX_COMPANY_RECEIPT_CENTS = 5000_00;
export const MAX_RECEIPT_NOTE = 200;
export const MAX_REASON = 200;
export const COMPANY_COST_LABEL = "Paid by company, from receipts";
export const SUPPLIES_FROM_RECEIPTS = "from receipts";
export const MANAGERS_CANNOT_APPROVE = "Admins only. Managers can view and upload receipts but not approve them.";
export const ONLY_SUBMITTED = "Only a Submitted receipt can be changed or deleted.";

const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** The last day staff can add receipts: 14 days after the event. Null with no event day (always open). */
export const receiptsOpenUntil = (eventDay: string | null) => (eventDay ? addDays(eventDay, OPEN_DAYS_AFTER) : null);

/** Staff on the event who have not declined, until 14 days after it. */
export function staffCanUseReceipts(staff: { active: boolean } | null, assignment: { status: string } | null, eventDay: string | null, today: string): boolean {
  if (!staff || !staff.active || !assignment || assignment.status === "declined") return false;
  const until = receiptsOpenUntil(eventDay);
  return !until || today <= until;
}

/** Admins and managers see every receipt on an event and upload for anyone. */
export const canManageReceipts = (staff: { role: unknown; active: boolean } | null) => !!staff && staff.active && isAdminRole(staff.role);
/** Approve, Not approved, reopen: admins only, never managers. */
export const canApproveReceipts = (staff: { role: unknown; active: boolean } | null) => !!staff && staff.active && isFullAdmin(staff.role);

export type Checked<T> = ({ ok: true } & T) | { ok: false; error: string };

/** What someone typed: a type, dollars, an optional note. Staff receipts top out at the reimbursement limit. */
export function validateReceipt(raw: { kind?: unknown; amount?: unknown; note?: unknown }, payer: Payer): Checked<{ kind: ReceiptKind; cents: number; note: string }> {
  const kind = String(raw.kind ?? "") as ReceiptKind;
  if (!(RECEIPT_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Pick Ice, Menu printing, Supplies, or Other." };
  const s = String(raw.amount ?? "").trim().replace(/[$,\s]/g, "");
  if (!s) return { ok: false, error: "Enter the amount." };
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return { ok: false, error: "Enter the amount in dollars, like 24 or 24.50." };
  const cents = Math.round(Number(s) * 100);
  const max = payer === "company" ? MAX_COMPANY_RECEIPT_CENTS : MAX_STAFF_RECEIPT_CENTS;
  if (cents <= 0 || cents > max) return { ok: false, error: `Enter an amount between $0.01 and ${money(max)}.` };
  const note = String(raw.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > MAX_RECEIPT_NOTE) return { ok: false, error: `Keep the note to ${MAX_RECEIPT_NOTE} characters.` };
  return { ok: true, kind, cents, note };
}

/** The reason for Not approved: required, one line, short. */
export function cleanReason(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_REASON);
}

// ----- Photos -----

/** Each uploader's own folder for one event, in the bar photos bucket. */
export const receiptPhotoPrefix = (sessionId: string, uploaderId: string) => `receipts/${sessionId}/${uploaderId}/`;
export const receiptPhotoPath = (sessionId: string, uploaderId: string, at: Date, ext: string, n = 0) => `${receiptPhotoPrefix(sessionId, uploaderId)}${at.getTime()}${n ? `_${n}` : ""}.${ext}`;

/**
 * The photos on a receipt being saved: one to six, each either already on
 * the receipt or uploaded by this person to this event's folder. Anything
 * else (another person's file, another event's, a made up path) is refused.
 */
export function checkPhotoPaths(raw: unknown, prefix: string, already: string[] = []): Checked<{ paths: string[] }> {
  const list = Array.isArray(raw) ? raw : [];
  const paths = [...new Set(list.filter((p): p is string => typeof p === "string" && p.length > 0))];
  if (paths.length === 0) return { ok: false, error: "Add a photo of the receipt." };
  if (paths.length > MAX_RECEIPT_PHOTOS) return { ok: false, error: `Up to ${MAX_RECEIPT_PHOTOS} photos on one receipt.` };
  const fine = (p: string) => already.includes(p) || (p.startsWith(prefix) && /^[A-Za-z0-9_./-]+$/.test(p) && !p.includes(".."));
  if (!paths.every(fine)) return { ok: false, error: "A photo did not upload. Add it again." };
  return { ok: true, paths };
}

/** The app link that opens one photo full size: it checks access, then sends a short lived signed link. */
export const receiptPhotoHref = (receiptId: string, n = 0) => `/api/team/receipts/photo?id=${encodeURIComponent(receiptId)}&n=${n}`;

// ----- Duplicates -----

export interface DupKey {
  id?: string | null;
  sessionId: string;
  paidBy: Payer;
  staffId: string | null;
  kind: ReceiptKind;
  cents: number;
}

/** An existing receipt with the same person (or Company), event, type and amount. Deleted ones never count. */
export function findDuplicate<T extends DupKey>(candidate: DupKey, existing: T[]): T | null {
  return (
    existing.find(
      (r) =>
        r.id !== candidate.id &&
        r.sessionId === candidate.sessionId &&
        r.paidBy === candidate.paidBy &&
        (r.paidBy === "company" || r.staffId === candidate.staffId) &&
        r.kind === candidate.kind &&
        r.cents === candidate.cents
    ) ?? null
  );
}

export function duplicateMessage(r: { kind: ReceiptKind; cents: number; status: ReceiptStatus }): string {
  return `There is already a ${RECEIPT_KIND_LABEL[r.kind]} receipt for ${money(r.cents)} on this event from the same person (${RECEIPT_STATUS_LABEL[r.status]}). Save this one too?`;
}

// ----- Business: every approved receipt dollar counts exactly once -----

export interface ApprovedReceipt {
  kind: ReceiptKind;
  cents: number;
  paidBy: Payer;
}

export interface ReceiptCosts {
  suppliesCents: number; // approved Supplies receipts, whoever paid: the event's supplies cost
  suppliesCount: number;
  companyCents: number; // approved non Supplies receipts paid by Company: their own cost line
  companyCount: number;
}

/**
 * How approved receipts land in an event's costs:
 *   Supplies, whoever paid      the supplies cost ("from receipts"), unless a
 *                               hand entered supplies amount wins
 *   other types, staff paid     already in Reimbursed to staff, through the
 *                               reimbursement approving created; not here
 *   other types, Company paid   "Paid by company, from receipts"
 * A Supplies receipt paid by staff is still reimbursed on Payroll, but that
 * reimbursement is left out of Reimbursed to staff (see business.ts).
 */
export function receiptCosts(list: ApprovedReceipt[]): ReceiptCosts {
  const supplies = list.filter((r) => r.kind === "supplies");
  const company = list.filter((r) => r.kind !== "supplies" && r.paidBy === "company");
  return {
    suppliesCents: supplies.reduce((n, r) => n + r.cents, 0),
    suppliesCount: supplies.length,
    companyCents: company.reduce((n, r) => n + r.cents, 0),
    companyCount: company.length,
  };
}

// ----- The admin list: every receipt across events -----

export interface ReceiptListItem {
  id: string;
  sessionId: string;
  eventDay: string | null; // YYYY-MM-DD
  eventTitle: string;
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
  photoCount: number;
}

export interface ReceiptFilters {
  from: string; // event date, YYYY-MM-DD, "" for any
  to: string;
  status: ReceiptStatus | "";
  kind: ReceiptKind | "";
  payer: Payer | "";
  person: string; // a staff id, "" for anyone
  q: string;
}

const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** Filters from the address. Anything unknown is ignored. */
export function parseFilters(q: Record<string, unknown>): ReceiptFilters {
  const s = (k: string) => String(one(q[k]) ?? "").trim();
  const status = s("status") as ReceiptStatus;
  const kind = s("kind") as ReceiptKind;
  const payer = s("payer") as Payer;
  return {
    from: isYmd(s("from")) ? s("from") : "",
    to: isYmd(s("to")) ? s("to") : "",
    status: (RECEIPT_STATUSES as readonly string[]).includes(status) ? status : "",
    kind: (RECEIPT_KINDS as readonly string[]).includes(kind) ? kind : "",
    payer: payer === "staff" || payer === "company" ? payer : "",
    person: /^[\w-]{1,64}$/.test(s("person")) ? s("person") : "",
    q: s("q").slice(0, 80),
  };
}

export function filterQuery(f: ReceiptFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p.toString();
}

/** The receipts that match, newest event first, then newest upload. */
export function filterReceipts(list: ReceiptListItem[], f: ReceiptFilters): ReceiptListItem[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return list
    .filter((r) => {
      if (f.from && (!r.eventDay || r.eventDay < f.from)) return false;
      if (f.to && (!r.eventDay || r.eventDay > f.to)) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.kind && r.kind !== f.kind) return false;
      if (f.payer && r.paidBy !== f.payer) return false;
      if (f.person && r.staffId !== f.person) return false;
      if (words.length) {
        const hay = [r.eventTitle, r.personName, r.note, RECEIPT_KIND_LABEL[r.kind], RECEIPT_STATUS_LABEL[r.status], r.reason, money(r.cents), (r.cents / 100).toFixed(2)].join(" ").toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    })
    .sort((a, b) => (b.eventDay ?? "").localeCompare(a.eventDay ?? "") || b.createdAt.localeCompare(a.createdAt));
}

export interface ReceiptTotals {
  count: number;
  cents: number;
  byStatus: Record<ReceiptStatus, { count: number; cents: number }>;
}

export function receiptTotals(list: ReceiptListItem[]): ReceiptTotals {
  const byStatus = Object.fromEntries(RECEIPT_STATUSES.map((s) => [s, { count: 0, cents: 0 }])) as ReceiptTotals["byStatus"];
  for (const r of list) {
    byStatus[r.status].count++;
    byStatus[r.status].cents += r.cents;
  }
  return { count: list.length, cents: list.reduce((n, r) => n + r.cents, 0), byStatus };
}

export const CSV_COLUMNS = ["Event date", "Event", "Person", "Payer", "Type", "Amount", "Note", "Status", "Approved by", "Approved on", "Photos"] as const;

/** The CSV for the filtered set. Each photo is an app link that checks access before it opens. */
export function receiptsCsv(list: ReceiptListItem[], origin: string): string {
  const line = (cells: unknown[]) => cells.map(csvCell).join(",");
  const rows = [line([...CSV_COLUMNS])];
  for (const r of list) {
    const approved = r.status === "approved";
    rows.push(
      line([
        r.eventDay ?? "",
        r.eventTitle,
        r.paidBy === "company" ? "" : r.personName,
        r.paidBy === "company" ? COMPANY_LABEL : "Staff",
        RECEIPT_KIND_LABEL[r.kind],
        (r.cents / 100).toFixed(2),
        r.note,
        RECEIPT_STATUS_LABEL[r.status],
        approved ? r.reviewedByName : "",
        approved && r.reviewedAt ? chicagoToday(new Date(r.reviewedAt)) : "",
        Array.from({ length: r.photoCount }, (_, n) => `${origin}${receiptPhotoHref(r.id, n)}`).join(" "),
      ])
    );
  }
  return rows.join("\r\n") + "\r\n";
}
