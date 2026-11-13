// Client history for admins: a client's other events, the "Repeat client"
// tag, the Clients page, and the stale booking check. Pure, no database.
//
// A client is their email, ignoring capital letters and spaces. Phone numbers
// (the client phone on events added by hand, and the day of contact phone)
// also match in the history card when the email differs, marked "matched by
// phone" because the day of contact is often a planner or a venue. The repeat
// tag, the event count, the Clients page and the stale check use email only,
// so a shared planner's phone never makes two clients look like one.
//
// Admins only: nothing here is ever handed to a bartender page or route.

import { eventDay } from "@/lib/team/time";

/** The few fields of a session this needs (lib/client-history-db.ts reads only these). */
export interface ClientRow {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string | null;
  status: string | null;
  event_date: string | null; // as the booking system sent it
  package_type: string | null;
  guest_count: string | null;
  hours_booked: string | null;
  booked_total: number | null;
  event_name: string | null; // as the booking system sent it
  ed_date: string | null; // as saved by the concierge or an admin
  ed_name: string | null;
  ed_type: string | null;
  ed_package: string | null;
  ed_guests: string | null;
  ed_client: string | null;
  client_phone: string | null;
  contact_phone: string | null;
}

export type HistoryStatus = "upcoming" | "past" | "details pending" | "hidden";

export interface HistoryEntry {
  id: string;
  title: string; // event name, else event type
  day: string | null; // YYYY-MM-DD
  dateText: string; // what to show when the date cannot be read
  pkg: string;
  guests: string;
  total: number | null;
  status: HistoryStatus;
  matchedBy: "email" | "phone";
  createdAt: string | null;
}

const clean = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined" ? s : "";
};

/** "  Dulari.G@Mail.com " as "dulari.g@mail.com". Null when there is no email. */
export function emailKey(email: unknown): string | null {
  const s = clean(email).replace(/\s+/g, "").toLowerCase();
  return s.includes("@") ? s : null;
}

/** The last 10 digits of a US phone ("+1 (972) 555-0199" as "9725550199"). Null when it is not a full number. */
export function phoneKey(phone: unknown): string | null {
  const d = clean(phone).replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : null;
}

/** Our own numbers: a client who gave The Mix Fix's line as a contact is not the same client as another who did. */
export const BUSINESS_PHONES = new Set(["4697548512"]);

export function phonesOf(r: ClientRow): Set<string> {
  return new Set([phoneKey(r.client_phone), phoneKey(r.contact_phone)].filter((p): p is string => !!p && !BUSINESS_PHONES.has(p)));
}

/** The event day: the saved date, else the date the booking system sent. */
export function rowDay(r: ClientRow): string | null {
  return eventDay(clean(r.ed_date) || clean(r.event_date) || null);
}

export function historyStatus(r: ClientRow, hidden: Set<string>, today: string): HistoryStatus {
  if (hidden.has(r.id)) return "hidden";
  if (r.status !== "submitted") return "details pending";
  const day = rowDay(r);
  return day && day < today ? "past" : "upcoming";
}

function entry(r: ClientRow, matchedBy: "email" | "phone", hidden: Set<string>, today: string): HistoryEntry {
  return {
    id: r.id,
    title: clean(r.ed_name) || clean(r.ed_type) || clean(r.event_name) || "Event",
    day: rowDay(r),
    dateText: clean(r.ed_date) || clean(r.event_date) || "No date yet",
    pkg: clean(r.ed_package) || clean(r.package_type),
    guests: clean(r.ed_guests) || clean(r.guest_count),
    total: typeof r.booked_total === "number" && Number.isFinite(r.booked_total) ? r.booked_total : null,
    status: historyStatus(r, hidden, today),
    matchedBy,
    createdAt: r.created_at,
  };
}

/** Newest first: by event day, then by when it was booked. Undated events sort by booking time. */
function newestFirst(a: HistoryEntry, b: HistoryEntry): number {
  const ka = a.day ?? (a.createdAt ?? "").slice(0, 10);
  const kb = b.day ?? (b.createdAt ?? "").slice(0, 10);
  return kb.localeCompare(ka) || String(b.createdAt).localeCompare(String(a.createdAt));
}

/** The client's other events: same email, or (when the email differs) a shared phone number. */
export function clientHistory(target: ClientRow, all: ClientRow[], hidden: Set<string>, today: string): HistoryEntry[] {
  const email = emailKey(target.email);
  const phones = phonesOf(target);
  const out: HistoryEntry[] = [];
  for (const r of all) {
    if (r.id === target.id) continue;
    const e = emailKey(r.email);
    if (email && e === email) out.push(entry(r, "email", hidden, today));
    else if (phones.size > 0 && [...phonesOf(r)].some((p) => phones.has(p))) out.push(entry(r, "phone", hidden, today));
  }
  return out.sort(newestFirst);
}

/** All of one client's events (rows already matched by email), newest first. */
export function clientEvents(rows: ClientRow[], hidden: Set<string>, today: string): HistoryEntry[] {
  return rows.map((r) => entry(r, "email", hidden, today)).sort(newestFirst);
}

/** Every session for one client email, oldest booking first. */
function byEmail(all: ClientRow[]): Map<string, ClientRow[]> {
  const m = new Map<string, ClientRow[]>();
  for (const r of all) {
    const k = emailKey(r.email);
    if (!k) continue;
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  for (const list of m.values()) list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id));
  return m;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** "Repeat client, 3rd event" when the client booked before this one, else null. */
export function repeatLabel(n: number | null | undefined): string | null {
  return n && n >= 2 ? `Repeat client, ${ordinal(n)} event` : null;
}

/** Which booking this is for its client (1 for the first), by session id. Email matches only. */
export function eventNumbers(all: ClientRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of byEmail(all).values()) list.forEach((r, i) => out.set(r.id, i + 1));
  return out;
}

// ----- Stale booking details -----

export interface StaleBooking {
  sessionId: string;
  name: string;
  earlierId: string;
  fields: string[]; // "date", "package", "guest count"
  createdAt: string | null;
  submitted: boolean; // has a manager view to open
}

const lower = (v: unknown) => clean(v).toLowerCase();
const num = (v: unknown) => {
  const n = parseInt(clean(v).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The fields of a new booking that are identical to an earlier booking or saved event. */
export function sameFields(fresh: ClientRow, earlier: ClientRow): string[] {
  const out: string[] = [];
  const date = lower(fresh.event_date);
  const day = eventDay(clean(fresh.event_date) || null);
  if (date && ([lower(earlier.event_date), lower(earlier.ed_date)].includes(date) || (day && [eventDay(clean(earlier.event_date) || null), eventDay(clean(earlier.ed_date) || null)].includes(day)))) out.push("date");
  const pkg = lower(fresh.package_type);
  if (pkg && [lower(earlier.package_type), lower(earlier.ed_package)].includes(pkg)) out.push("package");
  const guests = num(fresh.guest_count);
  if (guests !== null && [num(earlier.guest_count), num(earlier.ed_guests)].includes(guests)) out.push("guest count");
  return out;
}

/**
 * Sessions created since `since` for a client who booked before, whose date,
 * package or guest count as the booking system sent them is identical to an
 * earlier booking. Usually the booking system copied the last event's fields.
 */
export function staleBookings(all: ClientRow[], since: string, hidden: Set<string> = new Set()): StaleBooking[] {
  const out: StaleBooking[] = [];
  for (const list of byEmail(all).values()) {
    list.forEach((fresh, i) => {
      if (i === 0 || hidden.has(fresh.id) || String(fresh.created_at) < since) return;
      for (const earlier of list.slice(0, i).reverse()) {
        const fields = sameFields(fresh, earlier);
        if (fields.length === 0) continue;
        out.push({ sessionId: fresh.id, name: clean(fresh.ed_client) || clean(fresh.name) || "Unknown client", earlierId: earlier.id, fields, createdAt: fresh.created_at, submitted: fresh.status === "submitted" });
        return;
      }
    });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// ----- Clients page -----

export interface ClientSummary {
  key: string; // email key
  name: string;
  email: string;
  phone: string;
  events: number;
  lastEvent: string | null; // latest event day before today
  nextEvent: string | null; // earliest event day today or later
}

/** One row per client email, most recent booking first. */
export function clientDirectory(all: ClientRow[], today: string): ClientSummary[] {
  const out: (ClientSummary & { latest: string })[] = [];
  for (const [key, list] of byEmail(all)) {
    const newest = list[list.length - 1];
    const days = list.map(rowDay).filter((d): d is string => !!d);
    const phone = [...list].reverse().map((r) => [r.client_phone, r.contact_phone].map(clean).find((p) => p && !BUSINESS_PHONES.has(phoneKey(p) ?? ""))).find(Boolean) ?? "";
    out.push({
      key,
      name: [...list].reverse().map((r) => clean(r.ed_client) || clean(r.name)).find(Boolean) ?? "",
      email: clean(newest.email),
      phone,
      events: list.length,
      lastEvent: days.filter((d) => d < today).sort().at(-1) ?? null,
      nextEvent: days.filter((d) => d >= today).sort()[0] ?? null,
      latest: String(newest.created_at),
    });
  }
  return out.sort((a, b) => b.latest.localeCompare(a.latest)).map(({ latest: _latest, ...c }) => c);
}

/** Name, email, or phone (any formatting). Empty query keeps everyone. */
export function searchClients(list: ClientSummary[], q: string): ClientSummary[] {
  const text = q.trim().toLowerCase();
  if (!text) return list;
  const digits = text.replace(/\D/g, "");
  return list.filter(
    (c) =>
      c.name.toLowerCase().includes(text) ||
      c.email.toLowerCase().includes(text.replace(/\s+/g, "")) ||
      (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits))
  );
}
