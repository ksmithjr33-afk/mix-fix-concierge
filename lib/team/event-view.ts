// What a staff member sees on an event page. Built from an allowlist, so client
// email, client phone, client last name, pricing, gratuity, deposit, payment
// preference, and promo codes never reach the page. Free text has dollar
// amounts, emails, and phone numbers removed. The day of contact phone is only
// included from 48 hours before service starts. Pure, no database.

import { DRINK_MENU_RULES } from "@/lib/system-prompt";
import { staffingFor } from "@/lib/pricing";
import { isBottleRequest } from "@/lib/shopping-list";
import { recapLines, type FieldChange } from "@/lib/event-diff";
import { chicagoStamp, eventSchedule, formatClock, longDate } from "@/lib/team/time";

export const MIX_FIX_LINE = "469 754 8512";
export const PHONE_HIDDEN_NOTE = "Contact number appears 48 hours before the event.";
const PHONE_LEAD_MS = 48 * 60 * 60 * 1000;

export type StaffRole = "bartender" | "admin";

export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  role: StaffRole;
  active: boolean;
}

export interface AssignmentLike {
  status: "offered" | "accepted" | "declined";
}

/** Admins open every event. Bartenders open only events they are assigned to and have not declined. */
export function canOpenEvent(staff: StaffMember | null, assignment: AssignmentLike | null): boolean {
  if (!staff || !staff.active) return false;
  if (staff.role === "admin") return true;
  return !!assignment && assignment.status !== "declined";
}

export interface StaffDrink {
  name: string;
  kind: string; // base spirit or "Mocktail"
  ingredients: string[]; // with oz amounts, bartenders pour from these
  method: string;
  garnish: string;
}

export interface ClassicGroup {
  title: string;
  drinks: { name: string; recipe: string }[];
}

export interface StaffEventView {
  sessionId: string;
  eventName: string;
  eventType: string;
  clientFirstName: string;
  date: string;
  arrival: string;
  serviceStart: string;
  serviceEnd: string;
  address: string;
  mapsUrl: string | null;
  venueType: string;
  barSetting: string;
  barOnSite: string;
  barFloorAccess: string;
  barDetails: string;
  parking: string;
  guestCount: string;
  package: string;
  bartenders: number | null;
  teammates: string[];
  theme: string;
  colors: string;
  allergies: string[];
  beerAndWine: string;
  specialRequests: string;
  bottleNote: string; // extra_bottles when it is a note, not a bottle to buy
  drinks: StaffDrink[];
  classics: ClassicGroup[] | null; // Dive Bar with no menu
  lastUpdated: string;
  whatChanged: string[];
  dayOfContact: { name: string; phone: string | null; phoneNote: string | null };
  mixFixLine: string;
}

export interface SessionLike {
  id: string;
  event_data: Record<string, unknown> | null;
  event_date?: string | null;
  guest_count?: string | null;
  package_type?: string | null;
  updated_at?: string | null;
  submitted_at?: string | null;
  booked_price?: { bartenders?: number | null } | null;
}

export interface UpdateLike {
  changes: FieldChange[];
  created_at: string;
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v).replace(/<br\s*\/?>/gi, "\n").trim();
}

/** Free text with prices, emails, and phone numbers taken out. */
export function scrub(v: unknown): string {
  return text(v)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[number removed]")
    .replace(/\$\s?\d[\d,]*(\.\d+)?/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

export function firstName(v: unknown): string {
  return text(v).split(/\s+/)[0] ?? "";
}

function venueLabel(v: unknown): string {
  if (v === "private_residence") return "Private residence";
  if (v === "venue") return "Venue";
  return text(v);
}

function toCount(v: unknown): number | null {
  const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Classics the Dive Bar well does not stock unless picked as a signature drink. */
const DIVE_SIGNATURE_ONLY = new Set(["Sidecar", "Bellini", "Amaretto Sour", "Hurricane"]);

/** The CLASSICS section of the bot's menu, grouped by spirit: the same recipes the bot offers. */
export function classicsMenu(opts: { dive?: boolean } = {}): ClassicGroup[] {
  const lines = DRINK_MENU_RULES.split("\n");
  const from = lines.findIndex((l) => l.startsWith("=== CLASSICS"));
  const groups: ClassicGroup[] = [];
  for (const line of lines.slice(from + 1)) {
    if (line.startsWith("===") || line.startsWith("Only a drink")) break;
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) {
      if (line.trim() && /^[A-Z ]+$/.test(line.trim())) {
        const t = line.trim().toLowerCase();
        groups.push({ title: t.charAt(0).toUpperCase() + t.slice(1), drinks: [] });
      }
      continue;
    }
    if (opts.dive && DIVE_SIGNATURE_ONLY.has(m[1].trim())) continue;
    groups.at(-1)?.drinks.push({ name: m[1].trim(), recipe: m[2].trim() });
  }
  return groups.filter((g) => g.drinks.length > 0);
}

function drinksOf(ed: Record<string, unknown>): StaffDrink[] {
  const list = Array.isArray(ed.signature_drinks) ? (ed.signature_drinks as Record<string, unknown>[]) : [];
  return list.map((d) => ({
    name: text(d.name) || "Unnamed drink",
    kind: d.is_mocktail ? "Mocktail" : text(d.base_spirit),
    ingredients: Array.isArray(d.ingredients) ? d.ingredients.map((x) => text(x)) : text(d.ingredients).split(/,\s*/).filter(Boolean),
    method: text(d.method),
    garnish: text(d.garnish),
  }));
}

/** Fields a staff member may see in "What changed". Everything else is left out. */
const STAFF_CHANGE_FIELDS = new Set([
  "event_name", "event_type", "event_date", "bar_service_start", "bar_service_end", "hours_booked", "event_address",
  "venue_type", "indoor_outdoor", "bar_on_site", "bar_details", "bar_floor_access", "parking_info", "guest_count",
  "package", "bartenders", "theme", "event_colors", "allergies", "special_requests", "day_of_contact_name", "beer",
  "wine", "client_providing_beer_wine", "beer_and_wine_details", "dual_bar_setup", "extra_bottles", "dive_menu_requested",
  "drinking_pace",
]);

function staffChange(field: string): boolean {
  return STAFF_CHANGE_FIELDS.has(field) || field.startsWith("signature_drinks[");
}

export function whatChanged(update: UpdateLike | null): string[] {
  if (!update) return [];
  return recapLines(update.changes.filter((c) => staffChange(c.field))).map(scrub);
}

/** True from 48 hours before service starts (or before the event day when the start time is unknown). */
export function showDayOfPhone(ed: Record<string, unknown>, now: Date): boolean {
  const s = eventSchedule(ed);
  const start = s.start ?? (s.day ? eventSchedule({ ...ed, bar_service_start: "12:00 AM" }).start : null);
  if (!start) return false;
  return now.getTime() >= start.getTime() - PHONE_LEAD_MS;
}

export function buildStaffEventView(
  session: SessionLike,
  opts: { now?: Date; teammates?: string[]; latestUpdate?: UpdateLike | null } = {}
): StaffEventView {
  const now = opts.now ?? new Date();
  const ed = { ...(session.event_data ?? {}) };
  if (!ed.event_date && session.event_date) ed.event_date = session.event_date;
  const s = eventSchedule(ed);
  const pkg = text(ed.package) || text(session.package_type);
  const guests = text(ed.guest_count) || text(session.guest_count);
  const drinks = drinksOf(ed);
  const dive = pkg.toLowerCase().includes("dive");
  const address = scrub(ed.event_address);
  const showPhone = showDayOfPhone(ed, now);
  const dayPhone = text(ed.day_of_contact_phone);
  const beerWine = [ed.beer ? "Beer" : "", ed.wine ? "Wine" : ""].filter(Boolean).join(" and ");

  return {
    sessionId: session.id,
    eventName: scrub(ed.event_name),
    eventType: scrub(ed.event_type),
    clientFirstName: firstName(ed.client_name),
    date: longDate(s.day) || text(ed.event_date),
    arrival: s.arrivalMin === null ? "" : formatClock(s.arrivalMin),
    serviceStart: s.startMin === null ? text(ed.bar_service_start) : formatClock(s.startMin),
    serviceEnd: s.endMin === null ? text(ed.bar_service_end) : formatClock(s.endMin),
    address,
    mapsUrl: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null,
    venueType: venueLabel(ed.venue_type),
    barSetting: scrub(ed.indoor_outdoor),
    barOnSite: scrub(ed.bar_on_site),
    barFloorAccess: scrub(ed.bar_floor_access),
    barDetails: scrub(ed.bar_details),
    parking: scrub(ed.parking_info),
    guestCount: guests,
    package: pkg,
    bartenders: toCount(ed.bartenders) ?? toCount(session.booked_price?.bartenders) ?? (toCount(guests) ? staffingFor(toCount(guests)!) : null),
    teammates: opts.teammates ?? [],
    theme: scrub(ed.theme),
    colors: scrub(ed.event_colors),
    allergies: (Array.isArray(ed.allergies) ? ed.allergies.map(String) : text(ed.allergies).split(/,\s*/))
      .map(scrub)
      .filter((a) => a && !/^(none|no|n\/a)$/i.test(a)),
    beerAndWine: [beerWine, ed.client_providing_beer_wine === true ? "client is bringing it" : "", scrub(ed.beer_and_wine_details)]
      .filter(Boolean)
      .join(", "),
    specialRequests: scrub(ed.special_requests),
    bottleNote: ed.extra_bottles && !isBottleRequest(ed.extra_bottles) && !/^(no|none|n\/a)\.?$/i.test(text(ed.extra_bottles)) ? scrub(ed.extra_bottles) : "",
    drinks,
    classics: dive && drinks.length === 0 ? classicsMenu({ dive: true }) : null,
    lastUpdated: chicagoStamp(session.updated_at ?? session.submitted_at),
    whatChanged: whatChanged(opts.latestUpdate ?? null),
    dayOfContact: {
      name: scrub(ed.day_of_contact_name) || "To be confirmed",
      phone: showPhone && dayPhone ? dayPhone : null,
      phoneNote: showPhone ? (dayPhone ? null : "No contact number on file.") : PHONE_HIDDEN_NOTE,
    },
    mixFixLine: MIX_FIX_LINE,
  };
}
