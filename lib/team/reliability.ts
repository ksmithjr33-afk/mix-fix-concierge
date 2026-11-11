// Reliability record: the math. Pure, no database.
//
// Per staff member, for the last 90 days and all time:
//   events worked            accepted shifts on events that are over (hidden events left out)
//   on time                  clocked in at or before arrival time
//   bar ready on time        first bar ready photo before service start
//   closeouts                closeouts sent
//   late drops               shifts declined after accepting
//   handoffs                 handoffs requested, and urgent ones (inside 48 hours)
//   location flags           clock punches flagged far from the event or with no location
// Fewer than 3 events worked shows "New" and no percentages.

export const RECORD_DAYS = 90;
export const NEW_UNDER = 3;
export const LOCATION_FLAGS = ["far", "no_location"];

export interface WorkedEvent {
  sessionId: string;
  end: Date; // when service ended (the event is over)
  arrival: Date | null;
  start: Date | null;
  clockIn: Date | null;
  barReadyAt: Date | null; // first bar ready photo
  closeout: boolean;
}

export interface RecordFacts {
  events: WorkedEvent[];
  drops: Date[]; // when they declined a shift they had accepted
  handoffs: { at: Date; urgent: boolean }[];
  flaggedPunches: Date[]; // punch times with a location flag
}

export interface RecordStats {
  eventsWorked: number;
  onTime: number;
  barReadyOnTime: number;
  closeouts: number;
  lateDrops: number;
  handoffs: number;
  urgentHandoffs: number;
  locationFlags: number;
  isNew: boolean;
}

export const emptyFacts = (): RecordFacts => ({ events: [], drops: [], handoffs: [], flaggedPunches: [] });

/** The record for everything since `since` (null for all time). */
export function computeRecord(f: RecordFacts, since: Date | null): RecordStats {
  const inWindow = (d: Date) => !since || d.getTime() >= since.getTime();
  const events = f.events.filter((e) => inWindow(e.end));
  const handoffs = f.handoffs.filter((h) => inWindow(h.at));
  return {
    eventsWorked: events.length,
    onTime: events.filter((e) => e.clockIn && e.arrival && e.clockIn.getTime() <= e.arrival.getTime()).length,
    barReadyOnTime: events.filter((e) => e.barReadyAt && e.start && e.barReadyAt.getTime() < e.start.getTime()).length,
    closeouts: events.filter((e) => e.closeout).length,
    lateDrops: f.drops.filter(inWindow).length,
    handoffs: handoffs.length,
    urgentHandoffs: handoffs.filter((h) => h.urgent).length,
    locationFlags: f.flaggedPunches.filter(inWindow).length,
    isNew: events.length < NEW_UNDER,
  };
}

export function since90(now: Date): Date {
  return new Date(now.getTime() - RECORD_DAYS * 86_400_000);
}

/** Whole percent, or null when there is nothing to divide by. */
export function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 100) : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 events · 92% on time · 1 late drop", or "New" under 3 events. */
export function compactLine(s: RecordStats): string {
  const parts = s.isNew ? ["New"] : [plural(s.eventsWorked, "event"), `${pct(s.onTime, s.eventsWorked)}% on time`];
  if (s.lateDrops > 0) parts.push(plural(s.lateDrops, "late drop"));
  if (s.urgentHandoffs > 0) parts.push(plural(s.urgentHandoffs, "urgent handoff"));
  return parts.join(" · ");
}

export interface RecordRow {
  label: string;
  value: string;
}

/** The full record, one row per measure. Percentages only when not new. */
export function recordRows(s: RecordStats): RecordRow[] {
  const rate = (n: number) => (s.isNew ? String(n) : `${n} (${pct(n, s.eventsWorked)}%)`);
  return [
    { label: "Events worked", value: String(s.eventsWorked) },
    { label: "Clocked in on time", value: rate(s.onTime) },
    { label: "Bar ready before service start", value: rate(s.barReadyOnTime) },
    { label: "Closeouts sent", value: rate(s.closeouts) },
    { label: "Shifts declined after accepting", value: String(s.lateDrops) },
    { label: "Handoffs requested", value: String(s.handoffs) },
    { label: "Urgent handoffs (inside 48 hours)", value: String(s.urgentHandoffs) },
    { label: "Location flags on clock punches", value: String(s.locationFlags) },
  ];
}
