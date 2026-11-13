// Staff profiles: the rules. Pure, no database.
//
// A profile holds name and phone (on the staff row), and email, home address,
// preferred time for material drop offs, the farthest someone will drive to an
// event, and their certificates. Home address and email are private: only
// admins and the person themself ever see them.

import { daysLeft, type CertRow, certStanding } from "@/lib/team/certs";

export interface ProfileRow {
  staff_id: string;
  email: string | null;
  home_address: string | null;
  home_lat: number | null;
  home_lng: number | null;
  home_geocoded_at?: string | null;
  dropoff_time: string | null;
  max_miles: number | null;
  prompted_at?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
}

export interface ProfileInput {
  email: string | null;
  home_address: string | null;
  dropoff_time: string | null;
  max_miles: number | null;
}

/** Suggestions for the drop off time box. Anything typed is fine. */
export const DROPOFF_CHOICES = ["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Weekends", "Any time"];
export const MAX_MILES_LIMIT = 500;

function clip(v: unknown, max: number): string | null {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
}

/** The profile form, checked. Empty fields are allowed: the profile just shows them as missing. */
export function cleanProfile(raw: Record<string, unknown>): { ok: true; value: ProfileInput } | { ok: false; error: string } {
  const email = clip(raw.email, 200)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Check the email address." };
  const home = clip(raw.home_address, 300);
  if (home && home.length < 8) return { ok: false, error: "Enter the full home address, with the city." };
  const milesRaw = raw.max_miles === "" || raw.max_miles === null || raw.max_miles === undefined ? null : Number(raw.max_miles);
  if (milesRaw !== null && (!Number.isFinite(milesRaw) || milesRaw < 1 || milesRaw > MAX_MILES_LIMIT)) return { ok: false, error: `Enter the farthest you will drive, 1 to ${MAX_MILES_LIMIT} miles.` };
  return { ok: true, value: { email, home_address: home, dropoff_time: clip(raw.dropoff_time, 100), max_miles: milesRaw === null ? null : Math.round(milesRaw) } };
}

/** First and last name, each 1 to 40 characters (the same rule as the welcome form). Null when either is missing. */
export function cleanFullName(first: unknown, last: unknown): string | null {
  const f = String(first ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const l = String(last ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return f && l ? `${f} ${l}` : null;
}

/** Home address and email: only admins and the person themself. */
export function canSeePrivate(viewer: { id: string; role: string; active: boolean }, staffId: string): boolean {
  if (!viewer.active) return false;
  return viewer.role === "admin" || viewer.id === staffId;
}

/** Who may change a profile: admins, and the person themself. */
export function canEditProfile(viewer: { id: string; role: string; active: boolean }, staffId: string): boolean {
  return canSeePrivate(viewer, staffId);
}

export interface ProfileView {
  staffId: string;
  name: string;
  phone: string;
  email: string | null; // null when the viewer may not see it
  homeAddress: string | null; // null when the viewer may not see it
  homeLocated: boolean; // the address was found on the map
  dropoffTime: string;
  maxMiles: number | null;
  private: boolean; // email and address are included
}

/** The profile as a given viewer may see it. Other bartenders get no address and no email. */
export function profileFor(viewer: { id: string; role: string; active: boolean }, person: { id: string; name: string; phone: string }, row: ProfileRow | null): ProfileView {
  const priv = canSeePrivate(viewer, person.id);
  return {
    staffId: person.id,
    name: person.name,
    phone: person.phone,
    email: priv ? (row?.email ?? "") : null,
    homeAddress: priv ? (row?.home_address ?? "") : null,
    homeLocated: priv && row?.home_lat != null && row?.home_lng != null,
    dropoffTime: row?.dropoff_time ?? "",
    maxMiles: row?.max_miles ?? null,
    private: priv,
  };
}

/** A certificate is on file when one is approved or waiting for review and not expired. */
export function certOnFile(rows: CertRow[], certType: string, today: string): boolean {
  const s = certStanding(rows, certType, today);
  return s.state === "ok" || s.state === "pending";
}

/** What is still missing from a profile, in the order the form asks. */
export function missingItems(person: { name: string; phone: string }, row: ProfileRow | null, certs: CertRow[], certTypes: string[], today: string): string[] {
  const out: string[] = [];
  if (!person.name.trim()) out.push("Name");
  if (!person.phone.trim()) out.push("Phone");
  if (!row?.email) out.push("Email");
  if (!row?.home_address) out.push("Home address");
  if (!row?.dropoff_time) out.push("Drop off time");
  if (!row?.max_miles) out.push("Farthest you will drive");
  for (const t of certTypes) if (!certOnFile(certs, t, today)) out.push(t);
  return out;
}

/** "5 of 8": the profile completeness marker. */
export function completeness(missing: string[], certTypes: string[]): { done: number; total: number; complete: boolean } {
  const total = 6 + certTypes.length;
  return { done: total - missing.length, total, complete: missing.length === 0 };
}

/** Bartenders are asked once after sign in when something is missing. Admins are not asked. */
export function needsPrompt(person: { role: string }, row: ProfileRow | null, missing: string[]): boolean {
  if (person.role === "admin") return false;
  return !row?.prompted_at && missing.length > 0;
}

// ----- Certificate expiry on the Staff page -----

export const EXPIRING_SOON_DAYS = 30;

export type ExpiryTone = "ok" | "amber" | "red" | "missing";

/** "expires in 23 days" (amber inside 30 days), "expired" (red), or the date. */
export function expiryLabel(expiresOn: string | null, today: string): { text: string; tone: ExpiryTone } {
  if (!expiresOn) return { text: "not on file", tone: "missing" };
  const left = daysLeft(expiresOn, today);
  if (left < 0) return { text: "expired", tone: "red" };
  if (left === 0) return { text: "expires today", tone: "amber" };
  if (left <= EXPIRING_SOON_DAYS) return { text: `expires in ${left} ${left === 1 ? "day" : "days"}`, tone: "amber" };
  return { text: `good to ${expiresOn}`, tone: "ok" };
}

/** The expiry date the Staff page shows for one certificate type: the best one on file, or the latest expired. */
export function shownExpiry(rows: CertRow[], certType: string, today: string): string | null {
  const s = certStanding(rows, certType, today);
  return s.state === "missing" || s.state === "rejected" ? null : s.expiresOn;
}

// ----- Distance -----

export interface LatLng {
  lat: number;
  lng: number;
}

/** Straight line miles between two points. */
export function straightMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface DistanceNote {
  miles: number; // rounded, straight line
  maxMiles: number | null;
  over: boolean; // beyond what they said they will drive: a warning, never a block
  text: string; // "about 23 mi" or "about 41 mi, over their 30 mi max"
}

export function distanceNote(home: LatLng | null, event: LatLng | null, maxMiles: number | null): DistanceNote | null {
  if (!home || !event) return null;
  const miles = Math.round(straightMiles(home, event));
  const over = maxMiles != null && miles > maxMiles;
  return { miles, maxMiles, over, text: `about ${miles} mi away${over ? `, over their ${maxMiles} mi max` : ""}` };
}

// ----- CSV for admins -----

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
