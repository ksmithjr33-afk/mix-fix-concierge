// Certifications, onboarding, and team settings: the database side. Server only.
//
// Files live in the private staff-documents bucket and are only opened through
// a short signed link after checking the viewer is an admin or the owner.
// Texts go through sendStaffText and never block a save.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { firstName } from "@/lib/team/event-view";
import { alertAdmins } from "@/lib/team/events";
import { claimNotice, siteOrigin } from "@/lib/team/clock-db";
import { sendStaffText } from "@/lib/team/sms";
import { isMarket, marketLabel, marketTz, staffMarketsOf, type Market } from "@/lib/team/markets";
import { staffMarkets } from "@/lib/team/markets-db";
import { todayIn } from "@/lib/team/time";
import { inQuietHours } from "@/lib/team/shifts";
import { CERT_TYPES, ONBOARDING, onboardingItem } from "@/lib/team/cert-config";
import {
  adminCertReminderText,
  adminProblemText,
  blocks,
  blockText,
  warnText,
  certExtension,
  certPath,
  certReminderText,
  certReviewedText,
  certStanding,
  certUploadedText,
  NOTE_MAX,
  reminderStep,
  requiredCert,
  shortProblem,
  validateCertUpload,
  type CertRow,
  type CertStanding,
} from "@/lib/team/certs";

export const CERT_BUCKET = "staff-documents";
const FILE_LINK_SECONDS = 10 * 60;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

// ----- Settings -----

/** "Enforce certifications": off by default, and off when the table is missing. */
export async function certsEnforced(): Promise<boolean> {
  const { data, error } = await supabase.from("team_settings").select("value").eq("key", "enforce_certifications").maybeSingle();
  if (error || !data) return false;
  return (data as { value: unknown }).value === true;
}

export async function setCertsEnforced(admin: StaffMember, on: boolean): Promise<Result> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const { error } = await supabase
    .from("team_settings")
    .upsert({ key: "enforce_certifications", value: on, updated_by: admin.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true };
}

// ----- Reading -----

async function todayForStaff(staffId: string, now: Date): Promise<string> {
  return todayIn(marketTz((await staffMarkets(staffId))[0] ?? null), now);
}

export async function certRows(staffIds: string[]): Promise<CertRow[]> {
  if (staffIds.length === 0) return [];
  const { data, error } = await supabase.from("staff_certifications").select("*").in("staff_id", [...new Set(staffIds)]);
  if (error || !data) return [];
  return (data as CertRow[]).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Standing for the certification a market requires. Null when the market has none. */
export async function standingFor(staffId: string, market: Market | null, now: Date = new Date()): Promise<CertStanding | null> {
  const type = requiredCert(market);
  if (!type) return null;
  return certStanding(await certRows([staffId]), type, todayIn(marketTz(market), now));
}

/** Standing for every certification this person's markets require. */
export async function myStandings(staffId: string, now: Date = new Date()): Promise<{ market: Market; standing: CertStanding }[]> {
  const markets = await staffMarkets(staffId);
  const rows = await certRows([staffId]);
  return markets
    .map((m) => ({ market: m, type: requiredCert(m) }))
    .filter((x): x is { market: Market; type: string } => !!x.type)
    .map((x) => ({ market: x.market, standing: certStanding(rows, x.type, todayIn(marketTz(x.market), now)) }));
}

/** "TABC expired" per staff id for one market, for admin lists. Only people with a problem. */
export async function certIssues(staffIds: string[], market: Market | null, now: Date = new Date()): Promise<Record<string, string>> {
  const type = requiredCert(market);
  if (!type) return {};
  const rows = await certRows(staffIds);
  const today = todayIn(marketTz(market), now);
  const out: Record<string, string> = {};
  for (const id of new Set(staffIds)) {
    const p = shortProblem(certStanding(rows.filter((r) => r.staff_id === id), type, today));
    if (p) out[id] = p;
  }
  return out;
}

/** Per person, each required certification and its state, for the staff page. */
export async function certLinesByStaff(staff: { id: string; markets?: unknown; role: string }[], now: Date = new Date()): Promise<Record<string, string>> {
  const rows = await certRows(staff.map((s) => s.id));
  const out: Record<string, string> = {};
  for (const s of staff) {
    if (s.role === "admin") continue;
    const types = new Map<string, Market>();
    for (const m of staffMarketsOf(s)) {
      const t = requiredCert(m);
      if (t && !types.has(t)) types.set(t, m);
    }
    const parts = [...types].map(([t, m]) => {
      const st = certStanding(rows.filter((r) => r.staff_id === s.id), t, todayIn(marketTz(m), now));
      return `${t} ${st.state === "ok" ? `approved to ${st.expiresOn}` : st.state === "pending" ? "waiting for review" : st.state}`;
    });
    if (parts.length) out[s.id] = parts.join(", ");
  }
  return out;
}

// ----- Shift request gate and admin confirm -----

/**
 * Whether a bartender may request a shift in this market. Blocked only when
 * enforcement is on; otherwise a warning comes back with the OK.
 */
export async function requestGate(staffId: string, market: Market | null, now: Date = new Date()): Promise<{ blocked: boolean; standing: CertStanding | null }> {
  const standing = await standingFor(staffId, market, now);
  if (!standing || !blocks(standing.state)) return { blocked: false, standing: null };
  return { blocked: await certsEnforced(), standing };
}

/** For the admin confirm step: the problem to name, only while enforced. */
export async function certConfirmProblem(person: { id: string; name: string }, market: Market | null, now: Date = new Date()): Promise<string | null> {
  if (!(await certsEnforced())) return null;
  const s = await standingFor(person.id, market, now);
  return s && blocks(s.state) ? adminProblemText(firstName(person.name), s) : null;
}

// ----- Upload and review -----

/**
 * Upload a certification. A bartender uploads their own and it waits for
 * review. An admin can enter one for someone else, which is approved as they
 * enter it.
 */
export async function uploadCert(opts: {
  actor: StaffMember;
  staffId: string;
  raw: Record<string, unknown>;
  file: Blob | null;
  fileType: string;
  now?: Date;
}): Promise<Result<{ row: CertRow }>> {
  const now = opts.now ?? new Date();
  const { actor } = opts;
  const forOther = opts.staffId !== actor.id;
  if (forOther && actor.role !== "admin") return { ok: false, error: "You can only upload your own certification.", status: 403 };
  const { data: p } = await supabase.from("staff").select("id, name, phone, role, active").eq("id", opts.staffId).maybeSingle();
  const person = p as { id: string; name: string; phone: string } | null;
  if (!person) return { ok: false, error: "We could not find that person.", status: 404 };
  const today = await todayForStaff(person.id, now);
  const v = validateCertUpload(opts.raw, opts.file ? { type: opts.fileType, size: opts.file.size } : null, today);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };

  const path = certPath(person.id, v.value.certType, now, certExtension(opts.fileType));
  const { error: upErr } = await supabase.storage.from(CERT_BUCKET).upload(path, opts.file!, { contentType: opts.fileType, upsert: false });
  if (upErr) {
    console.error("[team] cert upload failed:", upErr.message);
    return { ok: false, error: "The file did not upload. Tap Retry.", status: 500 };
  }
  const approved = forOther; // an admin entering it for someone checked it as they entered it
  const { data, error } = await supabase
    .from("staff_certifications")
    .insert({
      staff_id: person.id,
      cert_type: v.value.certType,
      file_path: path,
      file_type: opts.fileType,
      expires_on: v.value.expiresOn,
      status: approved ? "approved" : "pending",
      reviewed_by: approved ? actor.id : null,
      reviewed_at: approved ? now.toISOString() : null,
      review_note: null,
      uploaded_by: actor.id,
      created_at: now.toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) {
    await supabase.storage.from(CERT_BUCKET).remove([path]);
    return { ok: false, error: "Could not save. Try again.", status: 500 };
  }
  if (!approved) {
    try {
      const message = certUploadedText({ name: person.name || "A bartender", certType: v.value.certType, link: `${siteOrigin()}/team/admin/staff/${person.id}` });
      const admins = await alertAdmins();
      await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
    } catch (err) {
      console.error("[team] cert upload text failed:", err instanceof Error ? err.message : String(err));
    }
  }
  return { ok: true, row: data as CertRow };
}

/** Approve or reject a pending certification. A rejection needs a note. Nobody reviews their own. */
export async function reviewCert(admin: StaffMember, id: string, decision: "approve" | "reject", rawNote: unknown, now: Date = new Date()): Promise<Result> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const note = String(rawNote ?? "").trim().replace(/\s+/g, " ").slice(0, NOTE_MAX);
  if (decision === "reject" && note.length < 3) return { ok: false, error: "Add a note saying why.", status: 400 };
  const { data } = await supabase.from("staff_certifications").select("*").eq("id", id).maybeSingle();
  const row = data as CertRow | null;
  if (!row) return { ok: false, error: "We could not find that certification.", status: 404 };
  if (row.staff_id === admin.id) return { ok: false, error: "Someone else has to review your certification.", status: 403 };
  const { error } = await supabase
    .from("staff_certifications")
    .update({ status: decision === "approve" ? "approved" : "rejected", review_note: note || null, reviewed_by: admin.id, reviewed_at: now.toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  const { data: p } = await supabase.from("staff").select("name, phone").eq("id", row.staff_id).maybeSingle();
  const person = p as { name: string; phone: string } | null;
  if (person) {
    await sendStaffText(
      person.phone,
      person.name,
      certReviewedText({ firstName: firstName(person.name), certType: row.cert_type, approved: decision === "approve", note, link: `${siteOrigin()}/team/certifications` })
    );
  }
  return { ok: true };
}

/** A short signed link to the file, for an admin or the owner only. */
export async function certFileLink(viewer: StaffMember, id: string): Promise<string | null> {
  const { data } = await supabase.from("staff_certifications").select("staff_id, file_path").eq("id", id).maybeSingle();
  const row = data as { staff_id: string; file_path: string } | null;
  if (!row || (viewer.role !== "admin" && viewer.id !== row.staff_id)) return null;
  const { data: s, error } = await supabase.storage.from(CERT_BUCKET).createSignedUrl(row.file_path, FILE_LINK_SECONDS);
  if (error || !s) return null;
  return s.signedUrl;
}

// ----- Reminders -----

/**
 * Texts at 30 days, 7 days, and on the day a certification expires, to the
 * bartender and to admins with alerts on. Once per step per certificate, only
 * for the newest valid one of each type, and not during quiet hours.
 */
export async function sendCertReminders(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from("staff_certifications").select("*").in("status", ["approved", "pending"]);
  if (error || !data) return 0;
  const rows = data as CertRow[];
  const { data: people } = await supabase.from("staff").select("id, name, phone, active, role, markets").in("id", [...new Set(rows.map((r) => r.staff_id))]);
  const staff = new Map(((people as { id: string; name: string; phone: string; active: boolean; markets?: unknown }[]) ?? []).map((s) => [s.id, s]));
  let admins: { name: string; phone: string }[] | null = null;
  let sent = 0;
  for (const r of rows) {
    const person = staff.get(r.staff_id);
    if (!person || !person.active || !CERT_TYPES.includes(r.cert_type)) continue;
    const market = staffMarketsOf(person)[0] ?? null;
    const tz = marketTz(market);
    if (inQuietHours(now, tz)) continue;
    const today = todayIn(tz, now);
    // Renewed: a newer certificate of the same type that runs longer
    if (rows.some((o) => o.staff_id === r.staff_id && o.cert_type === r.cert_type && o.id !== r.id && o.expires_on > r.expires_on)) continue;
    const step = reminderStep(r.expires_on, today);
    if (step === null) continue;
    if (!(await claimNotice(`cert_reminder:${r.id}:${step}`, "cert_reminder"))) continue;
    if (await sendStaffText(person.phone, person.name, certReminderText({ firstName: firstName(person.name), certType: r.cert_type, expiresOn: r.expires_on, today, link: `${siteOrigin()}/team/certifications` }))) sent++;
    admins ??= await alertAdmins();
    const msg = adminCertReminderText({ name: person.name || "A bartender", certType: r.cert_type, expiresOn: r.expires_on, today, link: `${siteOrigin()}/team/admin/staff/${person.id}` });
    await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, msg)));
  }
  return sent;
}

// ----- Onboarding -----

export async function onboardingDone(staffId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("staff_onboarding").select("item_id, acknowledged_at").eq("staff_id", staffId);
  if (error || !data) return new Map();
  return new Map((data as { item_id: string; acknowledged_at: string }[]).map((r) => [r.item_id, r.acknowledged_at]));
}

export async function acknowledgeItem(staff: StaffMember, itemId: string, now: Date = new Date()): Promise<Result> {
  if (!onboardingItem(itemId)) return { ok: false, error: "We could not find that step.", status: 404 };
  const { error } = await supabase
    .from("staff_onboarding")
    .upsert({ staff_id: staff.id, item_id: itemId, acknowledged_at: now.toISOString() }, { onConflict: "staff_id,item_id" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true };
}

/** Steps done per person, for the staff page. Only steps still in the config count. */
export async function onboardingProgress(staffIds: string[]): Promise<Map<string, number>> {
  const out = new Map(staffIds.map((id) => [id, 0]));
  if (staffIds.length === 0) return out;
  const { data, error } = await supabase.from("staff_onboarding").select("staff_id, item_id").in("staff_id", staffIds);
  if (error || !data) return out;
  const ids = new Set(ONBOARDING.map((i) => i.id));
  for (const r of data as { staff_id: string; item_id: string }[]) if (ids.has(r.item_id)) out.set(r.staff_id, (out.get(r.staff_id) ?? 0) + 1);
  return out;
}

export { isMarket, marketLabel };

/** The certification notice on one posted shift: blocked (enforced) or a warning. Null when fine. */
export async function certNoticeForPost(postId: string, staffId: string, now: Date = new Date()): Promise<{ blocked: boolean; text: string } | null> {
  const { data } = await supabase.from("shift_posts").select("market").eq("id", postId).maybeSingle();
  const market = (data as { market?: unknown } | null)?.market;
  if (!isMarket(market)) return null;
  const gate = await requestGate(staffId, market, now);
  if (!gate.standing) return null;
  return { blocked: gate.blocked, text: gate.blocked ? blockText(gate.standing, marketLabel(market)) : warnText(gate.standing, marketLabel(market)) };
}

/** One line per market with a problem, for the Open shifts tab. */
export async function myCertNotices(staffId: string, now: Date = new Date()): Promise<{ enforced: boolean; lines: string[] }> {
  const [standings, enforced] = await Promise.all([myStandings(staffId, now), certsEnforced()]);
  const lines = standings.filter((s) => blocks(s.standing.state)).map((s) => (enforced ? blockText(s.standing, marketLabel(s.market)) : warnText(s.standing, marketLabel(s.market))));
  return { enforced, lines };
}
