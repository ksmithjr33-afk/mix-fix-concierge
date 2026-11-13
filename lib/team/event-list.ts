// The /team/events list: one compact row per event, grouped into This week,
// Next week, and Later, with a date header for each day. Pure, no database.

import { firstName, scrub } from "@/lib/team/event-view";
import { chicagoToday, eventDay, eventSchedule, formatClock, longDate } from "@/lib/team/time";
import { eventData, marketLabel, sessionMarket, type Market } from "@/lib/team/markets";

export interface EventRowSource {
  id: string;
  event_date?: string | null;
  guest_count?: string | null;
  package_type?: string | null;
  event_data: Record<string, unknown> | null;
  team_market?: string | null;
}

export interface EventListItem {
  id: string;
  day: string | null; // YYYY-MM-DD in Chicago
  arrival: string; // "4:00 PM", or "" when unknown
  title: string;
  detail: string;
  search: string; // lower case text the search box matches
  status?: string; // the bartender's assignment status, when there is one
  href?: string; // defaults to the staff event page
  badge?: { text: string; tone: "ok" | "warn" | "muted" };
  market?: Market | null;
  chat?: { href: string; unread: number }; // admins: the event's team chat
  pay?: string; // the viewer's own estimated pay, "$187.50"
  kind?: "event" | "shift"; // "shift": an open shift in the bartender's markets (href to the shift)
  staffing?: "full" | "open" | "none"; // admins: fully staffed, spots open, nobody assigned
  menu?: { state: "unassigned" | "assigned" | "picked_up"; text: string }; // admins: the cocktail menu pickup
  request?: boolean; // admins: a client change request is waiting for Approve or Decline
  noMenu?: boolean; // admins: inside 72 hours and no approved menu uploaded
}

/** "Justin · Wedding": client first name and event type. */
export function nameAndType(ed: Record<string, unknown>): string {
  return [firstName(ed.client_name), scrub(ed.event_type)].filter(Boolean).join(" · ");
}

/**
 * The title shape used everywhere staff see an event: the client's own event
 * name when they gave one, otherwise first name and event type.
 */
export function eventTitle(ed: Record<string, unknown>): string {
  return scrub(ed.event_name) || nameAndType(ed) || "Event";
}

/** "123 Main St, Dallas, TX 75201" as "Dallas". Empty when the address has no city part. */
export function cityFrom(address: unknown): string {
  const parts = scrub(address)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  let i = parts.length - 1;
  // Drop a trailing country and a "TX 75201" state and zip part.
  if (/^(usa|us|united states)$/i.test(parts[i])) i--;
  if (i > 0 && /^[A-Za-z]{2}(\s+\d{5}(-\d{4})?)?$|^\d{5}(-\d{4})?$|^texas(\s+\d{5})?$/i.test(parts[i])) i--;
  const city = i > 0 ? parts[i] : "";
  return /\d/.test(city) ? "" : city;
}

function guests(ed: Record<string, unknown>, row: EventRowSource): string {
  const n = parseInt(String(ed.guest_count ?? row.guest_count ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? `${n} guests` : "";
}

export function eventListItem(row: EventRowSource, status?: string, opts: { showMarket?: boolean } = {}): EventListItem {
  const ed = eventData(row);
  const market = sessionMarket(row);
  const s = eventSchedule(ed);
  const named = scrub(ed.event_name);
  const title = eventTitle(ed);
  const times = s.startMin !== null && s.endMin !== null ? `${formatClock(s.startMin)} to ${formatClock(s.endMin)}` : s.startMin !== null ? formatClock(s.startMin) : "";
  const pkg = scrub(ed.package) || scrub(row.package_type);
  const detail = [opts.showMarket ? marketLabel(market) : "", named ? nameAndType(ed) : "", times, guests(ed, row), pkg, cityFrom(ed.event_address)].filter(Boolean).join(" · ");
  return {
    id: row.id,
    day: eventDay(ed.event_date),
    arrival: s.arrivalMin === null ? "" : formatClock(s.arrivalMin),
    title,
    detail,
    search: [title, firstName(ed.client_name), scrub(ed.event_type), named].join(" ").toLowerCase(),
    market,
    ...(status ? { status } : {}),
  };
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Sunday that ends the Monday to Sunday week holding `ymd`. */
function weekEnd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 is Sunday
  return addDays(ymd, dow === 0 ? 0 : 7 - dow);
}

export type SectionName = "This week" | "Next week" | "Later" | "Past events";

export interface DayGroup {
  day: string | null;
  label: string; // "Saturday, November 14", or "Date to be confirmed"
  events: EventListItem[];
}

export interface ListSection {
  name: SectionName;
  days: DayGroup[];
}

/** "Saturday, November 14", with the year only when it is not this year. */
export function dayHeader(ymd: string | null, today: string): string {
  if (!ymd) return "Date to be confirmed";
  const full = longDate(ymd);
  return ymd.slice(0, 4) === today.slice(0, 4) ? full.replace(/, \d{4}$/, "") : full;
}

function byDay(events: EventListItem[], today: string, newestFirst: boolean): DayGroup[] {
  const sorted = [...events].sort((a, b) => {
    const da = a.day ?? "9999-99-99";
    const db = b.day ?? "9999-99-99";
    if (da !== db) return newestFirst ? db.localeCompare(da) : da.localeCompare(db);
    return a.arrival.localeCompare(b.arrival) || a.title.localeCompare(b.title);
  });
  const groups: DayGroup[] = [];
  for (const e of sorted) {
    const last = groups.at(-1);
    if (last && last.day === e.day) last.events.push(e);
    else groups.push({ day: e.day, label: dayHeader(e.day, today), events: [e] });
  }
  return groups;
}

/** Upcoming events split into This week (through Sunday), Next week, and Later. Undated events go under Later. */
export function upcomingSections(events: EventListItem[], today: string = chicagoToday()): ListSection[] {
  const endThis = weekEnd(today);
  const endNext = addDays(endThis, 7);
  const upcoming = events.filter((e) => !e.day || e.day >= today);
  const sections: ListSection[] = [
    { name: "This week", days: byDay(upcoming.filter((e) => e.day && e.day <= endThis), today, false) },
    { name: "Next week", days: byDay(upcoming.filter((e) => e.day && e.day > endThis && e.day <= endNext), today, false) },
    { name: "Later", days: byDay(upcoming.filter((e) => !e.day || e.day > endNext), today, false) },
  ];
  return sections.filter((s) => s.days.length > 0);
}

/** Past events, newest first. */
export function pastSection(events: EventListItem[], today: string = chicagoToday()): ListSection[] {
  const past = events.filter((e) => e.day && e.day < today);
  return past.length ? [{ name: "Past events", days: byDay(past, today, true) }] : [];
}

export { matchesSearch } from "@/lib/team/search";
