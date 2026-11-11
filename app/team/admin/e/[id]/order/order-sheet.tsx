"use client";

import { useRef, useState } from "react";
import { SECTIONS, STORES, STORE_INFO, type SectionId, type Store } from "@/lib/order-sheet-shared";
import type { FieldName, Fields, SheetLine } from "@/lib/order-sheet";
import type { SheetView } from "@/lib/order-sheet-db";
import { timeLabel } from "@/lib/team/clock-label";

// The order sheet, laid out like Isabel's Word order sheets: bold header,
// sections, store legend, cocktail recipes. Every line edits in place, picks a
// store (saved as soon as it changes), and checks off as ordered. "By store"
// shows the same lines grouped by store. Print shows the Sheet view only.

type Call = (body: Record<string, unknown>) => Promise<boolean>;

const exact = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as const;

function Swatch({ store, className = "" }: { store: Store; className?: string }) {
  return <span className={`print-exact inline-block w-5 h-4 rounded-sm border border-black/20 align-middle ${className}`} style={{ background: STORE_INFO[store].color, ...exact }} />;
}

/** A field that reads as text and edits in place, like typing in a doc. Saves on blur or Enter. */
function InlineField({
  value,
  placeholder,
  label,
  onSave,
  className = "",
  autoFocus = false,
}: {
  value: string;
  placeholder: string;
  label: string;
  onSave: (v: string) => void;
  className?: string;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState(value);
  // A new saved value from the server replaces what is in the box.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setV(value);
  }
  return (
    <input
      aria-label={label}
      value={v}
      placeholder={placeholder}
      autoFocus={autoFocus}
      size={Math.max(placeholder.length, v.length, 2)}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== value && onSave(v.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`max-w-full bg-transparent border-0 border-b border-dashed border-transparent hover:border-[#B5A48F] focus:border-[#B5845A] focus:outline-none px-0.5 !text-[17px] text-[#1F1A17] placeholder:text-[#A39585] ${className}`}
    />
  );
}

function StoreSelect({ value, onChange, label }: { value: Store | null; onChange: (s: Store | null) => void; label: string }) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as Store | null)}
      className="rounded-lg border border-[#CFC3B6] bg-white px-2 py-1 !text-[15px] text-[#2C2420]"
    >
      <option value="">No store</option>
      {STORES.map((s) => (
        <option key={s} value={s}>
          {STORE_INFO[s].label}
        </option>
      ))}
    </select>
  );
}

function fieldsText(f: Fields): string {
  return `${f.name} — ${f.quantity}${f.size ? ` (${f.size})` : ""}${f.detail ? ` — ${f.detail}` : ""}`;
}

function Line({ line, call, tz, onCopied, sectionLabel }: { line: SheetLine; call: Call; tz: string; onCopied: (name: string) => void; sectionLabel?: string }) {
  const [editingName, setEditingName] = useState(false);
  const save = (field: FieldName) => (value: string) => call({ action: "edit", ref: line.ref, field, value });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line.fields.name);
    } catch {
      const t = document.createElement("textarea");
      t.value = line.fields.name;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    onCopied(line.fields.name);
  };
  const meta = [
    line.edited.length > 0 && line.editedBy ? `Edited by ${line.editedBy} ${timeLabel(line.editedAt, undefined, tz)}` : "",
    line.kind === "added" && line.editedBy ? `Added by ${line.editedBy} ${timeLabel(line.editedAt, undefined, tz)}` : "",
    line.store && line.storeBy ? `${STORE_INFO[line.store].label} set by ${line.storeBy} ${timeLabel(line.storeAt, undefined, tz)}` : "",
    line.ordered && line.orderedBy ? `Ordered by ${line.orderedBy} ${timeLabel(line.orderedAt, undefined, tz)}` : "",
  ].filter(Boolean);

  return (
    <li data-ref={line.ref} data-store={line.store ?? ""} className="print-exact rounded-lg px-2 py-2 -mx-2" style={{ background: line.highlight ?? undefined, ...exact }}>
      <div className="flex items-start gap-2.5">
        {line.clientBuys ? (
          <span className="mt-1.5 w-5 shrink-0 text-center text-[#A39585]" title="The client buys this">•</span>
        ) : (
          <input
            type="checkbox"
            aria-label={`Ordered ${line.fields.name}`}
            checked={line.ordered}
            onChange={(e) => call({ action: "ordered", ref: line.ref, on: e.target.checked })}
            className="mt-1.5 h-5 w-5 shrink-0 accent-[#55684A]"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className={`flex flex-wrap items-baseline gap-x-1 leading-relaxed text-[17px] ${line.ordered ? "text-[#55684A]" : "text-[#1F1A17]"}`}>
            {editingName ? (
              <InlineField value={line.fields.name} placeholder="Item" label="Item name" autoFocus onSave={(v) => { setEditingName(false); if (v) save("name")(v); }} className="font-medium" />
            ) : (
              <button type="button" onClick={copy} title="Copy the item name" className="font-medium text-left underline decoration-dotted decoration-[#B5A48F] underline-offset-4 hover:decoration-[#B5845A]">
                {line.fields.name}
              </button>
            )}
            <span aria-hidden>—</span>
            <InlineField value={line.fields.quantity} placeholder="quantity" label={`Quantity for ${line.fields.name}`} onSave={save("quantity")} />
            <span className="text-[#6B5D52]">(</span>
            <InlineField value={line.fields.size} placeholder="size" label={`Size for ${line.fields.name}`} onSave={save("size")} />
            <span className="text-[#6B5D52]">)</span>
            <span aria-hidden className="text-[#6B5D52]">—</span>
            <InlineField value={line.fields.detail} placeholder="brand or note" label={`Brand or note for ${line.fields.name}`} onSave={save("detail")} className="text-[#4A3F38]" />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1">
            <StoreSelect value={line.store} label={`Store for ${line.fields.name}`} onChange={(s) => call({ action: "store", ref: line.ref, store: s })} />
            {line.suggestion && (
              <button
                type="button"
                onClick={() => call({ action: "store", ref: line.ref, store: line.suggestion })}
                className="rounded-lg border border-dashed border-[#9A8670] bg-white/70 px-2 py-0.5 text-sm text-[#4A3F38]"
                title="The store this item was last given on another event. Tap to use it."
              >
                Suggestion: {STORE_INFO[line.suggestion].label}, tap to use
              </button>
            )}
            {sectionLabel && <span className="text-xs text-[#6B5D52] uppercase tracking-wide">{sectionLabel}</span>}
            {line.clientBuys && <span className="text-xs rounded-full bg-white/80 border border-[#DDD5CC] px-2 py-0.5 text-[#6B5D52]">client buys</span>}
            {line.edited.length > 0 && <span className="text-xs rounded-full bg-[#2C2420] text-white px-2 py-0.5">edited</span>}
            {line.kind === "added" && <span className="text-xs rounded-full bg-[#2C2420] text-white px-2 py-0.5">added</span>}
            <button type="button" onClick={() => setEditingName(true)} className="text-sm text-[#9A7049] underline">
              Edit name
            </button>
            {line.edited.length > 0 && (
              <button type="button" onClick={() => call({ action: "reset", ref: line.ref })} className="text-sm text-[#9A7049] underline">
                Reset to calculated
              </button>
            )}
            <button type="button" onClick={() => call({ action: "remove", ref: line.ref })} className="text-sm text-[#A0412D] underline">
              Remove
            </button>
          </div>

          {line.conflict && (
            <div className="mt-2 rounded-lg border-2 border-[#C9772E] bg-white px-3 py-2 text-[15px] space-y-1.5">
              <p className="font-medium text-[#8A4B12]">The calculated value changed after this line was edited.</p>
              <p>
                <span className="text-[#6B5D52]">Yours:</span> {fieldsText(line.conflict.mine)}
              </p>
              <p>
                <span className="text-[#6B5D52]">New calculated:</span> {fieldsText(line.conflict.calc)}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => call({ action: "keep", ref: line.ref })} className="rounded-lg bg-[#2C2420] text-white px-3 py-1 text-sm">
                  Keep mine
                </button>
                <button type="button" onClick={() => call({ action: "use_new", ref: line.ref })} className="rounded-lg border-2 border-[#2C2420] px-3 py-1 text-sm">
                  Use new
                </button>
              </div>
            </div>
          )}
          {line.gone && (
            <div className="mt-2 rounded-lg border-2 border-[#C9772E] bg-white px-3 py-2 text-[15px] space-y-1.5">
              <p className="font-medium text-[#8A4B12]">An update took this item off the calculated list.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => call({ action: "keep", ref: line.ref })} className="rounded-lg bg-[#2C2420] text-white px-3 py-1 text-sm">
                  Keep mine
                </button>
                <button type="button" onClick={() => call({ action: "use_new", ref: line.ref })} className="rounded-lg border-2 border-[#2C2420] px-3 py-1 text-sm">
                  Use new (remove it)
                </button>
              </div>
            </div>
          )}
          {meta.length > 0 && <p className="text-xs text-[#6B5D52] mt-1">{meta.join(" · ")}</p>}
        </div>
      </div>
    </li>
  );
}

function AddLine({ section, call }: { section: SectionId; call: Call }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", quantity: "", size: "", detail: "" });
  const input = "rounded-lg border border-[#CFC3B6] bg-white px-2 py-1.5 !text-[16px] min-w-0";
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-[#9A7049] underline mt-1">
        + Add a line
      </button>
    );
  }
  return (
    <form
      className="mt-2 grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto] gap-2 items-center"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.name.trim()) return;
        if (await call({ action: "add", section, ...f })) {
          setF({ name: "", quantity: "", size: "", detail: "" });
          setOpen(false);
        }
      }}
    >
      <input aria-label="New item" placeholder="Item" className={`${input} col-span-2 sm:col-span-1`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
      <input aria-label="New quantity" placeholder="Quantity" className={input} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
      <input aria-label="New size" placeholder="Size" className={input} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} />
      <input aria-label="New brand or note" placeholder="Brand or note" className={`${input} col-span-2 sm:col-span-1`} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} />
      <div className="flex gap-2 col-span-2 sm:col-span-1">
        <button type="submit" className="rounded-lg bg-[#B5845A] text-white px-3 py-1.5 text-sm">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-[#6B5D52] underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Legend({ view, call }: { view: SheetView; call: Call }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[16px] text-[#2C2420]">
      {view.sheet.legend.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <Swatch store={s} /> {STORE_INFO[s].label}
        </span>
      ))}
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={view.meta.deliveryDayOf} onChange={(e) => call({ action: "delivery", on: e.target.checked })} className="h-4 w-4 accent-[#B5845A] print:hidden" />
        <span className="hidden print:inline">{view.meta.deliveryDayOf ? "☑" : "☐"}</span>
        Delivery to event on day of
      </label>
    </div>
  );
}

function Recipes({ view }: { view: SheetView }) {
  if (view.recipes.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="font-bold text-[18px] tracking-wide text-[#1F1A17]">COCKTAIL RECIPES</h2>
      {view.recipes.map((r, i) => (
        <div key={`${r.name}-${i}`} className="text-[17px] text-[#1F1A17]">
          <p className="font-bold">
            <span className="print-exact px-1 rounded-sm" style={{ background: "#BFEBB4", ...exact }}>
              {r.name}
              {r.mocktail ? " (Mocktail)" : ""}
            </span>{" "}
            - {r.cup} cup
          </p>
          <ul className="list-disc pl-6 mt-1">
            {r.ingredients.map((x, j) => (
              <li key={j}>{x}</li>
            ))}
          </ul>
          {r.garnish && (
            <p className="mt-0.5">
              <span className="font-bold">Garnish:</span> {r.garnish}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

function Header({ view }: { view: SheetView }) {
  // "11/14/26 (Dive Bar) 75 guests, 5 hours": the package in its own color, like the samples.
  const m = view.header.line.match(/^(.*?) (\([^)]*\)) (.*)$/);
  return (
    <div className="space-y-0.5">
      <p className="font-bold text-[20px] text-[#1D3FBF]">
        {m ? (
          <>
            {m[1]} <span className="text-[#C026D3]">{m[2]}</span> {m[3]}
          </>
        ) : (
          view.header.line
        )}
      </p>
      {view.header.theme && (
        <p className="text-[17px]">
          <span className="font-bold">Theme:</span> <span className="text-[#1D3FBF]">{view.header.theme}</span>
        </p>
      )}
      {view.header.colors && (
        <p className="text-[17px]">
          <span className="font-bold">Colors:</span> <span className="text-[#1D3FBF]">{view.header.colors}</span>
        </p>
      )}
    </div>
  );
}

/** The Sheet view as plain text with highlights, for printing. */
function PrintSheet({ view }: { view: SheetView }) {
  return (
    <div className="hidden print:block space-y-4 text-black">
      <Header view={view} />
      {view.sheet.sections.map((s) => (
        <section key={s.id}>
          <h2 className="font-bold text-[16px]">{s.title}</h2>
          <ul className="list-disc pl-6 text-[14px] leading-snug">
            {s.lines.map((l) => (
              <li key={l.ref}>
                <span className="print-exact px-0.5" style={{ background: l.highlight ?? undefined, ...exact }}>
                  {l.text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Legend view={view} call={async () => false} />
      {view.meta.note && <p className="text-[14px] whitespace-pre-wrap">Note: {view.meta.note}</p>}
      <Recipes view={view} />
    </div>
  );
}

export default function OrderSheet({ initial, title, timeZone }: { initial: SheetView; title: string; timeZone: string }) {
  const [view, setView] = useState(initial);
  const [mode, setMode] = useState<"sheet" | "store">("sheet");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(0);
  const [note, setNote] = useState(initial.meta.note);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const call: Call = async (body) => {
    setSaving((n) => n + 1);
    setError("");
    try {
      const res = await fetch("/api/team/admin/order-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: view.sessionId, ...body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setView(d.view);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      return false;
    } finally {
      setSaving((n) => n - 1);
    }
  };

  const copied = (name: string) => {
    setToast(`Copied “${name}”. Paste it into the store search.`);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  };

  const { progress, counts } = view.sheet;
  const pct = progress.total ? Math.round((progress.ordered / progress.total) * 100) : 0;
  const sectionTitle = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.title ?? "";

  return (
    <>
      <PrintSheet view={view} />
      <main className="print:hidden max-w-3xl mx-auto px-4 py-4 sm:py-6 space-y-5">
        <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-[#E8DDD5]/95 backdrop-blur border-b border-[#DDD5CC] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="font-heading text-xl font-bold text-[#2C2420] break-words">Order sheet · {title}</h1>
            <div className="flex items-center gap-2">
              <div role="tablist" aria-label="View" className="inline-flex rounded-lg border border-[#B5845A] overflow-hidden">
                {(["sheet", "store"] as const).map((m) => (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={mode === m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 text-sm font-medium ${mode === m ? "bg-[#B5845A] text-white" : "text-[#9A7049] bg-white"}`}
                  >
                    {m === "sheet" ? "Sheet" : "By store"}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => window.print()} className="rounded-lg bg-[#2C2420] text-white px-3 py-1.5 text-sm font-medium">
                Print or save as PDF
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
            <span className="font-medium text-[#2C2420]">
              {progress.total === 0 ? "The client buys everything on this list" : `${progress.ordered} of ${progress.total} ordered`}
            </span>
            {progress.total > 0 && (
              <span className="h-2 w-32 rounded-full bg-white overflow-hidden" aria-hidden>
                <span className="block h-full bg-[#55684A]" style={{ width: `${pct}%` }} />
              </span>
            )}
            <span className="text-[#4A3F38]">
              {counts.map((c, i) => (
                <span key={c.label}>
                  {i > 0 && " · "}
                  {c.store && <Swatch store={c.store} className="mr-1 !w-3 !h-3" />}
                  {c.label} {c.count}
                </span>
              ))}
            </span>
            {saving > 0 && <span className="text-sm text-[#A39585]">Saving...</span>}
          </div>
          {error && <p className="text-sm text-[#A0412D]">{error}</p>}
        </div>

        {mode === "sheet" ? (
          <article className="bg-white rounded-2xl border border-[#DDD5CC] px-4 py-5 sm:px-7 sm:py-6 space-y-6">
            <Header view={view} />
            {view.sheet.sections.map((s) => {
              const removed = view.sheet.removed.filter((l) => l.section === s.id);
              return (
                <section key={s.id} aria-labelledby={`sec-${s.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <h2 id={`sec-${s.id}`} className="font-bold text-[18px] tracking-wide text-[#1F1A17]">
                      {s.title}
                    </h2>
                    {s.lines.length > 0 && (
                      <label className="text-sm text-[#6B5D52] inline-flex items-center gap-2">
                        Set all in this section to
                        <select
                          aria-label={`Set all in ${s.title} to`}
                          value=""
                          onChange={(e) => e.target.value && call({ action: "section_store", section: s.id, store: e.target.value === "none" ? null : e.target.value })}
                          className="rounded-lg border border-[#CFC3B6] bg-white px-2 py-1 !text-[15px]"
                        >
                          <option value="">Pick a store</option>
                          {STORES.map((st) => (
                            <option key={st} value={st}>
                              {STORE_INFO[st].label}
                            </option>
                          ))}
                          <option value="none">No store</option>
                        </select>
                      </label>
                    )}
                  </div>
                  {s.lines.length === 0 ? (
                    <p className="text-[15px] text-[#A39585]">Nothing in this section.</p>
                  ) : (
                    <ul className="space-y-1">
                      {s.lines.map((l) => (
                        <Line key={l.ref} line={l} call={call} tz={timeZone} onCopied={copied} />
                      ))}
                    </ul>
                  )}
                  <AddLine section={s.id} call={call} />
                  {removed.length > 0 && (
                    <details className="mt-1 text-sm text-[#6B5D52]">
                      <summary className="cursor-pointer">Removed lines ({removed.length})</summary>
                      <ul className="mt-1 space-y-1">
                        {removed.map((l) => (
                          <li key={l.ref} className="flex flex-wrap items-center gap-2">
                            <span className="line-through">{l.text}</span>
                            <button type="button" onClick={() => call({ action: "restore", ref: l.ref })} className="underline text-[#9A7049]">
                              Put back
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              );
            })}
            <Legend view={view} call={call} />
            <Recipes view={view} />
          </article>
        ) : (
          <article className="bg-white rounded-2xl border border-[#DDD5CC] px-4 py-5 sm:px-7 sm:py-6 space-y-6">
            <Header view={view} />
            {view.byStore.map((g) => (
              <section key={g.title}>
                <h2 className="font-bold text-[18px] tracking-wide text-[#1F1A17] mb-1 flex items-center gap-2">
                  {g.store && <Swatch store={g.store} />}
                  {g.title.toUpperCase()} <span className="font-normal text-[15px] text-[#6B5D52]">({g.lines.length})</span>
                </h2>
                {g.lines.length === 0 ? (
                  <p className="text-[15px] text-[#A39585]">Every line has a store.</p>
                ) : (
                  <ul className="space-y-1">
                    {g.lines.map((l) => (
                      <Line key={l.ref} line={l} call={call} tz={timeZone} onCopied={copied} sectionLabel={sectionTitle(l.section)} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
            <Legend view={view} call={call} />
          </article>
        )}

        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 space-y-2">
          <label htmlFor="sheet-note" className="block font-heading font-bold text-[#2C2420]">
            Note
          </label>
          <textarea
            id="sheet-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note.trim() !== view.meta.note && call({ action: "note", note })}
            placeholder="Anything Natalie should know when ordering"
            className="w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 !text-[17px] text-[#2C2420]"
          />
          {view.meta.noteBy && (
            <p className="text-xs text-[#6B5D52]">
              Last edited by {view.meta.noteBy} {timeLabel(view.meta.noteAt, undefined, timeZone)}
            </p>
          )}
        </section>
        <p className="text-xs text-[#A39585] px-1">
          Edits here only change this order sheet. They never change the client&apos;s shopping list, the calculation, or any other event.
          {view.suggestions ? " Suggested stores come from the last store each item was given on another event." : ""}
        </p>

        {toast && (
          <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-[#2C2420] text-white px-4 py-2 text-sm shadow-lg">
            {toast}
          </div>
        )}
      </main>
    </>
  );
}
