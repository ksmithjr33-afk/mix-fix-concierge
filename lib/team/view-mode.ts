// "Bartender view": an admin sees the portal exactly as a bartender does.
// Pure, no database. The switch is a cookie; it only ever lowers what an
// admin can do, so a bartender setting it changes nothing.

import type { StaffMember } from "@/lib/team/event-view";

export const VIEW_COOKIE = "mf_team_view";
export const VIEW_COOKIE_DAYS = 1;

export type ViewedStaff = StaffMember & { bartenderView?: boolean };

/** The staff member as the portal should treat them: an admin in bartender view is a bartender everywhere. */
export function applyViewMode(staff: StaffMember, cookie: string | undefined): ViewedStaff {
  if (staff.role === "admin" && cookie === "bartender") return { ...staff, role: "bartender", bartenderView: true };
  return staff;
}
