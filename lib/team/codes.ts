// Login code and session rules for the staff portal. Pure, no database.

import crypto from "crypto";

export const CODE_TTL_MS = 10 * 60 * 1000; // a code lasts 10 minutes
export const MAX_ATTEMPTS = 5; // wrong tries before the code is dead
export const MAX_CODES_PER_HOUR = 5; // codes sent to one phone per hour
export const SESSION_DAYS = 30;
export const SESSION_COOKIE = "mf_team";

/** The same answer for every phone, known or not, so the form never reveals who is on the team. */
export const CODE_SENT_MESSAGE = "If that number is on our team, we sent a code. It expires in 10 minutes.";

export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(phone: string, code: string): string {
  return crypto.createHash("sha256").update(`${phone}:${code.trim()}`).digest("hex");
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface CodeRow {
  id: string;
  phone: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  used_at: string | null;
}

export type CodeCheck = "ok" | "none" | "expired" | "too_many" | "wrong";

/**
 * Check a typed code against the latest code sent to the phone. Expired and
 * used-up codes fail even when the digits are right.
 */
export function checkCode(row: CodeRow | null, phone: string, typed: string, now: Date = new Date()): CodeCheck {
  if (!row || row.used_at) return "none";
  if (now.getTime() > new Date(row.expires_at).getTime()) return "expired";
  if (row.attempts >= MAX_ATTEMPTS) return "too_many";
  const a = Buffer.from(hashCode(phone, typed));
  const b = Buffer.from(row.code_hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? "ok" : "wrong";
}

export function codeCheckMessage(result: CodeCheck, attemptsAfter: number): string {
  switch (result) {
    case "expired":
      return "That code expired. Request a new one.";
    case "too_many":
      return "Too many tries. Request a new code.";
    case "none":
      return "That code is not valid. Request a new one.";
    case "wrong": {
      const left = MAX_ATTEMPTS - attemptsAfter;
      return left > 0 ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many tries. Request a new code.";
    }
    default:
      return "";
  }
}

/** US numbers as +1XXXXXXXXXX. Null if it is not a phone number. */
export function normalizePhone(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (s.startsWith("+") && digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Phones in env ADMIN_PHONES, separated by commas, semicolons, or new lines. */
export function adminPhones(env: string | undefined = process.env.ADMIN_PHONES): Set<string> {
  return new Set(
    String(env ?? "")
      .split(/[,;\n]+/)
      .map(normalizePhone)
      .filter((p): p is string => p !== null)
  );
}
