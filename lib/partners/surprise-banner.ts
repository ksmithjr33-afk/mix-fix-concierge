// The staff banner on a surprise event, built on the server. First name only.

import { eventTimeZone } from "@/lib/team/markets";
import { surpriseActive, surpriseBanner, surpriseOf, type SurpriseColumns } from "@/lib/partners/surprise";

/** The banner text while a surprise event's block is on, or null. */
export function surpriseBannerText(session: object, now: Date = new Date()): string | null {
  const s = session as SurpriseColumns & { event_date?: string | null; event_data?: Record<string, unknown> | null };
  return surpriseActive(s, now, eventTimeZone(session)) ? surpriseBanner(surpriseOf(s).firstName) : null;
}
