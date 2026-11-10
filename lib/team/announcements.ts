// Announcement rules. Pure, no database.
//
// An announcement goes to every active staff member, to the staff in one or
// more markets, to bartenders only, or to bartenders in some markets. Each
// person gets at most one text, in their own market's time zone: held in quiet
// hours (9:00 PM to 8:00 AM) unless the admin ticked "Send now".

import { cleanMarkets, marketTz, staffMarketsOf, type Market } from "@/lib/team/markets";
import { inQuietHours, sendableAt } from "@/lib/team/shifts";

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;

export interface AnnouncementInput {
  title: string;
  body: string;
  markets: Market[]; // empty: every market
  bartendersOnly: boolean;
  sendNow: boolean;
}

export function validateAnnouncement(raw: Record<string, unknown>): { ok: true; value: AnnouncementInput } | { ok: false; error: string } {
  const title = String(raw.title ?? "").replace(/\s+/g, " ").trim();
  const body = String(raw.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!title) return { ok: false, error: "Add a title." };
  if (title.length > TITLE_MAX) return { ok: false, error: `Keep the title under ${TITLE_MAX} characters.` };
  if (!body) return { ok: false, error: "Add a message." };
  if (body.length > BODY_MAX) return { ok: false, error: `Keep the message under ${BODY_MAX} characters.` };
  let markets: Market[] = [];
  if (Array.isArray(raw.markets) && raw.markets.length > 0) {
    const m = cleanMarkets(raw.markets);
    if (!m) return { ok: false, error: "Pick a known market." };
    markets = m;
  }
  return { ok: true, value: { title, body, markets, bartendersOnly: raw.bartendersOnly === true, sendNow: raw.sendNow === true } };
}

export interface StaffLike {
  id: string;
  role: string;
  active: boolean;
  markets?: unknown;
}

/** Everyone the announcement reaches, except the admin sending it. */
export function audienceOf<T extends StaffLike>(staff: T[], a: Pick<AnnouncementInput, "markets" | "bartendersOnly">, senderId: string): T[] {
  return staff.filter((s) => {
    if (!s.active || s.id === senderId) return false;
    if (a.bartendersOnly && s.role !== "bartender") return false;
    if (a.markets.length === 0) return true;
    return staffMarketsOf(s).some((m) => a.markets.includes(m));
  });
}

/** The time zone a person's text follows: their first market in the announcement, else their first market. */
export function recipientTz(s: StaffLike, markets: Market[]): string {
  const theirs = staffMarketsOf(s);
  const m = theirs.find((x) => markets.includes(x)) ?? theirs[0];
  return marketTz(m);
}

/** When a person's text may go: now, or 8:00 AM their time when it is quiet hours and "Send now" is off. */
export function announcementSendAfter(now: Date, tz: string, sendNow: boolean): Date {
  return sendNow || !inQuietHours(now, tz) ? now : sendableAt(now, tz);
}

/** "Mix Fix announcement: Holiday schedule. Read it: https://..." */
export function announcementText(o: { title: string; link: string }): string {
  return `Mix Fix announcement: ${o.title}. Read it: ${o.link}`;
}

/** "To everyone", "To bartenders in Austin and Houston". */
export function audienceLabel(a: { markets: string[]; bartenders_only: boolean }, label: (m: string) => string): string {
  const who = a.bartenders_only ? "bartenders" : "everyone";
  if (!a.markets.length) return `To ${who}`;
  const names = a.markets.map(label);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return a.bartenders_only ? `To bartenders in ${list}` : `To everyone in ${list}`;
}
