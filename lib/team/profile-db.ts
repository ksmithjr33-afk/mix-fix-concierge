// Staff profiles: the database side. Server only.
//
// Profiles live in staff_profiles, apart from the staff table, so home address
// and email never ride along when staff lists are read for other pages. Every
// reader here takes the viewer and leaves address and email out unless the
// viewer is an admin or the person themself. Saving a new home address finds
// it on the map with the existing geocoder; a miss never fails the save.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { geocodeAddress } from "@/lib/team/geocode";
import { eventLocation } from "@/lib/team/clock-db";
import { certRows } from "@/lib/team/certs-db";
import { profileCertTypes } from "@/lib/team/cert-config";
import { marketLabel, marketTz, staffMarketsOf } from "@/lib/team/markets";
import { todayIn } from "@/lib/team/time";
import {
  canEditProfile,
  cleanFullName,
  cleanProfile,
  completeness,
  distanceNote,
  expiryLabel,
  missingItems,
  needsPrompt,
  profileFor,
  shownExpiry,
  toCsv,
  type DistanceNote,
  type ExpiryTone,
  type ProfileRow,
  type ProfileView,
} from "@/lib/team/profile";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

interface Person {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  markets?: unknown;
}

export async function getProfile(staffId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from("staff_profiles").select("*").eq("staff_id", staffId).maybeSingle();
  if (error) return null; // before the table exists
  return (data as ProfileRow | null) ?? null;
}

async function profilesFor(ids: string[]): Promise<Map<string, ProfileRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("staff_profiles").select("*").in("staff_id", ids);
  if (error || !data) return new Map();
  return new Map((data as ProfileRow[]).map((r) => [r.staff_id, r]));
}

async function person(id: string): Promise<Person | null> {
  const { data } = await supabase.from("staff").select("*").eq("id", id).maybeSingle();
  return (data as Person | null) ?? null;
}

const todayFor = (p: Person, now: Date) => todayIn(marketTz(staffMarketsOf(p)[0] ?? null), now);

export interface ProfilePage {
  view: ProfileView;
  missing: string[];
  certTypes: string[];
  done: number;
  total: number;
}

/** A profile as this viewer may see it, with what is missing. Null when the person does not exist. */
export async function viewProfile(viewer: StaffMember, staffId: string, now: Date = new Date()): Promise<ProfilePage | null> {
  const p = await person(staffId);
  if (!p) return null;
  const [row, certs] = await Promise.all([getProfile(staffId), certRows([staffId])]);
  const types = profileCertTypes(staffMarketsOf(p));
  const missing = missingItems(p, row, certs, types, todayFor(p, now));
  const c = completeness(missing, types);
  return { view: profileFor(viewer, p, row), missing, certTypes: types, done: c.done, total: c.total };
}

/**
 * Save a profile. A bartender saves their own; an admin saves anyone's. The
 * name can be changed here; the phone is the sign in, so only admins change
 * it, from the Staff page.
 */
export async function saveProfile(actor: StaffMember, staffId: string, raw: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ profile: ProfilePage }>> {
  if (!canEditProfile(actor, staffId)) return { ok: false, error: "You can only change your own profile.", status: 403 };
  const p = await person(staffId);
  if (!p) return { ok: false, error: "We could not find that person.", status: 404 };
  const clean = cleanProfile(raw);
  if (!clean.ok) return { ok: false, error: clean.error, status: 400 };
  if ("first" in raw || "last" in raw) {
    const name = cleanFullName(raw.first, raw.last);
    if (!name) return { ok: false, error: "Enter a first and last name.", status: 400 };
    if (name !== p.name) {
      const { error } = await supabase.from("staff").update({ name }).eq("id", staffId);
      if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    }
  }
  const before = await getProfile(staffId);
  const v = clean.value;
  const patch: Record<string, unknown> = { staff_id: staffId, ...v, updated_by: actor.id, updated_at: now.toISOString() };
  if ((v.home_address ?? "") !== (before?.home_address ?? "")) {
    const loc = v.home_address ? (await geocodeAddress(v.home_address)).location : null;
    Object.assign(patch, { home_lat: loc?.lat ?? null, home_lng: loc?.lng ?? null, home_geocoded_at: v.home_address ? now.toISOString() : null });
  }
  const { error } = await supabase.from("staff_profiles").upsert(patch, { onConflict: "staff_id" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, profile: (await viewProfile(actor, staffId, now))! };
}

/**
 * After sign in: where to send a bartender once, when their profile has gaps.
 * Marks them asked, so it only happens once. Null for admins and complete profiles.
 */
export async function profilePromptPath(staffId: string, next: string, now: Date = new Date()): Promise<string | null> {
  const p = await person(staffId);
  if (!p) return null;
  const [row, certs] = await Promise.all([getProfile(staffId), certRows([staffId])]);
  const { error: tableErr } = await supabase.from("staff_profiles").select("staff_id").eq("staff_id", staffId);
  if (tableErr) return null; // before the table exists
  const missing = missingItems(p, row, certs, profileCertTypes(staffMarketsOf(p)), todayFor(p, now));
  if (!needsPrompt(p, row, missing)) return null;
  const { error } = await supabase.from("staff_profiles").upsert({ staff_id: staffId, prompted_at: now.toISOString() }, { onConflict: "staff_id" });
  if (error) return null;
  return `/team/me/profile?first=1&next=${encodeURIComponent(next)}`;
}

// ----- The admin Staff page -----

export interface CertBadge {
  certType: string;
  text: string; // "expires in 23 days", "expired", "good to 2027-03-01", "not on file"
  tone: ExpiryTone;
}

export interface StaffOverview {
  markets: string; // "Dallas, Austin"
  dropoffTime: string;
  maxMiles: number | null;
  certs: CertBadge[];
  done: number;
  total: number;
  missing: string[];
  expiringSoon: boolean; // a certificate inside 30 days or expired
}

/** Admins only: per person, what the Staff page shows at a glance. */
export async function staffOverview(viewer: StaffMember, staff: Person[], now: Date = new Date()): Promise<Record<string, StaffOverview>> {
  if (viewer.role !== "admin") return {};
  const ids = staff.map((s) => s.id);
  const [profiles, certs] = await Promise.all([profilesFor(ids), certRows(ids)]);
  const out: Record<string, StaffOverview> = {};
  for (const s of staff) {
    const markets = staffMarketsOf(s);
    const types = profileCertTypes(markets);
    const mine = certs.filter((c) => c.staff_id === s.id);
    const today = todayFor(s, now);
    const row = profiles.get(s.id) ?? null;
    const missing = missingItems(s, row, mine, types, today);
    const c = completeness(missing, types);
    const badges = types.map((t) => ({ certType: t, ...expiryLabel(shownExpiry(mine, t, today), today) }));
    out[s.id] = {
      markets: markets.map((m) => marketLabel(m)).join(", "),
      dropoffTime: row?.dropoff_time ?? "",
      maxMiles: row?.max_miles ?? null,
      certs: badges,
      done: c.done,
      total: c.total,
      missing,
      expiringSoon: badges.some((b) => b.tone === "amber" || b.tone === "red"),
    };
  }
  return out;
}

function prettyPhone(p: string): string {
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

/** Admins only: every staff profile as CSV. Null for anyone else. */
export async function staffCsv(viewer: StaffMember, now: Date = new Date()): Promise<string | null> {
  if (viewer.role !== "admin" || !viewer.active) return null;
  const { data } = await supabase.from("staff").select("*").order("name");
  const staff = (data as Person[]) ?? [];
  const [profiles, overview] = await Promise.all([profilesFor(staff.map((s) => s.id)), staffOverview(viewer, staff, now)]);
  const header = ["Name", "Role", "Active", "Phone", "Email", "Home address", "Markets", "Drop off time", "Max miles", "Certificates", "Profile complete", "Missing"];
  const rows = staff.map((s) => {
    const p = profiles.get(s.id);
    const o = overview[s.id];
    return [
      s.name,
      s.role === "admin" ? "Admin" : "Bartender",
      s.active ? "Yes" : "No",
      prettyPhone(s.phone),
      p?.email ?? "",
      p?.home_address ?? "",
      o?.markets ?? "",
      p?.dropoff_time ?? "",
      p?.max_miles ?? "",
      (o?.certs ?? []).map((c) => `${c.certType} ${c.text}`).join("; "),
      o ? `${o.done} of ${o.total}` : "",
      (o?.missing ?? []).join("; "),
    ];
  });
  return toCsv(header, rows);
}

// ----- Distance on the assign panel -----

/**
 * Straight line miles from each person's home to the event, and whether it is
 * beyond the farthest they said they will drive. Admins see it on the assign
 * panel as a warning only: it never blocks an assignment.
 */
export async function distancesToEvent(session: SessionRow, staffIds: string[]): Promise<Map<string, DistanceNote>> {
  const out = new Map<string, DistanceNote>();
  if (staffIds.length === 0) return out;
  const [event, profiles] = await Promise.all([eventLocation(session).catch(() => null), profilesFor(staffIds)]);
  if (!event) return out;
  for (const id of staffIds) {
    const p = profiles.get(id);
    const note = distanceNote(p?.home_lat != null && p?.home_lng != null ? { lat: p.home_lat, lng: p.home_lng } : null, event, p?.max_miles ?? null);
    if (note) out.set(id, note);
  }
  return out;
}
