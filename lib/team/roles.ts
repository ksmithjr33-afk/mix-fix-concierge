// Staff types. Pure, no database.
//
// - admin: everything.
// - manager: everything an admin can do, except deactivating or removing an
//   admin, changing an admin's role, or making someone an admin (checked on
//   the server in lib/team/assignments-db.ts). Managers get the admin header,
//   admin texts and admin alerts.
// - bartender, bar back, server, event helper: the staff experience (events,
//   Tools, Supplies, chat, clock, wrap up), with the role shown next to their
//   name on the event team list, the assign panel and the staff list.
//
// ADMIN_PHONES still signs in (and adds) admins.

export const ROLES = ["admin", "manager", "bartender", "bar_back", "server", "event_helper"] as const;
export type Role = (typeof ROLES)[number];

/** The staff experience roles, the ones that work events. */
export const FIELD_ROLES: readonly Role[] = ["bartender", "bar_back", "server", "event_helper"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  bartender: "Bartender",
  bar_back: "Bar back",
  server: "Server",
  event_helper: "Event helper",
};

export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/** The admin side of the portal: admins and managers. */
export const isAdminRole = (role: unknown): boolean => role === "admin" || role === "manager";

/** Only a real admin (not a manager): the few things managers cannot do. */
export const isFullAdmin = (role: unknown): boolean => role === "admin";

/** The staff experience: bartender, bar back, server, event helper. */
export const isFieldRole = (role: unknown): boolean => typeof role === "string" && (FIELD_ROLES as readonly string[]).includes(role);

/** "Bar back". Unknown roles read as Bartender, the default. */
export const roleLabel = (role: unknown): string => (isRole(role) ? ROLE_LABEL[role] : "Bartender");

/** " (bar back)" after a name, for everyone but bartenders. Empty for bartenders. */
export const roleSuffix = (role: unknown): string => (isRole(role) && role !== "bartender" ? ` (${ROLE_LABEL[role].toLowerCase()})` : "");
