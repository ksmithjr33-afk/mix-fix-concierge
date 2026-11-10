// Staff login: a 6 digit code by text, then a 30 day httpOnly session cookie.
// Server only. Codes and session tokens are stored hashed.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { sendStaffText } from "@/lib/team/sms";
import type { StaffMember } from "@/lib/team/event-view";
import {
  adminPhones,
  checkCode,
  CODE_TTL_MS,
  codeCheckMessage,
  generateCode,
  hashCode,
  hashToken,
  MAX_CODES_PER_HOUR,
  newSessionToken,
  normalizePhone,
  SESSION_COOKIE,
  SESSION_DAYS,
  type CodeRow,
} from "@/lib/team/codes";

const STAFF_COLUMNS = "id, name, phone, role, active";

async function findStaffByPhone(phone: string): Promise<StaffMember | null> {
  const { data, error } = await supabase.from("staff").select(STAFF_COLUMNS).eq("phone", phone).maybeSingle();
  if (error) throw new Error(`staff lookup failed: ${error.message}`);
  return (data as StaffMember | null) ?? null;
}

/**
 * Send a login code if the phone belongs to active staff. A phone in
 * ADMIN_PHONES that is not on the team yet is added as an admin first. Callers
 * show the same message whatever happens here.
 */
export async function requestLoginCode(raw: unknown): Promise<void> {
  const phone = normalizePhone(raw);
  if (!phone) return;

  let staff = await findStaffByPhone(phone);
  if (!staff && adminPhones().has(phone)) {
    const { data, error } = await supabase
      .from("staff")
      .insert({ name: "", phone, role: "admin", active: true })
      .select(STAFF_COLUMNS)
      .single();
    if (error) throw new Error(`admin create failed: ${error.message}`);
    staff = data as StaffMember;
    console.log(`[team-auth] created admin for ${phone} from ADMIN_PHONES`);
  }
  if (!staff || !staff.active) return;

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("staff_login_codes")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= MAX_CODES_PER_HOUR) {
    console.warn(`[team-auth] code limit reached for ${phone}`);
    return;
  }

  const code = generateCode();
  const { error } = await supabase.from("staff_login_codes").insert({
    phone,
    code_hash: hashCode(phone, code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`code insert failed: ${error.message}`);

  const sent = await sendStaffText(phone, staff.name, `Your Mix Fix team code is ${code}. It expires in 10 minutes.`);
  // Local testing without the SMS webhook: print the code. Never in production.
  if (!sent && process.env.NODE_ENV !== "production") console.log(`[team-auth] dev login code for ${phone}: ${code}`);
}

export type VerifyResult = { ok: true; token: string } | { ok: false; message: string };

/** Check a code against the latest one sent to the phone and start a session. */
export async function verifyLoginCode(rawPhone: unknown, rawCode: unknown): Promise<VerifyResult> {
  const phone = normalizePhone(rawPhone);
  const code = String(rawCode ?? "").replace(/\D/g, "");
  if (!phone || code.length !== 6) return { ok: false, message: "Enter the 6 digit code we texted you." };

  const { data } = await supabase
    .from("staff_login_codes")
    .select("id, phone, code_hash, expires_at, attempts, used_at")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data as CodeRow | null) ?? null;
  const result = checkCode(row, phone, code);

  if (result === "wrong" && row) {
    const attempts = row.attempts + 1;
    await supabase.from("staff_login_codes").update({ attempts }).eq("id", row.id);
    return { ok: false, message: codeCheckMessage(result, attempts) };
  }
  if (result !== "ok" || !row) return { ok: false, message: codeCheckMessage(result, row?.attempts ?? 0) };

  // Mark used first so the same code cannot start two sessions.
  const { data: used } = await supabase
    .from("staff_login_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id");
  if (!used || used.length === 0) return { ok: false, message: codeCheckMessage("none", 0) };

  const staff = await findStaffByPhone(phone);
  if (!staff || !staff.active) return { ok: false, message: codeCheckMessage("none", 0) };

  const token = newSessionToken();
  const { error } = await supabase.from("staff_sessions").insert({
    token_hash: hashToken(token),
    staff_id: staff.id,
    expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`session insert failed: ${error.message}`);
  return { ok: true, token };
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 86_400,
};

/** The signed in staff member, or null. Inactive staff are signed out. */
export async function getCurrentStaff(): Promise<StaffMember | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { data, error } = await supabase
    .from("staff_sessions")
    .select(`expires_at, staff:staff_id (${STAFF_COLUMNS})`)
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
  const staff = (Array.isArray(data.staff) ? data.staff[0] : data.staff) as StaffMember | null;
  return staff && staff.active ? staff : null;
}

export async function endSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await supabase.from("staff_sessions").delete().eq("token_hash", hashToken(token));
}

/** Staff with no real name yet: admins added from ADMIN_PHONES start blank (older ones as "Admin"). */
export function needsName(staff: Pick<StaffMember, "name">): boolean {
  const n = staff.name.trim();
  return !n || n.toLowerCase() === "admin";
}

/** First and last name, each 1 to 40 characters. Null when either is missing. */
export function cleanName(first: unknown, last: unknown): string | null {
  const f = String(first ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const l = String(last ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return f && l ? `${f} ${l}` : null;
}

/**
 * The signed in staff member for a page. Sends them to sign in when signed
 * out, and to the name form once when we do not know their name yet.
 */
export async function requireStaff(path: string): Promise<StaffMember> {
  const staff = await getCurrentStaff();
  if (!staff) redirect(`/team?next=${encodeURIComponent(path)}`);
  if (needsName(staff)) redirect(`/team/welcome?next=${encodeURIComponent(path)}`);
  return staff;
}

export async function saveStaffName(staffId: string, name: string): Promise<void> {
  const { error } = await supabase.from("staff").update({ name }).eq("id", staffId);
  if (error) throw new Error(`staff name save failed: ${error.message}`);
}
