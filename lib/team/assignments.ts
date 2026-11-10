// Assignments: who works which event, the texts they get, and who gets admin
// alerts. Pure, no database.

import { staffChange, type StaffMember } from "@/lib/team/event-view";
import { eventDay, shortDate } from "@/lib/team/time";
import { cleanMarkets, DEFAULT_MARKET, type Market } from "@/lib/team/markets";

export type AssignmentStatus = "offered" | "accepted" | "declined";
export type Response = "accept" | "decline";

/** Staff as stored, with the admin alerts setting. Only admins use alerts; it is on by default. */
export interface StaffRecord extends StaffMember {
  alerts: boolean;
  markets: Market[];
}

/** Admin alert texts (declines, missing items, bar ready) go only to active admins with alerts on. */
export function alertRecipients<T extends { role: string; active: boolean; alerts?: boolean | null }>(staff: T[]): T[] {
  return staff.filter((s) => s.role === "admin" && s.active && s.alerts !== false);
}

/** Offered staff can accept or decline. Accepted staff can still decline. Declined is final until an admin assigns again. */
export function canRespond(status: AssignmentStatus | null | undefined, response: Response): boolean {
  if (status === "offered") return true;
  if (status === "accepted") return response === "decline";
  return false;
}

export function statusAfter(response: Response): AssignmentStatus {
  return response === "accept" ? "accepted" : "declined";
}

export interface StaffingCounts {
  needed: number | null; // bartenders the event needs, null when unknown
  assigned: number; // offered plus accepted
  accepted: number;
  offered: number;
  declined: number;
  stillNeeded: number; // 0 when covered or unknown
}

export function staffingCounts(needed: number | null, statuses: AssignmentStatus[]): StaffingCounts {
  const accepted = statuses.filter((s) => s === "accepted").length;
  const offered = statuses.filter((s) => s === "offered").length;
  const declined = statuses.filter((s) => s === "declined").length;
  const assigned = accepted + offered;
  return { needed, assigned, accepted, offered, declined, stillNeeded: needed === null ? 0 : Math.max(0, needed - assigned) };
}

/** "2 of 3 assigned", or "2 assigned" when the count needed is unknown. */
export function staffingLabel(c: StaffingCounts): string {
  return c.needed === null ? `${c.assigned} assigned` : `${c.assigned} of ${c.needed} assigned`;
}

export function assignText(o: { firstName: string; date: string; arrival: string; link: string }): string {
  return `Hi ${o.firstName || "there"}, you have a new Mix Fix event on ${o.date}, arrive ${o.arrival || "time to be confirmed"}. Accept or decline here: ${o.link}`;
}

export function removalText(o: { firstName: string; date: string }): string {
  return `Hi ${o.firstName || "there"}, you are no longer scheduled for the Mix Fix event on ${o.date}. No action needed.`;
}

export function declineText(o: { firstName: string; title: string; date: string; link: string }): string {
  return `${o.firstName || "A bartender"} declined ${o.title} on ${o.date}. Assign someone else here: ${o.link}`;
}

export function updateText(o: { date: string; link: string }): string {
  return `Your event on ${o.date} was updated. Check your event page: ${o.link}`;
}

export const ROLES = ["bartender", "admin"] as const;

export interface StaffInput {
  name: string;
  phone: string;
  role: "bartender" | "admin";
  markets: Market[];
}

/**
 * The staff form: first and last name, a US phone, and a role. Returns the
 * cleaned record or an error to show.
 */
export function validateStaffInput(
  raw: { first?: unknown; last?: unknown; phone?: unknown; role?: unknown; markets?: unknown },
  normalizePhone: (v: unknown) => string | null
): { ok: true; value: StaffInput } | { ok: false; error: string } {
  const first = String(raw.first ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const last = String(raw.last ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!first || !last) return { ok: false, error: "Enter a first and last name." };
  const phone = normalizePhone(raw.phone);
  if (!phone) return { ok: false, error: "Enter a 10 digit phone number." };
  const role = raw.role === "admin" ? "admin" : raw.role === "bartender" || raw.role === undefined ? "bartender" : null;
  if (!role) return { ok: false, error: "Pick a role." };
  // Markets: at least one. A form from before markets existed counts as Dallas.
  const markets = raw.markets === undefined ? [DEFAULT_MARKET] : cleanMarkets(raw.markets);
  if (!markets) return { ok: false, error: "Pick at least one market." };
  return { ok: true, value: { name: `${first} ${last}`, phone, role, markets } };
}

/** Admins cannot deactivate themselves or drop their own admin role, so nobody locks the team out by accident. */
export function selfChangeError(actorId: string, targetId: string, patch: { active?: boolean; role?: string }): string | null {
  if (actorId !== targetId) return null;
  if (patch.active === false) return "You cannot deactivate yourself.";
  if (patch.role !== undefined && patch.role !== "admin") return "You cannot remove your own admin role.";
  return null;
}

export interface UpdateNoticeDeps {
  assignedStaff: (sessionId: string) => Promise<{ phone: string; name: string }[]>;
  send: (phone: string, name: string, message: string) => Promise<boolean>;
}

/**
 * After a client update saves, text each assigned staff member (offered or
 * accepted), only when a field staff can see changed. Never throws: a failed
 * lookup or text is logged and the update stands. Returns how many texts went out.
 */
export async function notifyAssignedStaff(
  session: { id: string; event_date?: string | null; event_data: Record<string, unknown> | null },
  changedFields: string[],
  origin: string,
  deps: UpdateNoticeDeps
): Promise<number> {
  try {
    if (!changedFields.some(staffChange)) return 0;
    const staff = await deps.assignedStaff(session.id);
    if (staff.length === 0) return 0;
    const ed = session.event_data ?? {};
    const message = updateText({ date: shortDate(eventDay(ed.event_date ?? session.event_date)), link: `${origin}/team/e/${session.id}` });
    const sent = await Promise.all(staff.map((s) => deps.send(s.phone, s.name, message).catch(() => false)));
    return sent.filter(Boolean).length;
  } catch (err) {
    console.error(`[team] update texts for ${session.id} failed:`, err instanceof Error ? err.message : String(err));
    return 0;
  }
}

// ----- Hidden events -----

export const HIDE_HAS_STAFF = "Remove the assigned staff first, then hide this event.";

/** An event can be hidden only when nobody is assigned (offered or accepted). Declined rows do not count. */
export function hideError(statuses: AssignmentStatus[]): string | null {
  return statuses.some((s) => s !== "declined") ? HIDE_HAS_STAFF : null;
}

/** Drop hidden events from a list. */
export function withoutHidden<T extends { id: string }>(items: T[], hidden: Set<string>): T[] {
  return items.filter((i) => !hidden.has(i.id));
}
