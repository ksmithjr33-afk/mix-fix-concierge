// The role a person works on one event: Bartender, Barback, Event helper or
// Server. Pure, no database.
//
// - Kept on the assignment (event_assignments.role), not the profile, so a
//   bartender can work one event as a barback or an event helper.
// - When the assignment has none (a row from before 20270106_assignment_roles.sql,
//   or the column is not there yet) it defaults from the profile role: field
//   roles map to themselves, admins and managers to Bartender.
// - Service fee pay follows it (lib/team/pay.ts: Bartender uses the tier rules,
//   every other role the support rate). Gratuity model events record and show
//   it but pay exactly as before (the profile role still decides the tip split).
// - Staff see their own role, and teammates' first names with roles. Never a
//   tier, a rank, or anyone else's pay.

export const EVENT_ROLES = ["bartender", "bar_back", "event_helper", "server"] as const;
export type EventRole = (typeof EVENT_ROLES)[number];

export const EVENT_ROLE_LABEL: Record<EventRole, string> = {
  bartender: "Bartender",
  bar_back: "Barback",
  event_helper: "Event helper",
  server: "Server",
};

/** The plural for the "needed" counts: "Barbacks needed". */
export const EVENT_ROLE_PLURAL: Record<EventRole, string> = {
  bartender: "Bartenders",
  bar_back: "Barbacks",
  event_helper: "Event helpers",
  server: "Servers",
};

/** The roles other than Bartender, the ones with their own "needed" count beside Bartenders needed. */
export const OTHER_EVENT_ROLES: EventRole[] = ["bar_back", "event_helper", "server"];

export const isEventRole = (v: unknown): v is EventRole => typeof v === "string" && (EVENT_ROLES as readonly string[]).includes(v);

/** The role a new assignment starts with: the profile's when it is a field role, else Bartender. */
export function defaultEventRole(profileRole: unknown): EventRole {
  return isEventRole(profileRole) ? profileRole : "bartender";
}

/** The role on the assignment, else the default from the profile. */
export function eventRoleOf(row: { role?: unknown } | null | undefined, profileRole?: unknown): EventRole {
  return isEventRole(row?.role) ? row.role : defaultEventRole(profileRole);
}

export const eventRoleLabel = (role: unknown): string => EVENT_ROLE_LABEL[isEventRole(role) ? role : "bartender"];

/** "You are working this event as: Barback." Staff see only their own. */
export const workingAsText = (role: unknown): string => `You are working this event as: ${eventRoleLabel(role)}.`;

/** The text when an admin or manager changes the role of someone who accepted. */
export const roleChangeText = (o: { event: string; role: unknown }): string => `Your role on ${o.event} changed to ${eventRoleLabel(o.role)}.`;

/** "Sam (Barback)": a first name with the role, for Also working and the client's bar team. */
export const nameWithRole = (first: string, role: unknown): string => `${first} (${eventRoleLabel(role)})`;

// ----- Needed counts by role -----

export interface RoleNeeds {
  bartender: number | null; // null when unknown
  bar_back: number;
  event_helper: number;
  server: number;
}

export interface RoleCount {
  role: EventRole;
  needed: number | null;
  assigned: number; // offered plus accepted in this role
  accepted: number;
  stillNeeded: number; // 0 when covered or unknown
}

/** Offered and accepted people counted against each role's need. Declined rows never count. */
export function roleCounts(needs: RoleNeeds, rows: { status: string; role: EventRole }[]): RoleCount[] {
  return EVENT_ROLES.map((role) => {
    const mine = rows.filter((r) => r.role === role && (r.status === "accepted" || r.status === "offered"));
    const needed = needs[role];
    const assigned = mine.length;
    return { role, needed, assigned, accepted: mine.filter((r) => r.status === "accepted").length, stillNeeded: needed === null ? 0 : Math.max(0, needed - assigned) };
  });
}

/** Only the rows working the event as Bartender: what "Bartenders needed", offers and open shifts count. */
export function bartenderRows<T extends { role: EventRole }>(rows: T[]): T[] {
  return rows.filter((r) => r.role === "bartender");
}

/** "1 barback still needed, 2 servers still needed" for the roles other than Bartender. Empty when covered. */
export function otherRolesStillNeeded(counts: RoleCount[]): string {
  return counts
    .filter((c) => c.role !== "bartender" && c.stillNeeded > 0)
    .map((c) => `${c.stillNeeded} ${(c.stillNeeded === 1 ? EVENT_ROLE_LABEL[c.role] : EVENT_ROLE_PLURAL[c.role]).toLowerCase()} still needed`)
    .join(", ");
}
