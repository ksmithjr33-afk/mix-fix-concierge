// The events a staff member is on (offered or accepted), as list rows. Server only.
// Used by their own events list and by an admin's read only "Preview as".

import { supabase } from "@/lib/supabase";
import { eventListItem, type EventListItem, type EventRowSource } from "@/lib/team/event-list";
import { hiddenEventIds } from "@/lib/team/hidden";
import { withoutHidden } from "@/lib/team/assignments";

export async function assignedEventItems(staffId: string): Promise<EventListItem[]> {
  const { data, error } = await supabase
    .from("event_assignments")
    .select("status, session:session_id (*)")
    .eq("staff_id", staffId)
    .neq("status", "declined");
  if (error || !data) return [];
  const items = data.flatMap((a) => {
    const s = (Array.isArray(a.session) ? a.session[0] : a.session) as (EventRowSource & { status: string }) | null;
    return s && s.status === "submitted" ? [eventListItem(s, a.status as string)] : [];
  });
  return withoutHidden(items, await hiddenEventIds());
}
