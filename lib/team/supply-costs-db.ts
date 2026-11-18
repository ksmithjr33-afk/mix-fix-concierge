// Supply costs from the database: the cost catalog and each event's estimate.
// Server only. Admins only (role admin, never managers): every function checks
// isFullAdmin first, so no manager, staff, or client page can carry a cost.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { isFullAdmin } from "@/lib/team/roles";
import { staffSheet } from "@/lib/order-sheet-db";
import type { Sheet } from "@/lib/order-sheet";
import { cleanRow, matchLines, previewImport, type BuyLine, type CatalogRow, type ImportPreview, type LineCost } from "@/lib/team/supply-costs";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const ADMINS_ONLY = { ok: false as const, error: "Admins only.", status: 403 };

export interface SupplyCost {
  cents: number;
  byRef: Record<string, LineCost | null>; // each "we buy" line on the Shopping list
  matched: number;
  lines: number; // every "we buy" line, costed or not
  catalogEmpty: boolean;
  unmatched: string[]; // "we buy" lines with no cost yet
}

export async function catalogRows(viewer: StaffMember): Promise<CatalogRow[]> {
  if (!isFullAdmin(viewer.role)) return [];
  const { data, error } = await supabase.from("supply_catalog").select("*").order("product", { ascending: true });
  if (error || !data) return [];
  return (data as CatalogRow[]).map((r) => ({ ...r, brand: r.brand ?? "", size: r.size ?? "", store: r.store ?? "", aliases: r.aliases ?? [] }));
}

/** The "we buy" lines on a Shopping list: not the client's own, not removed. */
export function buyLines(view: { sheet: Sheet }): BuyLine[] {
  return view.sheet.sections.flatMap((s) => s.lines.filter((l) => !l.clientBuys && !l.gone).map((l) => ({ ref: l.ref, name: l.fields.name, quantity: l.fields.quantity })));
}

/**
 * An event's supply cost from its Shopping list (the team order sheet, "we buy"
 * lines only, never the client's alcohol) against the cost catalog. Worked out
 * live, so it follows every Shopping list change. Null for anyone but an admin.
 * With no catalog yet every line is uncosted.
 */
export async function supplyCostFor(viewer: StaffMember, session: SessionRow, sheet?: { sheet: Sheet }, catalog?: CatalogRow[]): Promise<SupplyCost | null> {
  if (!isFullAdmin(viewer.role)) return null;
  const [rows, view] = await Promise.all([catalog ? Promise.resolve(catalog) : catalogRows(viewer), sheet ? Promise.resolve(sheet) : staffSheet(session).catch(() => null)]);
  const lines = view ? buyLines(view) : [];
  const m = matchLines(lines, rows);
  return { cents: m.cents, byRef: m.byRef, matched: Object.values(m.byRef).filter(Boolean).length, lines: lines.length, catalogEmpty: rows.length === 0, unmatched: m.unmatched };
}

const toDb = (v: { product: string; brand: string; size: string; costCents: number; store: string; aliases: string[] }, admin: StaffMember) => ({
  product: v.product,
  brand: v.brand,
  size: v.size,
  cost_cents: v.costCents,
  store: v.store,
  aliases: v.aliases,
  updated_by: admin.id,
  updated_at: new Date().toISOString(),
});

/**
 * The catalog page's actions:
 *   { action: "add", product, brand, size, cost, store, aliases }
 *   { action: "update", id, ...same }
 *   { action: "delete", id }
 *   { action: "preview", csv }  read only: what an import would do
 *   { action: "import", csv }   saves the rows the preview showed as good
 */
export async function catalogAction(admin: StaffMember, body: Record<string, unknown>): Promise<Result<{ preview?: ImportPreview; saved?: number }>> {
  if (!isFullAdmin(admin.role)) return ADMINS_ONLY;
  const action = body.action;
  if (action === "add" || action === "update") {
    const v = cleanRow(body);
    if (!v.ok) return { ok: false, error: v.error, status: 400 };
    if (action === "add") {
      const { error } = await supabase.from("supply_catalog").insert({ ...toDb(v.value, admin), created_by: admin.id });
      return error ? { ok: false, error: "Could not save. Try again.", status: 500 } : { ok: true };
    }
    if (typeof body.id !== "string") return { ok: false, error: "Bad request", status: 400 };
    const { data, error } = await supabase.from("supply_catalog").update(toDb(v.value, admin)).eq("id", body.id).select("id");
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    return data && data.length ? { ok: true } : { ok: false, error: "That row is gone. Reload the page.", status: 404 };
  }
  if (action === "delete") {
    if (typeof body.id !== "string") return { ok: false, error: "Bad request", status: 400 };
    const { error } = await supabase.from("supply_catalog").delete().eq("id", body.id);
    return error ? { ok: false, error: "Could not delete. Try again.", status: 500 } : { ok: true };
  }
  if (action === "preview" || action === "import") {
    const csv = String(body.csv ?? "");
    if (!csv.trim()) return { ok: false, error: "Choose a CSV file.", status: 400 };
    if (csv.length > 2_000_000) return { ok: false, error: "That file is too big. Keep it under 2 MB.", status: 400 };
    const preview = previewImport(csv, await catalogRows(admin));
    if (action === "preview") return { ok: true, preview };
    if (preview.missing.length) return { ok: false, error: `The file needs a ${preview.missing.join(" and a ")} column.`, status: 400 };
    let saved = 0;
    for (const r of preview.rows) {
      if (r.error || r.costCents === null) continue;
      const row = toDb({ product: r.product, brand: r.brand, size: r.size, costCents: r.costCents, store: r.store, aliases: r.aliases }, admin);
      const { error } = r.existingId
        ? await supabase.from("supply_catalog").update(row).eq("id", r.existingId)
        : await supabase.from("supply_catalog").insert({ ...row, created_by: admin.id });
      if (!error) saved++;
    }
    return { ok: true, saved, preview };
  }
  return { ok: false, error: "Bad request", status: 400 };
}
