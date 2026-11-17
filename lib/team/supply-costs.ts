// Supply costs: the cost catalog, the CSV import, and matching catalog rows to
// the "we buy" lines on an event's Shopping list. Pure, no database. Admins
// only (supply-costs-db.ts): never managers, staff, or clients.

import { itemKey } from "@/lib/order-sheet";

export interface CatalogRow {
  id: string;
  product: string;
  brand: string;
  size: string;
  cost_cents: number;
  store: string;
  aliases: string[]; // other names the Shopping list uses for this product
}

export interface CatalogInput {
  product: string;
  brand: string;
  size: string;
  costCents: number;
  store: string;
  aliases: string[];
}

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** "$12.99", "12.99", "1,299.00" as cents. Null when not a price. */
export function priceCents(raw: unknown): number | null {
  const s = String(raw ?? "").trim().replace(/[$,\s]/g, "").replace(/^USD/i, "");
  if (!s || !/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100);
  return c >= 0 && c <= 1_000_000_00 ? c : null;
}

export function splitAliases(raw: unknown): string[] {
  return [...new Set(String(raw ?? "").split(/[;|\n]/).map((a) => clip(a, 80)).filter(Boolean))].slice(0, 20);
}

/** A catalog row typed by an admin, checked. */
export function cleanRow(raw: Record<string, unknown>): { ok: true; value: CatalogInput } | { ok: false; error: string } {
  const product = clip(raw.product, 120);
  if (product.length < 2) return { ok: false, error: "Name the product." };
  const costCents = priceCents(raw.cost);
  if (costCents === null) return { ok: false, error: "Enter the cost in dollars, like 12.99." };
  const aliases = Array.isArray(raw.aliases) ? splitAliases((raw.aliases as unknown[]).join(";")) : splitAliases(raw.aliases);
  return { ok: true, value: { product, brand: clip(raw.brand, 80), size: clip(raw.size, 60), costCents, store: clip(raw.store, 80), aliases } };
}

// ----- CSV import -----

/** One CSV text as rows of cells. Handles quotes, doubled quotes, commas and new lines inside quotes, CRLF, a BOM, and tabs or semicolons as the separator. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", "\t", ";"].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

type Field = "product" | "brand" | "size" | "cost" | "store" | "aliases";

/** Header names people actually use, in any case and with any punctuation. */
const HEADER_WORDS: Record<Field, string[]> = {
  product: ["product", "item", "name", "product name", "item name", "description", "ingredient"],
  brand: ["brand", "brand name", "label", "make", "maker"],
  size: ["size", "volume", "unit", "unit size", "pack size", "package", "pack", "qty per", "amount"],
  cost: ["cost", "price", "unit cost", "unit price", "cost each", "each", "our cost", "cost per unit", "price each", "cost usd", "amount usd", "$"],
  store: ["store", "vendor", "where", "supplier", "shop", "retailer", "source", "where to buy"],
  aliases: ["aliases", "alias", "also called", "other names", "aka", "shopping list name", "list name"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim();

/** Which column holds which field. Unknown columns are ignored. */
export function mapHeaders(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  const cells = header.map(norm);
  // Exact names first, then a header that starts with or contains a known word.
  for (const pass of ["exact", "loose"] as const) {
    for (const f of Object.keys(HEADER_WORDS) as Field[]) {
      if (out[f] !== undefined) continue;
      const i = cells.findIndex((c, idx) => !Object.values(out).includes(idx) && HEADER_WORDS[f].some((w) => (pass === "exact" ? c === w : c.startsWith(`${w} `) || c.endsWith(` ${w}`) || c.includes(` ${w} `))));
      if (i >= 0) out[f] = i;
    }
  }
  return out;
}

export interface PreviewRow {
  line: number; // 1 based, in the file (the header is line 1)
  product: string;
  brand: string;
  size: string;
  costCents: number | null;
  store: string;
  aliases: string[];
  error: string | null; // why this row will be skipped
  existingId: string | null; // a catalog row with the same product, brand and size: it will be updated
}

export interface ImportPreview {
  columns: Partial<Record<Field, string>>; // which header became which field
  missing: Field[]; // product and cost are required
  rows: PreviewRow[];
  ok: number;
  skipped: number;
}

const sameKey = (r: { product: string; brand: string; size: string }) => [r.product, r.brand, r.size].map(itemKey).join("|");

/** Read a CSV for the preview. Nothing is saved until the admin confirms. */
export function previewImport(text: string, existing: CatalogRow[] = []): ImportPreview {
  const rows = parseCsv(text);
  if (rows.length === 0) return { columns: {}, missing: ["product", "cost"], rows: [], ok: 0, skipped: 0 };
  const header = rows[0];
  const map = mapHeaders(header);
  const missing = (["product", "cost"] as Field[]).filter((f) => map[f] === undefined);
  const columns = Object.fromEntries(Object.entries(map).map(([f, i]) => [f, header[i as number]?.trim() ?? ""])) as Partial<Record<Field, string>>;
  if (missing.length) return { columns, missing, rows: [], ok: 0, skipped: rows.length - 1 };
  const byKey = new Map(existing.map((e) => [sameKey(e), e.id]));
  const seen = new Set<string>();
  const out: PreviewRow[] = rows.slice(1).map((r, i) => {
    const get = (f: Field) => (map[f] === undefined ? "" : (r[map[f]!] ?? ""));
    const product = clip(get("product"), 120);
    const costCents = priceCents(get("cost"));
    const row = { line: i + 2, product, brand: clip(get("brand"), 80), size: clip(get("size"), 60), costCents, store: clip(get("store"), 80), aliases: splitAliases(get("aliases")) };
    const key = sameKey(row);
    let error: string | null = null;
    if (product.length < 2) error = "No product name";
    else if (costCents === null) error = `Cost "${clip(get("cost"), 20) || "blank"}" is not a price`;
    else if (seen.has(key)) error = "Repeated row";
    seen.add(key);
    return { ...row, error, existingId: error ? null : (byKey.get(key) ?? null) };
  });
  return { columns, missing, rows: out, ok: out.filter((r) => !r.error).length, skipped: out.filter((r) => r.error).length };
}

// ----- Matching the Shopping list -----

export interface BuyLine {
  ref: string;
  name: string;
  quantity: string; // "5 bottles"
}

export interface LineCost {
  catalogId: string;
  product: string;
  quantity: number;
  unitCents: number;
  cents: number;
}

/** The leading number of a quantity ("5 bottles", "2 to 3 bags" reads 3, "½ case" reads 0.5). Null when there is none. */
export function quantityOf(q: string): number | null {
  const s = q.replace(/½/g, ".5").replace(/¼/g, ".25");
  const range = s.match(/^\s*(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)/i);
  if (range) return Number(range[2]);
  const m = s.match(/^\s*(\d+(?:\.\d+)?|\.\d+)/);
  return m ? Number(m[1]) : null;
}

const singular = (k: string) => k.replace(/\b(\w+?)(ies)\b/g, "$1y").replace(/\b(\w+?[^s])s\b/g, "$1");

/** Every name a catalog row answers to, normalized. */
function keysOf(c: CatalogRow): string[] {
  const names = [c.product, ...c.aliases, c.brand ? `${c.brand} ${c.product}` : ""].filter(Boolean);
  return [...new Set(names.flatMap((n) => [itemKey(n), singular(itemKey(n))]))];
}

/**
 * Match "we buy" lines to the catalog by name and aliases (case, punctuation,
 * and plurals do not matter). The estimate is each matched line's cost times
 * its quantity. Lines with no match, or no number in the quantity, have no cost yet.
 */
export function matchLines(lines: BuyLine[], catalog: CatalogRow[]): { cents: number; byRef: Record<string, LineCost | null>; unmatched: string[] } {
  const index = new Map<string, CatalogRow>();
  for (const c of catalog) for (const k of keysOf(c)) if (!index.has(k)) index.set(k, c);
  const byRef: Record<string, LineCost | null> = {};
  const unmatched: string[] = [];
  let cents = 0;
  for (const l of lines) {
    const key = itemKey(l.name);
    const hit = index.get(key) ?? index.get(singular(key)) ?? null;
    const qty = quantityOf(l.quantity);
    if (!hit || qty === null) {
      byRef[l.ref] = null;
      unmatched.push(l.name);
      continue;
    }
    const c = Math.round(hit.cost_cents * qty);
    byRef[l.ref] = { catalogId: hit.id, product: hit.product, quantity: qty, unitCents: hit.cost_cents, cents: c };
    cents += c;
  }
  return { cents, byRef, unmatched };
}
