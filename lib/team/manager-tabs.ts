// The admin manager view's tabs, in order. The selected tab is in the address
// (/team/admin/e/<id>?tab=order) so a link can open a specific tab.

export const MANAGER_TABS = [
  ["details", "Details"],
  ["team", "Team"],
  ["order", "Order sheet"],
  ["client", "Client list"],
  ["dayof", "Day of"],
  ["chat", "Chat"],
] as const;
export type ManagerTab = (typeof MANAGER_TABS)[number][0];

export function isManagerTab(v: unknown): v is ManagerTab {
  return MANAGER_TABS.some(([k]) => k === v);
}

/** The manager view link for an event, on a tab. */
export function managerHref(sessionId: string, tab?: ManagerTab): string {
  return `/team/admin/e/${encodeURIComponent(sessionId)}${tab && tab !== "details" ? `?tab=${tab}` : ""}`;
}

/**
 * Where an event link takes someone. Admins land on the manager view (on the
 * Chat tab when the link was to the chat), unless they asked for the bartender
 * view of the event (?as=bartender). Bartenders, and admins in Bartender view
 * (who come back from auth as bartenders), stay on the bartender view: null.
 */
export function eventLanding(staff: { role: string }, sessionId: string, query: { tab?: unknown; as?: unknown }): string | null {
  if (staff.role !== "admin" || query.as === "bartender") return null;
  return managerHref(sessionId, isManagerTab(query.tab) ? query.tab : undefined);
}
