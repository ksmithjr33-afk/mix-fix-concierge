// Pure update mode logic: diff a partial event against the current event_data,
// sort each change by deadline, split out requests a manager has to handle, and
// rebuild any version from event_updates history. No database access here, see
// lib/event-updates.ts for that.

import { parseEventDate } from "@/lib/event-date";
import { calculateHours } from "@/lib/shopping-list";

export type EventData = Record<string, unknown>;
type Drink = Record<string, unknown>;

export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

/** Fields a client can change in update mode. Everything else is ignored. */
export const UPDATABLE_FIELDS = [
  "guest_count",
  "bar_service_start",
  "bar_service_end",
  "venue_type",
  "event_address",
  "indoor_outdoor",
  "bar_on_site",
  "bar_details",
  "bar_floor_access",
  "parking_info",
  "day_of_contact_name",
  "day_of_contact_phone",
  "beer",
  "wine",
  "client_providing_beer_wine",
  "beer_and_wine_details",
  "special_requests",
  "dual_bar_setup",
  "extra_bottles",
  "allergies",
  "drinking_pace",
  "theme",
  "event_colors",
  "menu_colors",
  "event_name",
  "dive_menu_requested",
  "signature_drinks",
] as const;

const FIELD_LABELS: Record<string, string> = {
  guest_count: "Guest count",
  bar_service_start: "Bar service start",
  bar_service_end: "Bar service end",
  venue_type: "Venue type",
  event_address: "Address",
  indoor_outdoor: "Bar indoor or outdoor",
  bar_on_site: "Bar on site",
  bar_details: "Bar details",
  bar_floor_access: "Bar floor access",
  parking_info: "Parking",
  day_of_contact_name: "Day of contact",
  day_of_contact_phone: "Day of contact phone",
  beer: "Beer",
  wine: "Wine",
  client_providing_beer_wine: "Client providing beer and wine",
  beer_and_wine_details: "Beer and wine details",
  special_requests: "Add ons and special requests",
  dual_bar_setup: "Second bar setup",
  extra_bottles: "Extra bottles",
  allergies: "Allergies",
  drinking_pace: "Drinking pace",
  theme: "Theme",
  event_colors: "Event colors",
  menu_colors: "Menu colors",
  event_name: "Event name",
  dive_menu_requested: "Dive Bar menu requested",
  manager_request: "Manager request",
};

// ---------- equality ----------

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

// ---------- deadlines ----------

export interface Deadlines {
  today: string; // YYYY-MM-DD in America/Chicago
  eventDay: string | null;
  drinksLockDate: string | null; // Monday before the event
  namesLockDate: string | null; // Wednesday before the event
  drinksOpen: boolean;
  namesOpen: boolean;
  eventPassed: boolean;
}

export function chicagoToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The most recent given weekday strictly before the event day (0 Sunday, 1 Monday...). */
function weekdayBefore(eventDay: string, weekday: number): string {
  const [y, m, d] = eventDay.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  do {
    t.setUTCDate(t.getUTCDate() - 1);
  } while (t.getUTCDay() !== weekday);
  return toYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Drinks and ingredients lock at the end of the Monday before the event, drink
 * names at the end of the Wednesday before. An unparseable event date counts as
 * locked so a manager confirms drink changes.
 */
export function computeDeadlines(eventDate: unknown, now: Date = new Date()): Deadlines {
  const today = chicagoToday(now);
  const parsed = parseEventDate(typeof eventDate === "string" ? eventDate : null);
  if (!parsed) {
    return {
      today,
      eventDay: null,
      drinksLockDate: null,
      namesLockDate: null,
      drinksOpen: false,
      namesOpen: false,
      eventPassed: false,
    };
  }
  const eventDay = toYmd(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  const drinksLockDate = weekdayBefore(eventDay, 1);
  const namesLockDate = weekdayBefore(eventDay, 3);
  return {
    today,
    eventDay,
    drinksLockDate,
    namesLockDate,
    drinksOpen: today <= drinksLockDate,
    namesOpen: today <= namesLockDate,
    eventPassed: today > eventDay,
  };
}

// ---------- package rules the server enforces ----------

export function packageDrinkCount(pkg: unknown): number {
  const p = String(pkg ?? "").toLowerCase();
  if (p.includes("big day") || p.includes("wedding bar")) return 2;
  const beerAndWineOnly =
    p.includes("beer") && p.includes("wine") &&
    !p.includes("bartender") && !p.includes("tailored") &&
    !p.includes("essentials") && !p.includes("full") && !p.includes("premium");
  if (beerAndWineOnly) return 0;
  return 3;
}

// ---------- formatting ----------

function drinkIndexLabel(field: string): string | null {
  const m = field.match(/^signature_drinks\[(\d+)\](\.name)?$/);
  if (!m) return null;
  return `Drink ${Number(m[1]) + 1}${m[2] ? " name" : ""}`;
}

export function fieldLabel(field: string): string {
  return drinkIndexLabel(field) ?? FIELD_LABELS[field] ?? field;
}

function formatDrink(d: Drink): string {
  const name = String(d.name ?? "Unnamed drink");
  const mocktail = d.is_mocktail ? " (mocktail)" : "";
  const ingredients = Array.isArray(d.ingredients) ? d.ingredients.join(", ") : String(d.ingredients ?? "");
  return ingredients ? `${name}${mocktail}: ${ingredients}` : `${name}${mocktail}`;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(none)";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) {
    if (v.length === 0) return "(none)";
    if (v.every((x) => typeof x !== "object" || x === null)) return v.join(", ");
    return v.map((x) => formatValue(x)).join(" | ");
  }
  if (typeof v === "object") {
    const obj = v as Drink;
    if ("ingredients" in obj || "base_spirit" in obj) return formatDrink(obj);
    return JSON.stringify(v);
  }
  return String(v);
}

export function summarizeChanges(changes: FieldChange[]): string {
  return changes
    .map((c) =>
      c.field === "manager_request"
        ? `Manager request: ${formatValue(c.new)}`
        : `${fieldLabel(c.field)}: ${formatValue(c.old)} → ${formatValue(c.new)}`
    )
    .join("\n");
}

// ---------- applying and replaying ----------

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function setPath(target: EventData, field: string, value: unknown) {
  const m = field.match(/^(\w+)(?:\[(\d+)\])?(?:\.(\w+))?$/);
  if (!m) {
    target[field] = clone(value);
    return;
  }
  const [, key, index, sub] = m;
  if (index === undefined) {
    target[key] = clone(value);
    return;
  }
  const arr = Array.isArray(target[key]) ? [...(target[key] as unknown[])] : [];
  const i = Number(index);
  if (sub) {
    const item = { ...((arr[i] as Drink) ?? {}) };
    item[sub] = clone(value);
    arr[i] = item;
  } else {
    arr[i] = clone(value) ?? null;
  }
  target[key] = arr;
}

/** Apply changes in order. Drinks set to null (removed) are dropped afterwards. */
export function applyChanges(base: EventData, changes: FieldChange[]): EventData {
  const next = clone(base) ?? {};
  for (const c of changes) {
    if (c.field === "manager_request") continue;
    setPath(next, c.field, c.new);
  }
  if (Array.isArray(next.signature_drinks)) {
    next.signature_drinks = (next.signature_drinks as unknown[]).filter(
      (d) => d !== null && d !== undefined
    );
  }
  return next;
}

/** The version 1 row: every submitted field as {field, old: null, new: value}. */
export function snapshotChanges(eventData: EventData): FieldChange[] {
  return Object.keys(eventData)
    .sort()
    .map((field) => ({ field, old: null, new: eventData[field] }));
}

export interface HistoryRow {
  version: number;
  applied: boolean;
  changes: FieldChange[];
}

/** Rebuild event_data as it was at a version by replaying applied rows from version 1. */
export function replayHistory(rows: HistoryRow[], version: number): EventData | null {
  const applied = rows
    .filter((r) => r.applied && r.version <= version)
    .sort((a, b) => a.version - b.version);
  if (applied.length === 0 || applied[0].version !== 1) return null;
  return applied.reduce<EventData>((acc, r) => applyChanges(acc, r.changes), {});
}

// ---------- planning an update ----------

export interface PlannedRow {
  changes: FieldChange[];
  applied: boolean;
  within_deadline: boolean | null;
  summary: string;
}

export interface UpdatePlan {
  next: EventData;
  applied: PlannedRow | null; // merged now, bumps the version
  late: PlannedRow | null; // past the drink deadlines, a manager confirms
  requests: PlannedRow | null; // hours, extra drinks, package switch: a manager reaches out
}

function diffDrinks(oldDrinks: Drink[], newDrinks: Drink[]): FieldChange[] {
  const out: FieldChange[] = [];
  for (let i = 0; i < Math.max(oldDrinks.length, newDrinks.length); i++) {
    const o = oldDrinks[i] ?? null;
    const n = newDrinks[i] ?? null;
    if (sameValue(o, n)) continue;
    if (o && n && sameValue({ ...o, name: null }, { ...n, name: null })) {
      out.push({ field: `signature_drinks[${i}].name`, old: o.name ?? null, new: n.name ?? null });
    } else {
      out.push({ field: `signature_drinks[${i}]`, old: o, new: n });
    }
  }
  return out;
}

function row(changes: FieldChange[], applied: boolean, within: boolean | null): PlannedRow | null {
  if (changes.length === 0) return null;
  return { changes, applied, within_deadline: within, summary: summarizeChanges(changes) };
}

export function planUpdate(
  current: EventData,
  partial: EventData,
  options: { managerRequest?: string | null; deadlines: Deadlines }
): UpdatePlan {
  const { deadlines } = options;
  const updates: EventData = {};
  for (const key of UPDATABLE_FIELDS) {
    if (key in partial && partial[key] !== undefined) updates[key] = partial[key];
  }

  const requests: FieldChange[] = [];
  if (options.managerRequest && options.managerRequest.trim()) {
    requests.push({ field: "manager_request", old: null, new: options.managerRequest.trim() });
  }

  // Extending bar service is a manager request, a same length shift is not.
  if ("bar_service_start" in updates || "bar_service_end" in updates) {
    const oldStart = current.bar_service_start as string | undefined;
    const oldEnd = current.bar_service_end as string | undefined;
    const newStart = (updates.bar_service_start ?? oldStart) as string | undefined;
    const newEnd = (updates.bar_service_end ?? oldEnd) as string | undefined;
    if (calculateHours(newStart, newEnd) > calculateHours(oldStart, oldEnd)) {
      requests.push({
        field: "manager_request",
        old: null,
        new: `Extend bar service. Currently ${oldStart ?? "?"} to ${oldEnd ?? "?"}, requested ${newStart ?? "?"} to ${newEnd ?? "?"}`,
      });
      delete updates.bar_service_start;
      delete updates.bar_service_end;
    }
  }

  // Drinks beyond the package count are a manager request.
  const currentDrinks = (Array.isArray(current.signature_drinks) ? current.signature_drinks : []) as Drink[];
  let newDrinks: Drink[] | null = Array.isArray(updates.signature_drinks)
    ? (updates.signature_drinks as Drink[])
    : null;
  if (newDrinks) {
    const allowed = Math.max(packageDrinkCount(current.package), currentDrinks.length);
    if (newDrinks.length > allowed) {
      const extra = newDrinks.slice(allowed);
      requests.push({
        field: "manager_request",
        old: null,
        new: `Add drinks beyond the package count: ${extra.map(formatDrink).join(" | ")}`,
      });
      newDrinks = newDrinks.slice(0, allowed);
    }
  }

  const changes: FieldChange[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === "signature_drinks") continue;
    if (!sameValue(current[key], value)) changes.push({ field: key, old: current[key] ?? null, new: value });
  }
  if (newDrinks) changes.push(...diffDrinks(currentDrinks, newDrinks));

  const now: FieldChange[] = [];
  const late: FieldChange[] = [];
  for (const c of changes) {
    const isDrink = c.field.startsWith("signature_drinks[");
    const isName = isDrink && c.field.endsWith(".name");
    const open = isName ? deadlines.namesOpen : isDrink ? deadlines.drinksOpen : !deadlines.eventPassed;
    (open ? now : late).push(c);
  }

  return {
    next: applyChanges(current, now),
    applied: row(now, true, true),
    late: row(late, false, false),
    requests: row(requests, false, null),
  };
}
