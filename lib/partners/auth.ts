// Partner login: the staff login code approach (a 6 digit code by text, the
// same expiry, tries and hourly limit), with its own code table, session table
// and cookie. A staff session can never open a partner page, and a partner
// session can never open a team page: neither cookie is read by the other side
// and neither token is in the other side's table. Server only.
//
// Who can sign in: an active partner, or a host whose phone is on an event
// (hosts see that event read only). Callers show the same message whatever
// happens, so the form never reveals who has an account.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { sendStaffText } from "@/lib/team/sms";
import {
  checkCode,
  CODE_TTL_MS,
  codeCheckMessage,
  generateCode,
  hashCode,
  hashToken,
  MAX_CODES_PER_HOUR,
  newSessionToken,
  normalizePhone,
  SESSION_DAYS,
  type CodeRow,
} from "@/lib/team/codes";
import { PARTNER_COOKIE, type Partner } from "@/lib/partners/rules";
import { surpriseActive, type SurpriseColumns } from "@/lib/partners/surprise";

export const PARTNER_CODE_SENT_MESSAGE = "If that number has access, we sent a code. It expires in 10 minutes.";
export const PARTNER_COLUMNS = "id, type, name, company, phone, email, website, markets, active, last_sign_in_at, created_at";

/** The signed in person on the partner side. */
export type Principal = { kind: "partner"; partner: Partner } | { kind: "host"; phone: string; name: string };

export async function findPartnerByPhone(phone: string): Promise<Partner | null> {
  const { data, error } = await supabase.from("partners").select(PARTNER_COLUMNS).eq("phone", phone).maybeSingle();
  if (error) return null; // before the migration
  return (data as Partner | null) ?? null;
}

/**
 * A host with this phone on any event, and the name on the most recent one.
 * A surprise event never counts: its host cannot sign in until the block lifts.
 * (Selects every column, so it reads the same before the surprise migration.)
 */
async function findHost(phone: string): Promise<{ name: string } | null> {
  const { data, error } = await supabase.from("sessions").select("*").eq("host_phone", phone);
  if (error || !data || data.length === 0) return null;
  const live = (data as (SurpriseColumns & { host_name: string | null; created_at?: string; team_market?: string | null; event_date?: string | null; event_data?: Record<string, unknown> | null })[]).filter(
    (s) => !surpriseActive(s, new Date(), s.team_market === "los_angeles" ? "America/Los_Angeles" : "America/Chicago")
  );
  if (live.length === 0) return null;
  const rows = live.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return { name: rows[0].host_name ?? "" };
}

/** Who may get a code for this phone: an active partner first, then a host. */
async function whoCanSignIn(phone: string): Promise<{ name: string } | null> {
  const partner = await findPartnerByPhone(phone);
  if (partner) return partner.active ? { name: partner.name } : null;
  return findHost(phone);
}

export async function requestPartnerCode(raw: unknown): Promise<void> {
  const phone = normalizePhone(raw);
  if (!phone) return;
  const who = await whoCanSignIn(phone);
  if (!who) return;

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase.from("partner_login_codes").select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", hourAgo);
  if ((count ?? 0) >= MAX_CODES_PER_HOUR) {
    console.warn(`[partner-auth] code limit reached for ${phone}`);
    return;
  }
  const code = generateCode();
  const { error } = await supabase.from("partner_login_codes").insert({
    phone,
    code_hash: hashCode(phone, code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`partner code insert failed: ${error.message}`);
  // A code is asked for right now, so it is never held for quiet hours.
  const sent = await sendStaffText(phone, who.name, `Your Mix Fix partner code is ${code}. It expires in 10 minutes.`);
  if (!sent && process.env.NODE_ENV !== "production") console.log(`[partner-auth] dev login code for ${phone}: ${code}`);
}

export type PartnerVerifyResult = { ok: true; token: string } | { ok: false; message: string };

export async function verifyPartnerCode(rawPhone: unknown, rawCode: unknown): Promise<PartnerVerifyResult> {
  const phone = normalizePhone(rawPhone);
  const code = String(rawCode ?? "").replace(/\D/g, "");
  if (!phone || code.length !== 6) return { ok: false, message: "Enter the 6 digit code we texted you." };

  const { data } = await supabase
    .from("partner_login_codes")
    .select("id, phone, code_hash, expires_at, attempts, used_at")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data as CodeRow | null) ?? null;
  const result = checkCode(row, phone, code);
  if (result === "wrong" && row) {
    const attempts = row.attempts + 1;
    await supabase.from("partner_login_codes").update({ attempts }).eq("id", row.id);
    return { ok: false, message: codeCheckMessage(result, attempts) };
  }
  if (result !== "ok" || !row) return { ok: false, message: codeCheckMessage(result, row?.attempts ?? 0) };

  const { data: used } = await supabase.from("partner_login_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id).is("used_at", null).select("id");
  if (!used || (used as unknown[]).length === 0) return { ok: false, message: codeCheckMessage("none", 0) };

  const partner = await findPartnerByPhone(phone);
  let owner: { partner_id: string } | { host_phone: string };
  if (partner) {
    if (!partner.active) return { ok: false, message: codeCheckMessage("none", 0) };
    owner = { partner_id: partner.id };
  } else if (await findHost(phone)) {
    owner = { host_phone: phone };
  } else {
    return { ok: false, message: codeCheckMessage("none", 0) };
  }

  const token = newSessionToken();
  const { error } = await supabase.from("partner_sessions").insert({
    token_hash: hashToken(token),
    ...owner,
    expires_at: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`partner session insert failed: ${error.message}`);
  if (partner) await supabase.from("partners").update({ last_sign_in_at: new Date().toISOString() }).eq("id", partner.id);
  return { ok: true, token };
}

export const partnerCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 86_400,
};

/**
 * The signed in partner or host, from the partner cookie only. A deactivated
 * partner is signed out on the next request, and a host with no event left
 * under their phone is too.
 */
export async function getCurrentPrincipal(): Promise<Principal | null> {
  const token = (await cookies()).get(PARTNER_COOKIE)?.value;
  if (!token) return null;
  const { data, error } = await supabase.from("partner_sessions").select("partner_id, host_phone, expires_at").eq("token_hash", hashToken(token)).maybeSingle();
  if (error || !data) return null;
  const row = data as { partner_id: string | null; host_phone: string | null; expires_at: string };
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  if (row.partner_id) {
    const { data: p } = await supabase.from("partners").select(PARTNER_COLUMNS).eq("id", row.partner_id).maybeSingle();
    const partner = (p as Partner | null) ?? null;
    return partner && partner.active ? { kind: "partner", partner } : null;
  }
  if (row.host_phone) {
    const host = await findHost(row.host_phone);
    return host ? { kind: "host", phone: row.host_phone, name: host.name } : null;
  }
  return null;
}

/** For partner pages: signed in, or off to the partner sign in. */
export async function requirePrincipal(): Promise<Principal> {
  const p = await getCurrentPrincipal();
  if (!p) redirect("/partners");
  return p;
}

export async function endPartnerSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await supabase.from("partner_sessions").delete().eq("token_hash", hashToken(token));
}

/** Deactivating a partner ends every session at once. */
export async function endAllPartnerSessions(partnerId: string): Promise<void> {
  await supabase.from("partner_sessions").delete().eq("partner_id", partnerId);
}
