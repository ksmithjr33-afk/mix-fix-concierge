// Missing item reports. Server only. Used by "Something is missing" on the
// Supplies tab and by "I have gone through the supplies list", which reports
// every item left unchecked the same way: saved to missing_reports (shown in
// red on the manager's Day of tab) and texted to admins and managers.

import type { SessionRow } from "@/lib/event-updates";
import { alertAdmins, recordMissing } from "@/lib/team/events";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { adminEventTitle } from "@/lib/team/event-list";
import { eventDay, shortDate } from "@/lib/team/time";
import { sendStaffText } from "@/lib/team/sms";
import type { SupplyItem } from "@/lib/team/supplies";

export function missingText(o: { date: string; title: string; by: string; items: { item: string; quantity: string }[]; note: string; link: string; heading?: string }): string {
  return [
    `${o.heading ?? "Missing items"} for the ${o.date} ${o.title}, reported by ${o.by}:`,
    ...o.items.map((i) => `${i.item} (${i.quantity})`),
    o.note ? `Note: ${o.note}` : "",
    o.link,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Save the report and text admins and managers. Returns how many texts went out. */
export async function reportMissing(session: SessionRow, staff: StaffMember, items: SupplyItem[], note: string, link: string, heading?: string): Promise<number> {
  const ed = session.event_data ?? {};
  const message = missingText({
    date: shortDate(eventDay(ed.event_date ?? session.event_date)),
    title: adminEventTitle(ed), // the text goes to admins and managers
    by: firstName(staff.name) || "a bartender",
    items,
    note,
    link,
    heading,
  });
  await recordMissing(session.id, staff.id, items.map((i) => i.item), note);
  const admins = await alertAdmins();
  const sent = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
  console.log(`[team] missing items for ${session.id} from ${staff.id}: ${items.length} items, ${sent.filter(Boolean).length}/${admins.length} texts sent`);
  return sent.filter(Boolean).length;
}
