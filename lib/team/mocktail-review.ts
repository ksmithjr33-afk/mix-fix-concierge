// The read only list of upcoming events that already have a mocktail on the
// menu, so the team can review them now that the concierge no longer builds
// mocktails. Nothing here changes an event. Pure, no database.

import { isMocktail, isMocktailFollowup } from "@/lib/mocktail-menu";
import { adminEventTitle } from "@/lib/team/event-list";
import { eventDay, shortDate } from "@/lib/team/time";

export interface MocktailReviewRow {
  sessionId: string;
  day: string; // YYYY-MM-DD
  date: string; // "Sat, Dec 5"
  title: string;
  package: string;
  mocktails: { name: string; ingredients: string[]; followup: boolean }[];
}

type Session = { id: string; status?: string | null; event_date?: string | null; event_data?: Record<string, unknown> | null };

/** Submitted events from today on with at least one mocktail, soonest first. */
export function upcomingMocktails(sessions: Session[], today: string): MocktailReviewRow[] {
  const out: MocktailReviewRow[] = [];
  for (const s of sessions) {
    if (s.status !== "submitted" || !s.event_data) continue;
    const ed = s.event_data;
    const day = eventDay(ed.event_date ?? s.event_date);
    if (!day || day < today) continue;
    const drinks = Array.isArray(ed.signature_drinks) ? (ed.signature_drinks as Record<string, unknown>[]) : [];
    const mocktails = drinks
      .filter(isMocktail)
      .map((d) => ({ name: String(d.name ?? d.menu_name ?? "Mocktail"), ingredients: Array.isArray(d.ingredients) ? (d.ingredients as unknown[]).map(String).filter(Boolean) : [], followup: isMocktailFollowup(d) }));
    if (mocktails.length === 0) continue;
    out.push({ sessionId: s.id, day, date: shortDate(day), title: adminEventTitle(ed), package: String(ed.package ?? ""), mocktails });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}
