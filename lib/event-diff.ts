// Pure update mode logic: diff a partial event against the current event_data,
// refuse drink changes inside the six day cutoff, split out requests a manager
// has to handle, and rebuild any version from event_updates history. No database access here, see
// lib/event-updates.ts for that.

import { parseEventDate } from "@/lib/event-date";
import { diveSetMenuDrinks, isDiveBarPackage } from "@/lib/dive-menu";

export type EventData = Record<string, unknown>;
type Drink = Record<string, unknown>;

export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
  note?: string; // why it changed, on changes the client did not ask for (see impliedChanges)
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
  // Priced or schedule fields not covered above
  "event_date",
  "hours_booked",
  "package",
  "bartenders",
  // How the client wants the remaining balance handled
  "payment_preference",
] as const;

/**
 * Booking fields: the date, schedule, size, package, and address. Summaries and
 * the webhook list them first, in this order, and the webhook sends each one's
 * value after the update as pending_change_<field>.
 */
export const BOOKING_FIELDS = [
  "event_date",
  "bar_service_start",
  "bar_service_end",
  "hours_booked",
  "guest_count",
  "bartenders",
  "package",
  "event_address",
] as const;

/**
 * Fields that change the price. The bot quotes the difference from the pricing
 * engine and gets a yes before saving a change to any of them. A time shift that
 * keeps the same hours prices as no change.
 */
export const PRICED_FIELDS = [
  "bar_service_start",
  "bar_service_end",
  "hours_booked",
  "guest_count",
  "bartenders",
  "package",
] as const;

export function isPricedField(field: string): boolean {
  return (PRICED_FIELDS as readonly string[]).includes(field);
}

/** Fields that make up the drink menu, locked inside the six day cutoff. */
export const DRINK_FIELDS = ["signature_drinks", "dive_menu_requested"] as const;

export function isDrinkField(field: string): boolean {
  return field.startsWith("signature_drinks") || (DRINK_FIELDS as readonly string[]).includes(field);
}

/** What the client hears when they try to change drinks inside the cutoff. */
export const DRINKS_LOCKED_MESSAGE =
  "We are within 6 days of your event, so your drink menu is locked in. Our team has already started preparing for it.";

/** Days before the event that drink changes are still allowed. */
export const DRINK_CUTOFF_DAYS = 6;

const FIELD_LABELS: Record<string, string> = {
  guest_count: "Guest count",
  bar_service_start: "Bar service start",
  bar_service_end: "Bar service end",
  venue_type: "Venue type",
  event_address: "Event address",
  indoor_outdoor: "Bar indoor or outdoor",
  bar_on_site: "Bar on site",
  bar_details: "Bar details",
  bar_floor_access: "Bar floor access",
  parking_info: "Parking info",
  day_of_contact_name: "Day of contact",
  day_of_contact_phone: "Day of contact phone",
  beer: "Beer",
  wine: "Wine",
  client_providing_beer_wine: "Client providing beer and wine",
  beer_and_wine_details: "Beer and wine details",
  special_requests: "Special requests",
  dual_bar_setup: "Second bar setup",
  extra_bottles: "Extra bottles",
  allergies: "Allergies",
  drinking_pace: "Drinking pace",
  theme: "Theme",
  event_colors: "Event colors",
  menu_colors: "Menu colors",
  event_name: "Event name",
  dive_menu_requested: "Dive Bar menu requested",
  dive_set_menu: "Dive Bar set menu",
  manager_request: "Manager request",
  event_date: "Event date",
  hours_booked: "Hours booked",
  package: "Package",
  bartenders: "Bartenders",
  payment_preference: "Payment preference",
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
  daysUntil: number | null; // calendar days from today to the event day
  lastDrinkChangeDay: string | null; // the last day drinks can change, 6 days before the event
  withinSixDays: boolean; // fewer than 6 days out: everything but drinks can still change
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

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Six or more days before the event date (America/Chicago) everything can change.
 * Fewer than six days out everything but the drink menu can. An unreadable event
 * date never counts as inside the cutoff, so the client is not told something false.
 */
export function computeDeadlines(eventDate: unknown, now: Date = new Date()): Deadlines {
  const today = chicagoToday(now);
  const parsed = parseEventDate(typeof eventDate === "string" ? eventDate : null);
  if (!parsed) {
    return { today, eventDay: null, daysUntil: null, lastDrinkChangeDay: null, withinSixDays: false, eventPassed: false };
  }
  const eventDay = toYmd(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  const daysUntil = Math.round((ymdToUtc(eventDay) - ymdToUtc(today)) / 86_400_000);
  const last = new Date(ymdToUtc(eventDay) - DRINK_CUTOFF_DAYS * 86_400_000);
  return {
    today,
    eventDay,
    daysUntil,
    lastDrinkChangeDay: toYmd(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate()),
    withinSixDays: daysUntil < DRINK_CUTOFF_DAYS,
    eventPassed: daysUntil < 0,
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
//
// Notes and summaries are read by staff on a phone, so everything here is plain
// text: no HTML, no markdown, no hyphen separators, and labels in plain English.

/** Free text fields that are diffed sentence by sentence instead of printed whole. */
const LONG_TEXT_FIELDS = new Set(["special_requests", "parking_info", "bar_details", "beer_and_wine_details"]);

function drinkIndexLabel(field: string): string | null {
  const m = field.match(/^signature_drinks\[(\d+)\](\.name)?$/);
  if (!m) return null;
  return `Drink ${Number(m[1]) + 1}${m[2] ? " name" : ""}`;
}

export function fieldLabel(field: string): string {
  return drinkIndexLabel(field) ?? FIELD_LABELS[field] ?? field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** One line of plain text: no <br>, no markdown markers, no " - " separators. */
function plain(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/[*#`]+/g, "")
    // "TBD - Client will provide later" reads as "TBD, client will provide later".
    .replace(/\s+[-\u2013\u2014]+\s+([A-Z](?=[a-z]))?/g, (_m, c?: string) => `, ${c ? c.toLowerCase() : ""}`)
    .replace(/\s+/g, " ")
    .trim();
}

// "Top with Coca-Cola" reads better mid list as "top with Coca-Cola".
const LOWERCASE_LEAD = /^(Top|Splash|Dash|Pinch|Float|Fill)\b/;

export function formatDrink(d: Drink): string {
  const name = plain(String(d.name ?? "Unnamed drink"));
  const kind = d.is_mocktail ? "mocktail" : d.base_spirit ? plain(String(d.base_spirit)) : "";
  const head = kind ? `${name} (${kind})` : name;
  const list = Array.isArray(d.ingredients)
    ? d.ingredients.map((x, i) => {
        const t = plain(String(x));
        return i > 0 && LOWERCASE_LEAD.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
      })
    : d.ingredients
      ? [plain(String(d.ingredients))]
      : [];
  return list.length > 0 ? `${head}. ${list.join(", ")}` : head;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "None";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    if (v.length === 0) return "None";
    return v.map((x) => formatValue(x)).join(", ");
  }
  if (typeof v === "object") {
    const obj = v as Drink;
    if ("ingredients" in obj || "base_spirit" in obj) return formatDrink(obj);
    return Object.entries(obj)
      .filter(([, x]) => x !== null && x !== undefined && x !== "")
      .map(([k, x]) => `${fieldLabel(k)}: ${formatValue(x)}`)
      .join(", ");
  }
  return plain(String(v));
}

function sentences(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  const text = typeof v === "string" ? v.replace(/<br\s*\/?>/gi, "\n") : formatValue(v);
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map(plain)
    .filter((x) => x && x !== "None");
}

const sentenceKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Sentences in the new text that were not in the old one, and the reverse. */
export function sentenceDiff(oldText: unknown, newText: unknown): { added: string[]; removed: string[] } {
  const oldList = sentences(oldText);
  const newList = sentences(newText);
  const oldKeys = new Set(oldList.map(sentenceKey));
  const newKeys = new Set(newList.map(sentenceKey));
  return {
    added: newList.filter((s) => !oldKeys.has(sentenceKey(s))),
    removed: oldList.filter((s) => !newKeys.has(sentenceKey(s))),
  };
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * One change as a block: the label, then indented Was/Now lines, Added/Removed
 * sentences for long text, or Added/Removed/Was/Now for a drink. Returns null
 * for a long text change that neither added nor removed a sentence.
 */
export function changeBlock(c: FieldChange): string | null {
  if (c.field === "manager_request") return `Manager request\n  ${formatValue(c.new)}`;
  const label = fieldLabel(c.field);

  if (LONG_TEXT_FIELDS.has(c.field)) {
    const { added, removed } = sentenceDiff(c.old, c.new);
    if (added.length === 0 && removed.length === 0) return null;
    const lines = [label];
    if (added.length > 0) lines.push(`  Added: "${added.join(" ")}"`);
    if (removed.length > 0) lines.push(`  Removed: "${removed.join(" ")}"`);
    return lines.join("\n");
  }

  if (/^signature_drinks\[\d+\]$/.test(c.field)) {
    if (isEmpty(c.old)) return `${label}\n  Added: ${formatValue(c.new)}`;
    if (isEmpty(c.new)) return `${label}\n  Removed: ${formatValue(c.old)}`;
  }

  // Nothing on file before: a "Was: None" line would only read as a mistake.
  const was = formatValue(c.old);
  const now = `${formatValue(c.new)}${c.note ? ` (${c.note})` : ""}`;
  return was === "None" ? `${label}\n  Now: ${now}` : `${label}\n  Was: ${was}\n  Now: ${now}`;
}

/** Booking fields first in their fixed order, everything else as it came. */
function sortChanges(changes: FieldChange[]): FieldChange[] {
  const rank = (c: FieldChange) => {
    const i = (BOOKING_FIELDS as readonly string[]).indexOf(c.field);
    return i === -1 ? BOOKING_FIELDS.length : i;
  };
  return [...changes].sort((a, b) => rank(a) - rank(b));
}

/** Every displayable block. If all were skipped, one line says so instead of nothing. */
export function changeBlocks(changes: FieldChange[]): string[] {
  const blocks = sortChanges(changes).map(changeBlock).filter((b): b is string => b !== null);
  if (blocks.length === 0 && changes.length > 0) {
    const labels = [...new Set(changes.map((c) => fieldLabel(c.field)))].join(", ");
    return [`${labels}\n  Wording edited, nothing added or removed`];
  }
  return blocks;
}

/**
 * Why an unapplied row needs a manager: manager_request rows are extra drinks or
 * other requests. Rows saved before every update applied right away may also be
 * past the old drink deadline. Null for applied rows.
 */
export function approvalReason(r: { applied: boolean; within_deadline: boolean | null; changes: FieldChange[] }): string | null {
  if (r.applied) return null;
  if (r.within_deadline === false) return "past drink deadline";
  const requests = r.changes.filter((c) => c.field === "manager_request").map((c) => String(c.new ?? ""));
  const reasons: string[] = [];
  if (requests.some((t) => t.startsWith("Extend bar service"))) reasons.push("hours change");
  if (requests.some((t) => t.startsWith("Add drinks beyond"))) reasons.push("extra drinks");
  if (reasons.length < requests.length || reasons.length === 0) reasons.push("client request");
  return reasons.join(", ");
}

export const SUMMARY_MAX = 500;

/**
 * Plain text summary for GHL (last_change_summary) and the staff SMS: the same
 * blocks as the note without its header, separated by blank lines, at most
 * SUMMARY_MAX characters. Blocks that do not fit become "and N more changes".
 */
export function summarizeChanges(
  changes: FieldChange[],
  reason: string | null = null,
  max: number = SUMMARY_MAX
): string {
  const blocks = changeBlocks(changes);
  const more = (n: number) => `and ${n} more change${n === 1 ? "" : "s"}`;
  const len = (parts: string[]) => parts.join("\n\n").length;
  const out: string[] = reason ? [`Needs manager approval: ${reason}`] : [];
  const fixed = out.length;

  for (let i = 0; i < blocks.length; i++) {
    const rest = blocks.length - i - 1;
    const restTail = rest > 0 ? [more(rest)] : [];
    if (len([...out, blocks[i], ...restTail]) <= max) {
      out.push(blocks[i]);
      continue;
    }
    if (out.length === fixed) {
      // Even the first block is too long on its own: cut it rather than send nothing.
      const room = max - len([...out, "", ...restTail]) - 3;
      out.push(blocks[i].slice(0, Math.max(0, room)).trimEnd() + "...");
      return [...out, ...restTail].join("\n\n");
    }
    return [...out, more(blocks.length - i)].join("\n\n");
  }
  return out.join("\n\n");
}

/** Summary for a stored or planned row, with the approval line for unapplied rows. */
export function summarizeRow(r: { applied: boolean; within_deadline: boolean | null; changes: FieldChange[] }): string {
  return summarizeChanges(r.changes, approvalReason(r));
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
  requests: PlannedRow | null; // extra drinks beyond the package: a manager reaches out
  // Drink menu changes asked for inside the six day cutoff. Not saved, not noted,
  // not sent anywhere: the client is told the drink menu is locked.
  refusedDrinks: boolean;
  // Drink menu changes on Dive Bar, which has a set menu. Refused the same way,
  // and the client is told the menu is set for the package.
  diveMenuSet: boolean;
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
  return { changes, applied, within_deadline: within, summary: summarizeRow({ changes, applied, within_deadline: within }) };
}

/**
 * Every confirmed change applies now. Inside the six day cutoff, drink menu
 * changes (and extra drink requests) are dropped and flagged as refused.
 */
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
        new: `Add drinks beyond the package count: ${extra.map(formatDrink).join("; ")}`,
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

  // Inside the cutoff the drink menu is locked: drop drink changes and extra drink requests.
  let refusedDrinks = false;
  let kept = changes;
  let keptRequests = requests;
  if (deadlines.withinSixDays) {
    kept = changes.filter((c) => !isDrinkField(c.field));
    keptRequests = requests.filter((c) => !String(c.new).startsWith("Add drinks beyond"));
    refusedDrinks = kept.length < changes.length || keptRequests.length < requests.length;
  }

  // Dive Bar has a set menu: drink changes are refused while the event stays on Dive Bar.
  let diveMenuSet = false;
  const nextPkg = "package" in updates ? updates.package : current.package;
  if (isDiveBarPackage(current.package) && isDiveBarPackage(nextPkg)) {
    const before = kept.length + keptRequests.length;
    kept = kept.filter((c) => !isDrinkField(c.field));
    keptRequests = keptRequests.filter((c) => !String(c.new).startsWith("Add drinks beyond"));
    diveMenuSet = kept.length + keptRequests.length < before;
  } else if (!isDiveBarPackage(current.package) && isDiveBarPackage(nextPkg) && kept.some((c) => c.field === "package")) {
    // Switching to Dive Bar brings its set menu with it.
    kept = kept.filter((c) => !isDrinkField(c.field));
    kept.push({ field: "signature_drinks", old: current.signature_drinks ?? null, new: diveSetMenuDrinks() });
    if (current.dive_set_menu !== true) kept.push({ field: "dive_set_menu", old: current.dive_set_menu ?? null, new: true });
    keptRequests = keptRequests.filter((c) => !String(c.new).startsWith("Add drinks beyond"));
  } else if (isDiveBarPackage(current.package) && !isDiveBarPackage(nextPkg) && current.dive_set_menu === true && kept.some((c) => c.field === "package")) {
    // Leaving Dive Bar: the five classics stay as the drinks, no longer a set menu.
    kept.push({ field: "dive_set_menu", old: true, new: false });
  }

  return {
    next: applyChanges(current, kept),
    applied: row(kept, true, true),
    requests: row(keptRequests, false, null),
    refusedDrinks,
    diveMenuSet,
  };
}

// ---------- recap ----------

const RECAP_LONG_TEXT = LONG_TEXT_FIELDS;

/** A drink as the client sees it in a recap: the name only, never oz amounts. */
function drinkName(v: unknown): string {
  if (!v || typeof v !== "object") return formatValue(v);
  return plain(String((v as Drink).name ?? "Unnamed drink"));
}

/**
 * Consolidate the changes saved in one chat: per field, the value before the
 * first change and after the last one. Fields that ended where they started drop out.
 */
export function consolidateChanges(changes: FieldChange[]): FieldChange[] {
  const byField = new Map<string, FieldChange>();
  for (const c of changes) {
    if (c.field === "manager_request") continue;
    const prior = byField.get(c.field);
    byField.set(c.field, prior ? { field: c.field, old: prior.old, new: c.new } : { field: c.field, old: c.old, new: c.new });
  }
  return sortChanges([...byField.values()].filter((c) => !sameValue(c.old, c.new)));
}

/** One plain text recap line per change, old value to new value, for the client. */
export function recapLines(changes: FieldChange[]): string[] {
  return consolidateChanges(changes).flatMap((c) => {
    const label = fieldLabel(c.field);
    if (RECAP_LONG_TEXT.has(c.field)) {
      const { added, removed } = sentenceDiff(c.old, c.new);
      const parts = [
        added.length > 0 ? `added "${added.join(" ")}"` : "",
        removed.length > 0 ? `removed "${removed.join(" ")}"` : "",
      ].filter(Boolean);
      return parts.length > 0 ? [`${label}: ${parts.join(", ")}`] : [];
    }
    const isDrink = c.field.startsWith("signature_drinks[");
    const show = (v: unknown) => (isDrink ? drinkName(v) : formatValue(v));
    if (isDrink && isEmpty(c.old)) return [`${label}: added ${show(c.new)}`];
    if (isDrink && isEmpty(c.new)) return [`${label}: removed ${show(c.old)}`];
    const was = show(c.old);
    return [was === "None" ? `${label}: now ${show(c.new)}` : `${label}: from ${was} to ${show(c.new)}`];
  });
}
