"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/team/pay";
import type { CatalogRow, ImportPreview } from "@/lib/team/supply-costs";

// The cost catalog: rows an admin adds and edits, and a forgiving CSV import
// that shows a preview before anything is saved.
const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";
const input = "w-full rounded-lg border border-[#DDD5CC] px-3 py-2 text-[16px]";
const btn = "rounded-lg bg-[#B5845A] text-white px-3 py-2 text-sm font-medium disabled:opacity-50";
const quiet = "rounded-lg border border-[#DDD5CC] px-3 py-2 text-sm disabled:opacity-50";

type Form = { product: string; brand: string; size: string; cost: string; store: string; aliases: string };
const blank: Form = { product: "", brand: "", size: "", cost: "", store: "", aliases: "" };
const toForm = (r: CatalogRow): Form => ({ product: r.product, brand: r.brand, size: r.size, cost: (r.cost_cents / 100).toFixed(2), store: r.store, aliases: r.aliases.join("; ") });

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; preview?: ImportPreview | null; saved?: number | null }> {
  const res = await fetch("/api/team/admin/business/supplies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string; preview?: ImportPreview | null; saved?: number | null };
  return res?.ok ? { ok: true, ...data } : { ok: false, error: data.error ?? "Could not save. Try again." };
}

export default function CatalogManager({ initial }: { initial: CatalogRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null); // a row id, or "new"
  const [form, setForm] = useState<Form>(blank);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const rows = initial.filter((r) => !filter.trim() || `${r.product} ${r.brand} ${r.store} ${r.aliases.join(" ")}`.toLowerCase().includes(filter.trim().toLowerCase()));

  const save = async () => {
    setBusy(true);
    setError("");
    const r = await post({ action: editing === "new" ? "add" : "update", id: editing, ...form });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "");
    setEditing(null);
    setForm(blank);
    router.refresh();
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this row from the catalog?")) return;
    setBusy(true);
    const r = await post({ action: "delete", id });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "");
    router.refresh();
  };
  const field = (k: keyof Form, label: string, hint?: string) => (
    <label className="text-sm text-[#2C2420]">
      {label}
      <input className={input} value={form[k]} inputMode={k === "cost" ? "decimal" : undefined} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      {hint && <span className="text-xs text-[#6B5D52]">{hint}</span>}
    </label>
  );
  const editor = (
    <div className="rounded-xl bg-[#FAF6F1] p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {field("product", "Product")}
        {field("brand", "Brand")}
        {field("size", "Size")}
        {field("cost", "Cost ($)")}
        {field("store", "Store")}
        {field("aliases", "Aliases", "Other names on the Shopping list, split with ;")}
      </div>
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={busy} onClick={save}>
          Save
        </button>
        <button type="button" className={quiet} disabled={busy} onClick={() => (setEditing(null), setForm(blank), setError(""))}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <>
      <Importer />
      <section className={card} aria-label="Catalog">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="font-heading text-base font-bold text-[#2C2420]">Catalog ({initial.length})</h2>
          <button type="button" className={btn} onClick={() => (setEditing("new"), setForm(blank), setError(""))}>
            Add a product
          </button>
        </div>
        {editing === "new" && editor}
        <input className={`${input} mt-2`} placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search the catalog" />
        {rows.length === 0 ? (
          <p className="text-[15px] text-[#6B5D52] py-3">{initial.length ? "Nothing matches." : "No products yet. Add one or import a CSV."}</p>
        ) : (
          <ul className="divide-y divide-[#EFE8E0] mt-1">
            {rows.map((r) => (
              <li key={r.id} className="py-2">
                {editing === r.id ? (
                  editor
                ) : (
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[15px] text-[#2C2420]">
                      <span className="font-medium">{r.product}</span>
                      {[r.brand, r.size, r.store].filter(Boolean).length > 0 && <span className="text-sm text-[#6B5D52]"> · {[r.brand, r.size, r.store].filter(Boolean).join(" · ")}</span>}
                      {r.aliases.length > 0 && <span className="block text-xs text-[#6B5D52]">Also: {r.aliases.join(", ")}</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums font-medium">{money(r.cost_cents)}</span>
                      <button type="button" className="min-h-[44px] text-sm text-[#B5845A] underline" onClick={() => (setEditing(r.id), setForm(toForm(r)), setError(""))}>
                        Edit
                      </button>
                      <button type="button" className="min-h-[44px] text-sm text-[#A0412D] underline" disabled={busy} onClick={() => remove(r.id)}>
                        Delete
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Importer() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    setPreview(null);
    setMsg(null);
    if (!f) return;
    const text = await f.text();
    setCsv(text);
    setName(f.name);
    setBusy(true);
    const r = await post({ action: "preview", csv: text });
    setBusy(false);
    if (!r.ok) return setMsg({ text: r.error ?? "", error: true });
    setPreview(r.preview ?? null);
  };
  const run = async () => {
    setBusy(true);
    const r = await post({ action: "import", csv });
    setBusy(false);
    if (!r.ok) return setMsg({ text: r.error ?? "", error: true });
    setMsg({ text: `Saved ${r.saved ?? 0} rows.`, error: false });
    setPreview(null);
    setCsv("");
    router.refresh();
  };
  return (
    <section className={card} aria-label="Import a CSV">
      <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Import a CSV</h2>
      <p className="text-sm text-[#6B5D52]">Columns in any order: product, brand, size, cost, store, and optionally aliases. Header names like Item, Price, or Vendor work too. A Google Sheet exported as CSV is fine. You see a preview before anything is saved; a row with the same product, brand and size updates it.</p>
      <input type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" className="mt-2 block text-sm" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose a CSV file" />
      {busy && <p className="text-sm text-[#6B5D52] mt-1">Reading…</p>}
      {msg && <p className={`text-sm mt-1 ${msg.error ? "text-[#A0412D]" : "text-[#55684A]"}`}>{msg.text}</p>}
      {preview && (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-[#2C2420]">
            {name}: {Object.entries(preview.columns).map(([f, h]) => `${h || "?"} → ${f}`).join(", ") || "no columns recognized"}
          </p>
          {preview.missing.length > 0 ? (
            <p className="text-sm text-[#A0412D]">The file needs a {preview.missing.join(" and a ")} column. Nothing will be saved.</p>
          ) : (
            <>
              <p className="text-sm font-medium">
                {preview.ok} rows ready ({preview.rows.filter((r) => !r.error && r.existingId).length} update existing rows), {preview.skipped} skipped.
              </p>
              <div className="max-h-80 overflow-auto rounded-lg border border-[#EFE8E0]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#FAF6F1] text-left text-[#6B5D52]">
                    <tr>
                      <th className="font-normal px-2 py-1">Line</th>
                      <th className="font-normal px-2">Product</th>
                      <th className="font-normal px-2">Brand</th>
                      <th className="font-normal px-2">Size</th>
                      <th className="font-normal px-2 text-right">Cost</th>
                      <th className="font-normal px-2">Store</th>
                      <th className="font-normal px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.line} className={`border-t border-[#EFE8E0] ${r.error ? "bg-[#FBEFEA]" : ""}`}>
                        <td className="px-2 py-1 tabular-nums">{r.line}</td>
                        <td className="px-2">{r.product}</td>
                        <td className="px-2">{r.brand}</td>
                        <td className="px-2">{r.size}</td>
                        <td className="px-2 text-right tabular-nums">{r.costCents === null ? "" : money(r.costCents)}</td>
                        <td className="px-2">{r.store}</td>
                        <td className="px-2 text-xs">{r.error ? <span className="text-[#A0412D]">{r.error}</span> : r.existingId ? "update" : "new"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button type="button" className={btn} disabled={busy || preview.ok === 0} onClick={run}>
                  Save {preview.ok} rows
                </button>
                <button type="button" className={quiet} disabled={busy} onClick={() => (setPreview(null), setCsv(""))}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
