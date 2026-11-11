// Order sheet sections, stores, and highlight colors, shared by the server and
// the order sheet page. No imports, so client components can use it.

/** Section order and titles as Isabel's samples have them (Keisha Davis, Lisa Banta): ice and bar supplies before the baseline mixers. */
export const SECTIONS = [
  { id: "liquor", title: "LIQUOR" },
  { id: "mixers", title: "MIXERS AND JUICES" },
  { id: "produce", title: "PRODUCE AND GARNISHES" },
  { id: "ice", title: "ICE & BAR SUPPLIES" },
  { id: "baseline", title: "BASELINE MIXERS" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

export function isSection(v: unknown): v is SectionId {
  return SECTIONS.some((s) => s.id === v);
}

/** A store id: one of the starting five ("specs") or a uuid for a store an admin added. */
export type Store = string;

/** A store on the team's list, as the sheet and the Manage stores screen see it. */
export interface StoreInfo {
  id: Store;
  name: string; // "Spec's pickup"
  color: string; // "#FF9900", always upper case
  position: number;
  retired: boolean; // stays on old sheets, not offered on new lines
  lastLegendName: string; // the legend name used on the last event, the default for the next
}

/**
 * Highlight colors to pick from: clearly different from each other, the first
 * five the ones on Isabel's legend (Word's orange shading and its turquoise,
 * pink, bright green and yellow highlights). The magenta is a little deeper
 * than Word's so white text on it stays readable, like the samples' white
 * bold Amazon lines.
 */
export const PALETTE = [
  { name: "Orange", color: "#FF9900" },
  { name: "Light blue", color: "#00FFFF" },
  { name: "Magenta", color: "#C000C0" },
  { name: "Green", color: "#00FF00" },
  { name: "Yellow", color: "#FFFF00" },
  { name: "Red", color: "#E0201B" },
  { name: "Blue", color: "#1F4FE0" },
  { name: "Teal", color: "#008080" },
  { name: "Purple", color: "#7030A0" },
  { name: "Pink", color: "#FFB3D9" },
  { name: "Gray", color: "#BFBFBF" },
  { name: "Brown", color: "#8B5A2B" },
  { name: "Olive", color: "#808000" },
  { name: "Dark green", color: "#1E7B34" },
  { name: "Navy", color: "#1F2A6B" },
] as const;

export function normalColor(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(s) ? s : null;
}

export function inPalette(color: string): boolean {
  return PALETTE.some((p) => p.color === color.toUpperCase());
}

export function paletteName(color: string): string {
  return PALETTE.find((p) => p.color === color.toUpperCase())?.name ?? color;
}

/** The team's list before anyone changes it, in Isabel's legend order. */
export const DEFAULT_STORES: StoreInfo[] = [
  { id: "specs", name: "Spec's pickup", color: "#FF9900", position: 1, retired: false, lastLegendName: "" },
  { id: "sams", name: "Sam's Club delivery", color: "#00FFFF", position: 2, retired: false, lastLegendName: "" },
  { id: "amazon", name: "Amazon", color: "#C000C0", position: 3, retired: false, lastLegendName: "" },
  { id: "walmart", name: "Walmart pickup", color: "#00FF00", position: 4, retired: false, lastLegendName: "" },
  { id: "delivery", name: "Delivery to event on day of", color: "#FFFF00", position: 5, retired: false, lastLegendName: "" },
];

/** The store that used to be the "Delivery to event on day of" checkbox. */
export const DELIVERY_STORE = "delivery";

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Text on a highlight: white on dark colors, black on light ones, whichever reads better. */
export function textOn(hex: string): "#FFFFFF" | "#000000" {
  const l = luminance(hex);
  return 1.05 / (l + 0.05) > (l + 0.05) / 0.05 ? "#FFFFFF" : "#000000";
}

/** Contrast ratio of the text color textOn picks, for the tests. */
export function contrastOn(hex: string): number {
  const l = luminance(hex);
  return Math.max(1.05 / (l + 0.05), (l + 0.05) / 0.05);
}

const PLAIN_SIZE = /^\d+(?:\.\d+)?\s?(?:fl oz|oz|ml|l|liters?|lb|lbs|gallons?)$/i;
const COUNTED = /^(\d+(?:\.\d+)?) ((?:bottle|can|bag|carton|jar|container|jug|box)e?s?)$/i;

/** The amount part of a line: "4 x 32 oz bottles", "5 bottles (750 ml)", or "" when there is none. */
export function amountText(f: { quantity: string; size: string }, section?: SectionId): string {
  const quantity = f.quantity.trim();
  const size = f.size.trim();
  const counted = quantity.match(COUNTED);
  if (size && counted && section !== "liquor" && PLAIN_SIZE.test(size)) return `${counted[1]} x ${size} ${counted[2]}`;
  if (size) return quantity ? `${quantity} (${size})` : size;
  return quantity;
}

/**
 * One line, worded the way Isabel's samples word it. Only the wording: every
 * number is the one in the fields.
 *   Lime juice — 4 x 32 oz bottles        (a mixer with a plain size)
 *   Vodka — 5 bottles (750 ml) — Tito's    (liquor keeps the size in parentheses)
 *   Coke — 1 case (24 pack)                (a pack size stays in parentheses)
 *   Ice — 12 x 16 lb bags (estimated for mixing only)   (a lower case note in parentheses)
 *   Limes — 24 count                       (nothing empty is shown)
 */
export function lineText(f: { name: string; quantity: string; size: string; detail: string }, section?: SectionId): string {
  const name = f.name.trim();
  const detail = f.detail.trim();
  const amount = amountText(f, section);
  let text = amount ? `${name} — ${amount}` : name;
  if (detail) text += /^[a-z(]/.test(detail) ? ` ${detail.startsWith("(") ? detail : `(${detail})`}` : ` — ${detail}`;
  return text;
}

/** One key per drink name ("paloma", "paloma#2"), stable while the drink stays on the menu. For recipe edits. */
export function recipeKeys(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "drink";
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k === 1 ? base : `${base}#${k}`;
  });
}

/** Shown whenever an admin edits a recipe on the Shopping list. */
export const RECIPE_EDIT_NOTE = "This does not change quantities. Update the list lines too if needed.";
