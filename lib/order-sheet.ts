// The order sheet: everything for one event, what the client buys and what we
// buy, laid out like Isabel's Word order sheets. Pure, no database.
//
// Calculated lines come from the lists the app already makes, unchanged:
// what the client buys from the client shopping list (lib/client-list.ts), and
// what we buy from Natalie's supply list (generateNatalieSupplyList) without
// its spirits and recipes. Nothing here computes a quantity. Hand edits, store
// choices, and Ordered checks are saved per line for this event only and
// merged on top (buildSheet). They never change either list.

import { calculateHours, formatPackageLabel, generateNatalieSupplyList } from "@/lib/shopping-list";
import { parseEventDate } from "@/lib/event-date";
import { clientList, quietly } from "@/lib/client-list";
import { SECTIONS, STORE_INFO, STORES, isSection, type SectionId, type Store } from "@/lib/order-sheet-shared";
export { SECTIONS, STORE_INFO, STORES, isSection, isStore, type SectionId, type Store } from "@/lib/order-sheet-shared";

type EventData = Record<string, unknown>;

export interface Fields {
  name: string;
  quantity: string; // "5 bottles"
  size: string; // "750 ml", or empty
  detail: string; // brand or note: "Grey Goose or Titos", or empty
}

export const FIELD_NAMES = ["name", "quantity", "size", "detail"] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

export interface CalcLine extends Fields {
  key: string; // "liquor:vodka", stable while the item stays on the calculated list
  section: SectionId;
  clientBuys: boolean; // on the client's own shopping list, so we do not order it
}

// ----- Reading the existing lists -----

/** Where each heading of the two lists goes on the sheet. Spirits and recipes are not order lines. */
const SECTION_OF: Record<string, SectionId | null> = {
  LIQUOR: "liquor",
  "BEER & WINE": "liquor",
  "MIXERS AND JUICES": "mixers",
  "PUREES JUICES AND SYRUPS": "mixers",
  "GINGER BEER AND SODA": "mixers",
  "RECIPE MIXERS": "mixers",
  "PRODUCE AND GARNISHES": "produce",
  "PRODUCE AND GARNISH": "produce",
  "BASELINE MIXERS": "baseline",
  "ICE & BAR SUPPLIES": "ice",
  ICE: "ice",
  SPIRITS: null,
  "SIGNATURE DRINK RECIPES": null,
};

function clean(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "5 bottles (750 ml)" as quantity "5 bottles", size "750 ml", and
 * "3 x 32 oz bottles" as "3 bottles", "32 oz", the way the samples write them.
 * Only the wording is rearranged: the numbers are the calculated ones.
 * Anything that does not fit stays whole in quantity.
 */
export function splitQuantity(q: string): { quantity: string; size: string; extra: string } {
  const text = q.trim();
  const times = text.match(/^(\d+(?:\.\d+)?) x (\d+(?:\.\d+)? ?(?:oz|ml|liter|l|lb))\s+(bottles?|cans?|cartons?|jars?|bags?|containers?)\b(.*)$/i);
  if (times) return { quantity: `${times[1]} ${times[3]}`, size: times[2], extra: unwrap(times[4]) };
  // "23 x Goslings ginger beer 12 oz cans" as "23 cans", "12 oz", "Goslings ginger beer".
  const branded = text.match(/^(\d+) x (.+?) (\d+(?:\.\d+)? ?(?:oz|ml|liter|l)) (cans?|bottles?)$/i);
  if (branded) return { quantity: `${branded[1]} ${branded[4]}`, size: branded[3], extra: branded[2].trim() };
  const paren = text.match(/^(\d+(?:\s*to\s*\d+)?) (bottles?|cases?|cans?|jars?|bags?|packs?|cartons?) \(([^)]*)\)(.*)$/i);
  if (paren) return { quantity: `${paren[1]} ${paren[2]}`, size: paren[3].trim(), extra: unwrap(paren[4]) };
  return { quantity: text, size: "", extra: "" };
}

function unwrap(rest: string): string {
  return rest.trim().replace(/^,\s*/, "").replace(/^\((.*)\)$/, "$1").trim();
}

function lineFields(name: string, quantityText: string, brand: string): Fields {
  const { quantity, size, extra } = splitQuantity(quantityText);
  return { name: capital(name.trim()), quantity, size, detail: [brand.trim(), extra].filter(Boolean).join(", ") };
}

/** Lines of Natalie's supply list (HTML with <br> or plain lines) under their headings. */
function supplyListLines(html: string): { section: SectionId; fields: Fields }[] {
  const out: { section: SectionId; fields: Fields }[] = [];
  let section: SectionId | null = null;
  for (const raw of html.split(/<br\s*\/?>|\n/)) {
    const heading = raw.match(/^\s*<b>([^<]+)<\/b>\s*$/);
    if (heading) {
      const title = heading[1].trim().toUpperCase();
      section = title in SECTION_OF ? SECTION_OF[title] : "mixers";
      continue;
    }
    if (!section) continue;
    const line = clean(raw);
    const at = line.indexOf(" — ");
    if (at < 0) continue;
    out.push({ section, fields: lineFields(line.slice(0, at), line.slice(at + 3), "") });
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Every calculated line, in sheet section order. */
export function calculatedLines(eventData: EventData): CalcLine[] {
  const raw: { section: SectionId; fields: Fields; clientBuys: boolean }[] = [];

  for (const s of clientList(eventData).sections) {
    const section = SECTION_OF[s.title];
    if (!section) continue;
    for (const line of s.lines) {
      const [name, quantity = "", ...brand] = line.split(" — ");
      raw.push({ section, fields: lineFields(name, quantity, brand.join(" — ")), clientBuys: true });
    }
  }

  const supply = quietly(() => generateNatalieSupplyList(eventData as unknown as Parameters<typeof generateNatalieSupplyList>[0]));
  for (const l of supplyListLines(supply)) raw.push({ ...l, clientBuys: false });

  const seen = new Map<string, number>();
  const lines: CalcLine[] = [];
  for (const s of SECTIONS) {
    for (const r of raw.filter((x) => x.section === s.id)) {
      const base = `${s.id}:${slug(r.fields.name) || "item"}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      lines.push({ key: n === 1 ? base : `${base}#${n}`, section: s.id, clientBuys: r.clientBuys, ...r.fields });
    }
  }
  return lines;
}

// ----- Header and recipes -----

function guestCount(v: unknown): number {
  if (typeof v === "number" && v > 0) return v;
  const s = String(v ?? "").trim();
  const range = s.match(/^(\d+)\s*(?:-|to|–)\s*(\d+)$/i);
  if (range) return Number(range[2]);
  const n = parseInt(s, 10);
  return n > 0 ? n : 50;
}

export interface SheetHeader {
  line: string; // "11/14/26 (Dive Bar) 75 guests, 5 hours"
  theme: string;
  colors: string;
}

export function sheetHeader(ed: EventData): SheetHeader {
  const d = parseEventDate(typeof ed.event_date === "string" ? ed.event_date : null);
  const date = d ? `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}` : String(ed.event_date ?? "Date TBD");
  const pkg = formatPackageLabel(typeof ed.package === "string" ? ed.package : undefined);
  const hours = calculateHours(ed.bar_service_start as string | undefined, ed.bar_service_end as string | undefined);
  const guests = guestCount(ed.guest_count);
  return {
    line: `${date}${pkg ? ` (${pkg})` : ""} ${guests} guests, ${hours} hours`,
    theme: String(ed.theme ?? "").trim(),
    colors: String(ed.event_colors ?? "").trim(),
  };
}

export interface Recipe {
  name: string;
  mocktail: boolean;
  cup: "9 oz" | "12 oz";
  ingredients: string[];
  garnish: string;
}

function ingredientsOf(d: Record<string, unknown>): string[] {
  const v = d.ingredients;
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}

const UP_DRINK = /\b(martini|coupe|straight up|served up|neat|nick (and|&) nora|cosmo|cosmopolitan|lemon drop|manhattan|old fashioned|carajillo)\b/;
const LONG_DRINK = /\b(top|topped|soda|tonic|ginger beer|ginger ale|prosecco|champagne|sparkling|cola|coke|sprite|squirt|lemonade|beer|tea)\b/;

/**
 * Cup size, following the samples: 9 oz for drinks served up (martinis, an
 * espresso martini, a carajillo) and short spirit forward drinks with no
 * mixer on top (3.5 oz poured or less, like an old fashioned). 12 oz for
 * everything else: highballs, spritzes, margaritas, anything topped.
 */
export function cupSize(d: Record<string, unknown>): "9 oz" | "12 oz" {
  const label = `${d.name ?? ""} ${d.method ?? ""} ${d.glass ?? ""}`.toLowerCase();
  if (UP_DRINK.test(label)) return "9 oz";
  const ings = ingredientsOf(d).map((i) => i.toLowerCase());
  if (ings.some((i) => LONG_DRINK.test(i))) return "12 oz";
  const poured = ings.reduce((sum, i) => sum + (parseFloat(i.match(/^(\d+(?:\.\d+)?)\s*oz\b/)?.[1] ?? "0") || 0), 0);
  return poured > 0 && poured <= 3.5 ? "9 oz" : "12 oz";
}

export function recipes(ed: EventData): Recipe[] {
  const drinks = Array.isArray(ed.signature_drinks) ? (ed.signature_drinks as Record<string, unknown>[]) : [];
  return drinks
    .filter((d) => d && typeof d === "object")
    .map((d) => {
      const garnish = String(d.garnish ?? "").trim();
      return {
        name: String(d.name ?? "Unnamed drink"),
        mocktail: d.is_mocktail === true,
        cup: cupSize(d),
        ingredients: ingredientsOf(d),
        garnish: /^(none|no garnish)$/i.test(garnish) ? "" : garnish,
      };
    });
}

// ----- Saved edits merged on top -----

/** One saved row: a calculated line someone touched (line_key set), or a line an admin added. */
export interface SavedLine {
  id: string;
  session_id: string;
  line_key: string | null;
  section: SectionId;
  kind: "calc" | "added";
  name: string | null; // null keeps the calculated value
  quantity: string | null;
  size: string | null;
  detail: string | null;
  base: Fields | null; // the calculated values when the hand edit was made
  removed: boolean;
  store: Store | null;
  store_item: string | null;
  store_by_name: string | null;
  store_at: string | null;
  ordered: boolean;
  ordered_by_name: string | null;
  ordered_at: string | null;
  edited_by_name: string | null;
  edited_at: string | null;
  created_at: string;
}

export interface SheetLine {
  ref: string; // "k:<key>" for calculated lines, "i:<id>" for added ones
  section: SectionId;
  kind: "calc" | "added";
  fields: Fields;
  calc: Fields | null; // the calculated values now, null for added lines and lines no longer calculated
  edited: FieldName[];
  editedBy: string | null;
  editedAt: string | null;
  // A hand edited line whose calculated value changed after the edit: both are shown.
  conflict: { mine: Fields; calc: Fields } | null;
  gone: boolean; // edited or ordered, then dropped from the calculation by an update
  clientBuys: boolean;
  store: Store | null;
  storeBy: string | null;
  storeAt: string | null;
  suggestion: Store | null; // never applied by itself: shown as a suggestion until someone picks a store
  ordered: boolean;
  orderedBy: string | null;
  orderedAt: string | null;
  highlight: string | null; // the store's color, none when no store is set
  text: string;
}

export interface SheetSection {
  id: SectionId;
  title: string;
  lines: SheetLine[];
}

export interface Sheet {
  sections: SheetSection[];
  removed: SheetLine[]; // calculated lines an admin removed, so they can be put back
  counts: { store: Store | null; label: string; count: number }[]; // Walmart 14 · Sam's Club 6 · not set 3
  legend: Store[]; // only the stores in use
  progress: { ordered: number; total: number }; // lines we buy; the client's own lines are not ours to order
  status: OrderStatus;
}

export type OrderStatus = "not_started" | "in_progress" | "all_ordered" | "nothing_to_order";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  not_started: "order not started",
  in_progress: "order in progress",
  all_ordered: "all ordered",
  nothing_to_order: "client buys all",
};

export function lineText(f: Fields): string {
  return `${f.name} — ${f.quantity}${f.size ? ` (${f.size})` : ""}${f.detail ? ` — ${f.detail}` : ""}`;
}

export function sameFields(a: Fields | null, b: Fields | null): boolean {
  return !!a && !!b && FIELD_NAMES.every((k) => (a[k] ?? "") === (b[k] ?? ""));
}

/** A name for matching the same item across events: "Lime juice" and "lime  juice" match. */
export function itemKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function hasOverride(s: SavedLine): boolean {
  return FIELD_NAMES.some((k) => s[k] !== null && s[k] !== undefined);
}

function toLine(o: {
  ref: string;
  section: SectionId;
  kind: "calc" | "added";
  calc: Fields | null;
  saved: SavedLine | undefined;
  clientBuys: boolean;
  gone: boolean;
  suggest: (name: string) => Store | null;
}): SheetLine {
  const s = o.saved;
  const fallback = o.calc ?? s?.base ?? { name: "", quantity: "", size: "", detail: "" };
  const fields: Fields = {
    name: s?.name ?? fallback.name,
    quantity: s?.quantity ?? fallback.quantity,
    size: s?.size ?? fallback.size,
    detail: s?.detail ?? fallback.detail,
  };
  const edited = o.kind === "calc" && s ? FIELD_NAMES.filter((k) => s[k] !== null && s[k] !== undefined) : [];
  const conflict = o.calc && edited.length > 0 && s?.base && !sameFields(s.base, o.calc) ? { mine: fields, calc: o.calc } : null;
  const store = s?.store ?? null;
  return {
    ref: o.ref,
    section: o.section,
    kind: o.kind,
    fields,
    calc: o.calc,
    edited,
    editedBy: s?.edited_by_name ?? null,
    editedAt: s?.edited_at ?? null,
    conflict,
    gone: o.gone,
    clientBuys: o.clientBuys,
    store,
    storeBy: s?.store_by_name ?? null,
    storeAt: s?.store_at ?? null,
    suggestion: store ? null : o.suggest(fields.name),
    ordered: s?.ordered === true,
    orderedBy: s?.ordered_by_name ?? null,
    orderedAt: s?.ordered_at ?? null,
    highlight: store ? STORE_INFO[store].color : null,
    text: lineText(fields),
  };
}

/** The sheet: calculated lines with this event's saved edits on top, added lines, counts, legend, and progress. */
export function buildSheet(calc: CalcLine[], saved: SavedLine[], suggest: (name: string) => Store | null = () => null): Sheet {
  const byKey = new Map(saved.filter((s) => s.line_key).map((s) => [s.line_key!, s]));
  const calcKeys = new Set(calc.map((c) => c.key));
  const sections: SheetSection[] = SECTIONS.map((s) => ({ id: s.id, title: s.title, lines: [] }));
  const at = (id: SectionId) => sections.find((s) => s.id === id)!;
  const removed: SheetLine[] = [];

  for (const c of calc) {
    const s = byKey.get(c.key);
    const line = toLine({ ref: `k:${c.key}`, section: c.section, kind: "calc", calc: { name: c.name, quantity: c.quantity, size: c.size, detail: c.detail }, saved: s, clientBuys: c.clientBuys, gone: false, suggest });
    (s?.removed ? removed : at(c.section).lines).push(line);
  }
  // Edited or ordered lines an update took off the calculation: flagged, not dropped silently.
  for (const s of saved) {
    if (s.kind !== "calc" || !s.line_key || calcKeys.has(s.line_key) || s.removed) continue;
    if (!hasOverride(s) && !s.ordered) continue;
    at(isSection(s.section) ? s.section : "mixers").lines.push(
      toLine({ ref: `k:${s.line_key}`, section: s.section, kind: "calc", calc: null, saved: s, clientBuys: false, gone: true, suggest })
    );
  }
  for (const s of [...saved].filter((x) => x.kind === "added").sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (s.removed) continue;
    at(isSection(s.section) ? s.section : "mixers").lines.push(
      toLine({ ref: `i:${s.id}`, section: s.section, kind: "added", calc: null, saved: s, clientBuys: false, gone: false, suggest })
    );
  }

  const all = sections.flatMap((s) => s.lines);
  const counts = [
    ...STORES.map((st) => ({ store: st as Store | null, label: STORE_INFO[st].label, count: all.filter((l) => l.store === st).length })).filter((c) => c.count > 0),
    { store: null, label: "not set", count: all.filter((l) => !l.store).length },
  ];
  const ours = all.filter((l) => !l.clientBuys);
  const progress = { ordered: ours.filter((l) => l.ordered).length, total: ours.length };
  return {
    sections,
    removed,
    counts,
    legend: STORES.filter((st) => all.some((l) => l.store === st)),
    progress,
    status: orderStatus(progress),
  };
}

export function orderStatus(p: { ordered: number; total: number }): OrderStatus {
  if (p.total === 0) return "nothing_to_order";
  if (p.ordered === 0) return "not_started";
  return p.ordered >= p.total ? "all_ordered" : "in_progress";
}

/** The By store view: the same lines as the sheet, under each store in use, then the ones with no store. */
export function byStore(sheet: Sheet): { store: Store | null; title: string; lines: SheetLine[] }[] {
  const all = sheet.sections.flatMap((s) => s.lines);
  return [
    ...STORES.map((st) => ({ store: st as Store | null, title: STORE_INFO[st].label, lines: all.filter((l) => l.store === st) })).filter((g) => g.lines.length > 0),
    { store: null, title: "Not set", lines: all.filter((l) => !l.store) },
  ];
}

/**
 * Saved rows to delete after an update: calculated lines that left the
 * calculation and nobody edited or ordered. Their store and removal go with
 * them, so if the item comes back it starts blank (or suggested) again.
 */
export function staleRows(calc: CalcLine[], saved: SavedLine[]): string[] {
  const keys = new Set(calc.map((c) => c.key));
  return saved
    .filter((s) => s.kind === "calc" && s.line_key && !keys.has(s.line_key) && (s.removed || (!hasOverride(s) && !s.ordered)))
    .map((s) => s.id);
}
