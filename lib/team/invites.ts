// Resend invite: the welcome text with the sign in link, sent again by an
// admin or manager from the Staff page or a staff profile. Pure, no database,
// so the test scripts can check it. The send and the log are in
// lib/team/invites-db.ts.
//
// Adding a staff member has never sent a text; this is the one welcome text.
// Quiet hours never hold it: an admin pressing the button means the person is
// waiting for it right now.

export interface InviteStatus {
  signIn: string; // "Last sign in Nov 3, 2026, 4:12 PM" or "Never signed in"
  lastInvite: string; // "Last invite Nov 20, 2026, 4:15 PM by Kenneth", "" when none
}

/** One resend per person every two minutes. */
export const INVITE_GAP_MS = 2 * 60 * 1000;

/** The welcome text. No hyphens: it goes out as a text. */
export function welcomeText(o: { firstName: string; link: string }): string {
  return `Hi ${o.firstName || "there"}, welcome to The Mix Fix team! Sign in to the team portal here: ${o.link} Enter this phone number and we will text you a code.`;
}

/** The last four digits of a phone number, "1234". */
export function lastFour(phone: string): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-4);
}

/** "Invite sent to ••• 1234 at Nov 20, 2026, 4:15 PM". */
export function sentLine(phone: string, stamp: string): string {
  return `Invite sent to ••• ${lastFour(phone)}${stamp ? ` at ${stamp}` : ""}`;
}

/** Milliseconds left before another invite can go to this person: 0 when one can go now. */
export function inviteWaitMs(lastAt: string | null | undefined, now: Date = new Date()): number {
  if (!lastAt) return 0;
  const t = new Date(lastAt).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, t + INVITE_GAP_MS - now.getTime());
}

/** "Last sign in Nov 3, 2026, 4:12 PM", or "Never signed in". */
export function signInLine(stamp: string): string {
  return stamp ? `Last sign in ${stamp}` : "Never signed in";
}
