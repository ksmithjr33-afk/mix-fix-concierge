// Calendar only events: already confirmed outside the concierge, added to our
// calendar for the team. Nothing goes to GHL or the client. Pure, no database.
//
// Every place that would reach GHL or the client checks isCalendarOnly and
// skips. CALENDAR_ONLY_SKIPPED lists each of those places in words: the Add
// event form note and the manager view's Calendar only card show it, and
// scripts/test-calendar-only.mts checks each guard is in place, so the list
// stays true to the code.
//
// The staff side works as normal: staffing, texts to staff (sent through the
// staff SMS webhook, never to the client), Tools, Supplies, ice, menu pickup,
// chat, clock and wrap up.
//
// "Turn on client messages" (an admin, with a confirm) clears calendar_only
// and sends the normal intake payload once.

export interface SkippedPath {
  key: string;
  label: string; // what will NOT happen, in words
  where: string; // the code that skips it
}

export const CALENDAR_ONLY_SKIPPED: SkippedPath[] = [
  { key: "concierge_link", label: "No concierge link. The client is never sent one, and the manager view hides the client links.", where: "lib/manual-event-db.ts addManualEvent, lib/client-links.ts clientLinks" },
  { key: "intake", label: "No automated client texts or emails. GHL never gets the booking (no intake webhook, no contact note).", where: "lib/manual-event-db.ts postIntake" },
  { key: "updates", label: "No update webhooks when the event changes, so no change orders or new totals go to the client.", where: "lib/update-delivery.ts deliverRow" },
  { key: "shopping_list", label: "No client shopping list.", where: "lib/manual-event-db.ts addManualEvent (send_client_list false), lib/update-delivery.ts postListOnly" },
  { key: "balance", label: "No balance reminders, since GHL never has the booking or its price.", where: "lib/manual-event-db.ts postIntake, lib/update-delivery.ts deliverRow" },
  { key: "follow_up", label: "No post event follow up.", where: "lib/team/closeout-db.ts sendCloseoutWebhook" },
];

/** What the update rows say when they were skipped, so a retry never sends them later. */
export const CALENDAR_ONLY_SKIP = "Calendar only: not sent to GHL";

export function isCalendarOnly(session: { calendar_only?: boolean | null } | null | undefined): boolean {
  return session?.calendar_only === true;
}
