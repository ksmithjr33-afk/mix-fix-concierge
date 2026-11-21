// The booked totals import (scripts/import-booked-totals.mts): reads the
// owner's CSV export, matches each row to one session, and works out what it
// would set. Pure, no database. Never computes a price: the total and the
// amount paid come only from the file.
//
// The file: booked-totals.csv, one row per event, with a header row:
//   email           the client's email (or leave blank and give ghl_contact_id)
//   ghl_contact_id  the GHL contact id (or leave blank and give email)
//   event_date      the event date, like 2026-12-12 or 12/12/2026 or December 12, 2026
//   package_total   the booked total, like 2400 or $2,400.00
//   amount_paid     everything paid so far, like 650 or $650.00 (0 or blank: nothing paid)
//   last_paid_on    optional: the date of the latest payment (else the import date)

import { eventSchedule } from "@/lib/team/time";

export const IMPORT_COLUMNS = ["email", "ghl_contact_id", "event_date", "package_total", "amount_paid", "last_paid_on"] as const;
type Column = (typeof IMPORT_COLUMNS)[number];

const ALIASES: Record<string, Column> = {
  email: "email",
  "client email": "email",
  "ghl contact id": "ghl_contact_id",
  "contact id": "ghl_contact_id",
  "event date": "event_date",
  "package total": "package_total",
  total: "package_total",
  "amount paid": "amount_paid",
  paid: "amount_paid",
  "last paid on": "last_paid_on",
};

/** RFC 4180: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export interface ImportRow {
  line: number; // the line in the file, header is line 1
  email: string;
  contactId: string;
  eventDay: string | null; // YYYY-MM-DD
  eventDateText: string;
  total: number | null;
  paid: number | null;
  paidOn: string | null; // YYYY-MM-DD
  problems: string[];
}

const money = (v: string): number | null => {
  const s = v.replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const day = (v: string): string | null => (v.trim() ? eventSchedule({ event_date: v.trim() }).day : null);

/** The rows, or why the file cannot be read. */
export function readImport(text: string): { rows: ImportRow[]; error: string | null } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], error: "The file is empty." };
  const cols = header.map((h) => {
    const k = h.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
    return ALIASES[k] ?? null;
  });
  const missing: string[] = (["event_date", "package_total", "amount_paid"] as Column[]).filter((c) => !cols.includes(c));
  if (!cols.includes("email") && !cols.includes("ghl_contact_id")) missing.unshift("email or ghl_contact_id");
  if (missing.length) return { rows: [], error: `Missing columns: ${missing.join(", ")}. Found: ${header.join(", ")}.` };
  const rows = body.map((cells, i): ImportRow => {
    const get = (c: Column) => (cols.indexOf(c) >= 0 ? String(cells[cols.indexOf(c)] ?? "").trim() : "");
    const problems: string[] = [];
    const email = get("email").toLowerCase();
    const contactId = get("ghl_contact_id");
    if (!email && !contactId) problems.push("no email or contact id");
    const eventDay = day(get("event_date"));
    if (!eventDay) problems.push(`event date "${get("event_date")}" not readable`);
    const total = money(get("package_total"));
    if (total === null || Number.isNaN(total) || total === 0) problems.push(`package total "${get("package_total")}" not readable`);
    const paid = money(get("amount_paid"));
    if (Number.isNaN(paid)) problems.push(`amount paid "${get("amount_paid")}" not readable`);
    const paidOn = day(get("last_paid_on"));
    if (get("last_paid_on") && !paidOn) problems.push(`last paid on "${get("last_paid_on")}" not readable`);
    if (total && paid && paid > total) problems.push("amount paid is more than the total");
    return { line: i + 2, email, contactId, eventDay, eventDateText: get("event_date"), total: Number.isNaN(total) ? null : total, paid: Number.isNaN(paid) ? null : paid, paidOn, problems };
  });
  return { rows, error: null };
}

export interface Candidate {
  id: string;
  status: string;
  emails: string[]; // lower case: sessions.email, event_data.email, event_data.client_email
  contactId: string;
  eventDay: string | null;
  total: number | null; // booked_price.total on file
  paidCents: number; // everything recorded as paid (lib/balance.ts recordedFrom): an entered deposit, a legacy balance, payments
  payments: number; // how many of those are recorded (0: nothing recorded)
}

export type Outcome =
  | { kind: "unmatched"; row: ImportRow; reason: string }
  | { kind: "ambiguous"; row: ImportRow; ids: string[] }
  | { kind: "matched"; row: ImportRow; c: Candidate; setTotal: boolean; addPaid: number | null; notes: string[] };

/** One session per row: same email or contact id, and the same event day. Submitted events win over unfinished ones. */
export function matchRow(row: ImportRow, all: Candidate[]): Outcome {
  if (row.problems.length) return { kind: "unmatched", row, reason: row.problems.join("; ") };
  const who = all.filter((c) => (row.contactId && c.contactId === row.contactId) || (row.email && c.emails.includes(row.email)));
  if (who.length === 0) return { kind: "unmatched", row, reason: "no event for this email or contact id" };
  const same = who.filter((c) => c.eventDay === row.eventDay);
  if (same.length === 0) return { kind: "unmatched", row, reason: `this contact has no event on ${row.eventDay} (their events: ${who.map((c) => c.eventDay ?? "no date").join(", ")})` };
  const submitted = same.filter((c) => c.status === "submitted");
  const pick = submitted.length ? submitted : same;
  if (pick.length > 1) return { kind: "ambiguous", row, ids: pick.map((c) => c.id) };
  const c = pick[0];
  const notes: string[] = [];
  let setTotal = false;
  if (c.total === null) setTotal = true;
  else if (Math.abs(c.total - row.total!) >= 0.01) notes.push(`total on file is $${c.total}, the file says $${row.total}: not changed`);
  let addPaid: number | null = null;
  const paid = row.paid ?? 0;
  if (paid > 0 && c.payments === 0) addPaid = paid;
  else if (paid > 0 && Math.abs(c.paidCents / 100 - paid) >= 0.01) notes.push(`$${c.paidCents / 100} already recorded as paid, the file says $${paid}: not changed`);
  if (c.status !== "submitted") notes.push(`event status is ${c.status}`);
  return { kind: "matched", row, c, setTotal, addPaid, notes };
}
