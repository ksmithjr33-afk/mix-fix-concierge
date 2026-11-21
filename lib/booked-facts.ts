// What the booking already told the concierge: the bar service start time, the
// bartenders booked, and the event type. The intake prompt treats each one as
// answered and never asks for it (lib/system-prompt.ts, bookedDetailsSection).
// Read from the session row first, then from the hidden CONTEXT message the
// chat page builds from the same fields (chats with no session row).
// Pure, no database, no server imports.

import { formatClock, parseClock } from "@/lib/team/time";
import { isBlank, present } from "@/lib/blank";

/** "6:00 PM" from "6pm", "18:00", or "6:00 PM". Null when it is not a time. */
function startTime(v: unknown): string | null {
  const m = parseClock(typeof v === "string" ? v.replace(/\s+/g, " ") : v);
  return m === null ? null : formatClock(m);
}

/**
 * The booked guest count as one number. A range ("50-75", "50 to 75") is its
 * higher end, the number the concierge has always planned for. Null when none.
 */
export function bookedGuestCount(v: unknown): number | null {
  if (isBlank(v)) return null;
  const nums = (String(v ?? "").match(/\d+/g) ?? []).map(Number).filter((n) => n > 0);
  return nums.length ? Math.max(...nums) : null;
}

export interface BookedFacts {
  startTime: string | null; // "6:00 PM"
  guests?: number | null; // booked guest count, a range read as its higher end
  hours: number | null; // hours of bar service booked
  bartenders: number | null;
  eventType: string | null; // "Social Gathering"
}

export const NO_BOOKED_FACTS: BookedFacts = { startTime: null, guests: null, hours: null, bartenders: null, eventType: null };

export const CONTEXT_PREFIX = "CONTEXT - Pre-filled from booking system:";

// The labels app/chat/page.tsx writes, in any order, separated by ", ".
const CONTEXT_LABELS = [
  "Client name",
  "Email",
  "Event date",
  "Package",
  "Guest count",
  "Event type",
  "Event name",
  "Hours of bar service booked",
  "Bar service start time booked",
  "Bartenders booked",
];

/** Every "Label: value" in the CONTEXT message. A value may hold commas. */
export function contextFields(content: string): Record<string, string> {
  if (!content.startsWith(CONTEXT_PREFIX)) return {};
  const body = content.slice(CONTEXT_PREFIX.length).replace(/\.\s*Use this info and do not re-ask for it\.\s*$/, "");
  const label = new RegExp(`(?:^|,\\s*)(${CONTEXT_LABELS.map((l) => l.replace(/ /g, "\\s")).join("|")}):\\s*`, "g");
  const hits = [...body.matchAll(label)];
  const out: Record<string, string> = {};
  hits.forEach((m, i) => {
    const from = (m.index ?? 0) + m[0].length;
    const to = i + 1 < hits.length ? hits[i + 1].index ?? body.length : body.length;
    const value = body.slice(from, to).trim();
    // "Event date: null" from an older chat: missing, never a value.
    if (!isBlank(value) && !(m[1] in out)) out[m[1]] = value;
  });
  return out;
}

const count = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? present(v) : null);

/** The booked facts from the session row, filled in from the CONTEXT message where the row has none. */
export function bookedFacts(session: Record<string, unknown> | null | undefined, messages: { role: string; content: unknown }[] = []): BookedFacts {
  const first = messages[0];
  const ctx = first?.role === "user" && typeof first.content === "string" ? contextFields(first.content) : {};
  const s = session ?? {};
  const bartenders = count(s.bartender_count) ?? count(ctx["Bartenders booked"]);
  return {
    startTime: startTime(s.bar_service_start) ?? startTime(ctx["Bar service start time booked"]),
    guests: bookedGuestCount(s.guest_count) ?? bookedGuestCount(ctx["Guest count"]),
    hours: count(s.hours_booked) ?? count(ctx["Hours of bar service booked"]),
    bartenders: bartenders !== null && Number.isInteger(bartenders) ? bartenders : null,
    // Older bookings put the type in event_name, and the chat page labels it Event type then.
    eventType: text(s.event_type) ?? text(ctx["Event type"]),
  };
}

/** The booked facts as session columns, for bookingFill at submission. */
export function factsAsSession(f: BookedFacts): Record<string, unknown> {
  return {
    bar_service_start: f.startTime,
    hours_booked: f.hours,
    bartender_count: f.bartenders,
    event_type: f.eventType,
  };
}
