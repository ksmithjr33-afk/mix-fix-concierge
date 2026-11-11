"use client";

import { useEffect, useRef, useState } from "react";
import { PALETTE, SECTIONS, lineText, paletteName, textOn, type SectionId, type Store, type StoreInfo } from "@/lib/order-sheet-shared";
import type { FieldName, Fields, SheetLine } from "@/lib/order-sheet";
import type { SheetView } from "@/lib/order-sheet-db";
import { timeLabel } from "@/lib/team/clock-label";

// The order sheet as Isabel's Word docs read: a plain white page, Arial, a
// bulleted list under each heading, one line per item, store highlights, the
// legend, then the cocktail recipes. Nothing on a line at rest but its text,
// the Ordered box where the bullet is, and a store swatch at the end. Tapping
// the text opens a small editor; tapping the swatch opens the store list.
// The progress, the Sheet and By store toggle, and Print stay in a slim bar
// above the page. Print shows the Sheet page only.

type Call = (body: Record<string, unknown>) => Promise<boolean>;

const exact = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as const;
const BLUE = "#0000FF";
const RECIPE_GREEN = "#00FF00";

type Open =
  | { kind: "edit"; ref: string }
  | { kind: "store"; ref: string }
  | { kind: "section"; section: SectionId }
  | { kind: "legend"; store: Store }
  | null;

type AddFor = { ref?: string; section?: SectionId } | null;

/** Closes a popover when the pointer goes down anywhere outside it. */
function useClickAway(ref: React.RefObject<HTMLElement | null>, onAway: () => void) {
  const away = useRef(onAway);
  useEffect(() => {
    away.current = onAway;
  });
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) away.current();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [ref]);
}

function storeOf(stores: StoreInfo[], id: Store | null): StoreInfo | undefined {
  return id ? stores.find((s) => s.id === id) : undefined;
}

/** A filled box, like the highlighted "[   ]" in the samples' legend. */
function Box({ color, className = "" }: { color: string; className?: string }) {
  return <span aria-hidden className={`print-exact inline-block align-[-0.15em] w-[1.9em] h-[1em] ${className}`} style={{ background: color, ...exact }} />;
}

// ----- Store list -----

function StoreMenu({
  stores,
  current,
  suggestion,
  onPick,
  onAdd,
  onClose,
  allowNone = true,
  className = "",
}: {
  stores: StoreInfo[];
  current: Store | null;
  suggestion?: Store | null;
  onPick: (s: Store | null) => void;
  onAdd: () => void;
  onClose: () => void;
  allowNone?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useClickAway(root, onClose);
  // Retired stores are not offered, except on a line that already has one.
  const shown = stores.filter((s) => !s.retired || s.id === current);
  const sug = storeOf(stores, suggestion ?? null);
  return (
    <div
      ref={root}
      role="menu"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className={`absolute z-40 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-[#C9C9C9] bg-white py-1 text-[15px] text-black shadow-lg print:hidden ${className}`}
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      {sug && (
        <button type="button" role="menuitem" onClick={() => onPick(sug.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#F2F2F2]">
          <Box color={sug.color} className="!w-5 rounded-sm border border-black/20" />
          <span className="min-w-0 flex-1">
            {sug.name} <span className="text-xs text-[#666]">suggested, used last time</span>
          </span>
        </button>
      )}
      {sug && <hr className="my-1 border-[#E5E5E5]" />}
      {shown.map((s) => (
        <button key={s.id} type="button" role="menuitemradio" aria-checked={current === s.id} onClick={() => onPick(s.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#F2F2F2]">
          <Box color={s.color} className="!w-5 rounded-sm border border-black/20" />
          <span className="min-w-0 flex-1">
            {s.name}
            {s.retired ? <span className="text-xs text-[#666]"> (retired)</span> : null}
          </span>
          {current === s.id && <span aria-hidden>✓</span>}
        </button>
      ))}
      {allowNone && (
        <button type="button" role="menuitemradio" aria-checked={current === null} onClick={() => onPick(null)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#F2F2F2]">
          <span aria-hidden className="inline-block w-5 h-[1em] rounded-sm border border-dashed border-[#999]" />
          <span className="flex-1">No store</span>
          {current === null && <span aria-hidden>✓</span>}
        </button>
      )}
      <hr className="my-1 border-[#E5E5E5]" />
      <button type="button" role="menuitem" onClick={onAdd} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#1F4FE0] hover:bg-[#F2F2F2]">
        <span aria-hidden className="inline-block w-5 text-center">+</span> Add a store
      </button>
      <a href="/team/admin/stores" className="block px-3 py-1.5 text-xs text-[#666] underline">
        Manage stores
      </a>
    </div>
  );
}

/** "Add a store": a name and a highlight color nobody else uses. The store is then on every event. */
export function AddStoreDialog({
  stores,
  onSave,
  onClose,
}: {
  stores: StoreInfo[];
  onSave: (name: string, color: string) => Promise<string | null>; // an error message, or null when saved
  onClose: () => void;
}) {
  const used = new Set(stores.map((s) => s.color));
  const free = PALETTE.filter((p) => !used.has(p.color));
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(free[0]?.color ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 print:hidden" onClick={onClose}>
      <form
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white p-4 space-y-3 text-black"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Give the store a name.");
          if (!color) return setError("Every color is in use. Retire a store or recolor one first.");
          setBusy(true);
          const err = await onSave(name.trim(), color);
          setBusy(false);
          if (err) setError(err);
        }}
      >
        <h3 className="text-[17px] font-bold">Add a store</h3>
        <label className="block text-sm">
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Costco pickup" className="mt-1 block w-full rounded-lg border border-[#BBB] px-3 py-2" />
        </label>
        <fieldset>
          <legend className="text-sm mb-1">Highlight color</legend>
          {free.length === 0 ? (
            <p className="text-sm text-[#A0412D]">Every color is in use. Retire a store or recolor one first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {free.map((p) => (
                <button
                  key={p.color}
                  type="button"
                  aria-label={p.name}
                  aria-pressed={color === p.color}
                  onClick={() => setColor(p.color)}
                  className={`h-10 w-10 rounded-lg border-2 ${color === p.color ? "border-black ring-2 ring-black/30" : "border-black/15"}`}
                  style={{ background: p.color }}
                />
              ))}
            </div>
          )}
          {color && (
            <p className="mt-2 text-sm">
              Looks like:{" "}
              <span className="px-1 font-bold" style={{ background: color, color: textOn(color) }}>
                {name.trim() || "Lime juice — 4 x 32 oz bottles"}
              </span>{" "}
              <span className="text-xs text-[#666]">({paletteName(color)})</span>
            </p>
          )}
        </fieldset>
        {error && <p className="text-sm text-[#A0412D]">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy} className="rounded-lg bg-black text-white px-4 py-2 text-sm font-bold disabled:opacity-40">
            {busy ? "Adding..." : "Add store"}
          </button>
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm underline">
            Cancel
          </button>
        </div>
        <p className="text-xs text-[#666]">The new store is offered on every event's shopping list. Rename, recolor, or retire it under Manage stores.</p>
      </form>
    </div>
  );
}

// ----- One line -----

const fieldsText = (f: Fields, section: SectionId) => lineText(f, section);

function LineEditor({
  line,
  stores,
  call,
  tz,
  onClose,
  onAddStore,
  onCopied,
}: {
  line: SheetLine;
  stores: StoreInfo[];
  call: Call;
  tz: string;
  onClose: () => void;
  onAddStore: () => void;
  onCopied: (name: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [f, setF] = useState<Fields>(line.fields);
  const closed = useRef(false);

  // Clicking away or pressing Enter saves what changed and closes.
  const commit = async () => {
    if (closed.current) return;
    closed.current = true;
    onClose();
    for (const k of ["name", "quantity", "size", "detail"] as FieldName[]) {
      const v = f[k].replace(/\s+/g, " ").trim();
      if (v === line.fields[k]) continue;
      if (k === "name" && !v) continue;
      await call({ action: "edit", ref: line.ref, field: k, value: v });
    }
  };
  const cancel = () => {
    closed.current = true;
    onClose();
  };
  useClickAway(root, commit);

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

  const shown = stores.filter((s) => !s.retired || s.id === line.store);
  const store = storeOf(stores, line.store);
  const sug = storeOf(stores, line.suggestion);
  const meta = [
    line.kind === "added" && line.editedBy ? `Added by ${line.editedBy} ${timeLabel(line.editedAt, undefined, tz)}` : "",
    line.kind !== "added" && line.edited.length > 0 && line.editedBy ? `Edited by ${line.editedBy} ${timeLabel(line.editedAt, undefined, tz)}` : "",
    store && line.storeBy ? `${store.name} set by ${line.storeBy} ${timeLabel(line.storeAt, undefined, tz)}` : "",
    line.ordered && line.orderedBy ? `Ordered by ${line.orderedBy} ${timeLabel(line.orderedAt, undefined, tz)}` : "",
    line.clientBuys ? "On the Client's list" : "",
  ].filter(Boolean);
  const input = "mt-0.5 block w-full rounded-md border border-[#BBB] bg-white px-2 py-1.5 text-black";

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={`Edit ${line.fields.name}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") cancel();
      }}
      className="absolute left-0 right-0 sm:right-auto sm:w-[26rem] top-full z-30 mt-1 rounded-lg border border-[#C9C9C9] bg-white p-3 text-[14px] text-black shadow-lg print:hidden"
      style={{ fontFamily: "Arial, Helvetica, sans-serif", lineHeight: 1.3 }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2">
          Name
          <input autoFocus className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label>
          Quantity
          <input className={input} value={f.quantity} placeholder="4 bottles" onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        </label>
        <label>
          Size
          <input className={input} value={f.size} placeholder="32 oz" onChange={(e) => setF({ ...f, size: e.target.value })} />
        </label>
        <label className="col-span-2">
          Brand or note
          <input className={input} value={f.detail} placeholder="Grey Goose or Tito's" onChange={(e) => setF({ ...f, detail: e.target.value })} />
        </label>
        <label className="col-span-2">
          Store
          <select
            className={input}
            value={line.store ?? ""}
            onChange={(e) => {
              if (e.target.value === "__add") {
                commit();
                return onAddStore();
              }
              call({ action: "store", ref: line.ref, store: e.target.value || null });
            }}
          >
            <option value="">No store{sug ? ` (suggested: ${sug.name})` : ""}</option>
            {shown.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.retired ? " (retired)" : ""}
              </option>
            ))}
            <option value="__add">Add a store…</option>
          </select>
        </label>
      </div>

      {line.conflict && (
        <div className="mt-2 rounded-md border border-[#C9772E] bg-[#FFF6EC] px-2 py-2 space-y-1">
          <p className="font-bold text-[#8A4B12]">The calculated value changed after this line was edited.</p>
          <p>Yours: {fieldsText(line.conflict.mine, line.section)}</p>
          <p>New calculated: {fieldsText(line.conflict.calc, line.section)}</p>
          <div className="flex gap-2 pt-0.5">
            <button type="button" onClick={() => { cancel(); call({ action: "keep", ref: line.ref }); }} className="rounded-md bg-black text-white px-3 py-1">
              Keep mine
            </button>
            <button type="button" onClick={() => { cancel(); call({ action: "use_new", ref: line.ref }); }} className="rounded-md border border-black px-3 py-1">
              Use new
            </button>
          </div>
        </div>
      )}
      {line.gone && (
        <div className="mt-2 rounded-md border border-[#C9772E] bg-[#FFF6EC] px-2 py-2 space-y-1">
          <p className="font-bold text-[#8A4B12]">An update took this item off the calculated list.</p>
          <div className="flex gap-2 pt-0.5">
            <button type="button" onClick={() => { cancel(); call({ action: "keep", ref: line.ref }); }} className="rounded-md bg-black text-white px-3 py-1">
              Keep mine
            </button>
            <button type="button" onClick={() => { cancel(); call({ action: "use_new", ref: line.ref }); }} className="rounded-md border border-black px-3 py-1">
              Use new (remove it)
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={commit} className="rounded-md bg-black text-white px-3 py-1.5 font-bold">
          Done
        </button>
        {line.kind === "calc" && line.edited.length > 0 && (
          <button type="button" onClick={() => { cancel(); call({ action: "reset", ref: line.ref }); }} className="underline">
            Reset to calculated
          </button>
        )}
        <button type="button" onClick={copy} className="underline" title="Copy the item name to paste into the store search">
          Copy name
        </button>
        <button type="button" onClick={() => { cancel(); call({ action: "remove", ref: line.ref }); }} className="underline text-[#A0412D]">
          Remove
        </button>
      </div>
      {meta.length > 0 && <p className="mt-2 text-xs text-[#555]">{meta.join(" · ")}</p>}
    </div>
  );
}

function Line({
  line,
  stores,
  open,
  setOpen,
  call,
  tz,
  onAddStore,
  onCopied,
  sectionLabel,
}: {
  line: SheetLine;
  stores: StoreInfo[];
  open: Open;
  setOpen: (o: Open) => void;
  call: Call;
  tz: string;
  onAddStore: (f: AddFor) => void;
  onCopied: (name: string) => void;
  sectionLabel?: string;
}) {
  const store = storeOf(stores, line.store);
  const sug = storeOf(stores, line.suggestion);
  const editing = open?.kind === "edit" && open.ref === line.ref;
  const picking = open?.kind === "store" && open.ref === line.ref;
  const flagged = !!line.conflict || line.gone;
  return (
    <li data-ref={line.ref} data-store={line.store ?? ""} className="relative flex items-start gap-1">
      {/* The Ordered box sits where the bullet is, for items we buy. The client's own items keep a plain bullet. */}
      <span className="flex w-7 shrink-0 justify-center">
        {line.clientBuys ? (
          <span aria-hidden className="leading-[1.3]">•</span>
        ) : (
          <>
            <label className="-my-1.5 flex h-8 w-8 cursor-pointer items-center justify-center print:hidden" title="Ordered">
              <input
                type="checkbox"
                aria-label={`Ordered ${line.fields.name}`}
                checked={line.ordered}
                onChange={(e) => call({ action: "ordered", ref: line.ref, on: e.target.checked })}
                className="h-[18px] w-[18px] accent-black"
              />
            </label>
            <span aria-hidden className="hidden print:inline leading-[1.3]">•</span>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={() => setOpen(editing ? null : { kind: "edit", ref: line.ref })}
        aria-expanded={editing}
        className="min-w-0 flex-1 text-left leading-[1.3] py-0 rounded-sm hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1F4FE0] print:hover:bg-transparent"
      >
        <span
          className={`doc-mark print-exact ${store ? "font-bold" : ""} ${line.ordered ? "print:no-underline" : ""}`}
          style={store ? { background: store.color, color: line.textColor ?? textOn(store.color), ...exact } : undefined}
        >
          {line.text}
        </span>
        {flagged && (
          <span className="ml-1.5 align-[0.1em] rounded-sm bg-[#C2410C] px-1 text-[11px] font-bold text-white print:hidden" title="Changed since it was edited. Tap to review.">
            changed
          </span>
        )}
        {line.clientBuys && <span className="ml-2 whitespace-nowrap text-[12px] text-[#666] print:hidden">client buys</span>}
        {sectionLabel && <span className="ml-2 whitespace-nowrap text-[11px] uppercase tracking-wide text-[#888] print:hidden">{sectionLabel}</span>}
      </button>
      {/* The store swatch: its color, or an empty outline. Tapping it opens the store list directly. */}
      <button
        type="button"
        onClick={() => setOpen(picking ? null : { kind: "store", ref: line.ref })}
        aria-label={store ? `Store: ${store.name}. Change store for ${line.fields.name}` : `Set a store for ${line.fields.name}`}
        title={store ? store.name : sug ? `No store yet (suggested: ${sug.name})` : "No store yet"}
        className="-my-1.5 flex h-8 w-10 shrink-0 items-center justify-center print:hidden"
      >
        <span
          className={`block h-4 w-6 rounded-[3px] border ${store ? "border-black/25" : sug ? "border-dashed border-2" : "border-[#9A9A9A]"}`}
          style={store ? { background: store.color } : sug ? { borderColor: sug.color } : undefined}
        />
      </button>
      {editing && (
        <LineEditor
          line={line}
          stores={stores}
          call={call}
          tz={tz}
          onClose={() => setOpen(null)}
          onAddStore={() => {
            setOpen(null);
            onAddStore({ ref: line.ref });
          }}
          onCopied={onCopied}
        />
      )}
      {picking && (
        <StoreMenu
          stores={stores}
          current={line.store}
          suggestion={line.suggestion}
          className="right-0 top-full mt-1"
          onClose={() => setOpen(null)}
          onPick={(s) => {
            setOpen(null);
            if (s !== line.store) call({ action: "store", ref: line.ref, store: s });
          }}
          onAdd={() => {
            setOpen(null);
            onAddStore({ ref: line.ref });
          }}
        />
      )}
    </li>
  );
}

function AddLine({ section, call }: { section: SectionId; call: Call }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", quantity: "", size: "", detail: "" });
  const input = "min-w-0 rounded-md border border-[#BBB] bg-white px-2 py-1.5 text-black";
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-[#777] hover:text-black hover:underline">
        Add a line
      </button>
    );
  }
  return (
    <form
      className="mt-1 grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_2fr] gap-2 items-center text-[14px]"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.name.trim()) return;
        if (await call({ action: "add", section, ...f })) {
          setF({ name: "", quantity: "", size: "", detail: "" });
          setOpen(false);
        }
      }}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <input aria-label="New item" placeholder="Item" className={`${input} col-span-2 sm:col-span-1`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
      <input aria-label="New quantity" placeholder="Quantity" className={input} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
      <input aria-label="New size" placeholder="Size" className={input} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} />
      <input aria-label="New brand or note" placeholder="Brand or note" className={`${input} col-span-2 sm:col-span-1`} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} />
      <div className="col-span-2 sm:col-span-4 flex gap-3">
        <button type="submit" className="rounded-md bg-black text-white px-3 py-1 font-bold">
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ----- Page parts -----

function Header({ view }: { view: SheetView }) {
  return (
    <div>
      <p className="font-bold" style={{ color: BLUE }}>
        {view.header.line}
      </p>
      {view.header.theme && (
        <p>
          <span className="font-bold">Theme:</span> <span style={{ color: BLUE }}>{view.header.theme}</span>
        </p>
      )}
      {view.header.colors && (
        <p>
          <span className="font-bold">Colors:</span> <span style={{ color: BLUE }}>{view.header.colors}</span>
        </p>
      )}
    </div>
  );
}

function Legend({ view, call, open, setOpen }: { view: SheetView; call: Call; open: Open; setOpen: (o: Open) => void }) {
  if (view.sheet.legend.length === 0) return null;
  return (
    <p className="mt-3">
      {view.sheet.legend.map((id) => {
        const s = storeOf(view.stores, id);
        if (!s) return null;
        const who = view.meta.legendNames[id];
        const editing = open?.kind === "legend" && open.store === id;
        return (
          <span key={id} className="relative mr-3 inline-block whitespace-nowrap">
            <button
              type="button"
              onClick={() => setOpen(editing ? null : { kind: "legend", store: id })}
              title="Tap to add who handles this store on this event"
              className="text-left hover:underline decoration-dotted print:no-underline"
            >
              [<Box color={s.color} />] {s.name}
              {who ? ` (${who})` : ""}
            </button>
            {editing && <LegendName store={s} value={who ?? ""} onClose={() => setOpen(null)} onSave={(name) => call({ action: "legend_name", store: id, name })} />}
          </span>
        );
      })}
    </p>
  );
}

function LegendName({ store, value, onSave, onClose }: { store: StoreInfo; value: string; onSave: (v: string) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(value);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onClose();
    if (v.trim() !== value) onSave(v.trim());
  };
  useClickAway(root, commit);
  return (
    <div ref={root} className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-[#C9C9C9] bg-white p-3 text-[14px] shadow-lg whitespace-normal print:hidden">
      <label className="block">
        Who handles {store.name} on this event?
        <input
          autoFocus
          value={v}
          placeholder="Taylor"
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              done.current = true;
              onClose();
            }
          }}
          className="mt-1 block w-full rounded-md border border-[#BBB] px-2 py-1.5"
        />
      </label>
      <p className="mt-1 text-xs text-[#666]">Shown as ({v.trim() || "Taylor"}) on this shopping list. The next event starts with the same name.</p>
    </div>
  );
}

function Recipes({ view }: { view: SheetView }) {
  if (view.recipes.length === 0) return null;
  return (
    <section className="mt-4">
      <h2 className="font-bold">COCKTAIL RECIPES</h2>
      {view.recipes.map((r, i) => (
        <div key={`${r.name}-${i}`} className="mt-3">
          <p>
            <span className="doc-mark print-exact font-bold" style={{ background: RECIPE_GREEN, ...exact }}>
              {r.name}
              {r.mocktail ? " (Mocktail)" : ""}
            </span>{" "}
            - {r.cup} cup
            {r.martini && (
              <>
                {" "}
                <b>
                  <i>(martini)</i>
                </b>
              </>
            )}
          </p>
          <ul className="list-disc pl-[1.75em]">
            {r.ingredients.map((x, j) => (
              <li key={j}>{x}</li>
            ))}
          </ul>
          {r.garnish && (
            <p className="pl-[1.75em]">
              <b>Garnish:</b> {r.garnish}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

const page = "doc-page mx-auto w-full max-w-[8.5in] px-4 py-6 sm:px-[0.9in] sm:py-[0.8in] shadow-[0_1px_4px_rgba(0,0,0,0.18)] print:max-w-none print:p-0 print:shadow-none";

export default function OrderSheet({ initial, timeZone }: { initial: SheetView; timeZone: string; title?: string }) {
  const [view, setView] = useState(initial);
  const [mode, setMode] = useState<"sheet" | "store">("sheet");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(0);
  const [note, setNote] = useState(initial.meta.note);
  const [open, setOpen] = useState<Open>(null);
  const [addFor, setAddFor] = useState<AddFor>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = async (body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> => {
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
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Could not save." };
    } finally {
      setSaving((n) => n - 1);
    }
  };
  const call: Call = async (body) => {
    const r = await send(body);
    if (!r.ok) setError(r.error);
    return r.ok;
  };

  const copied = (name: string) => {
    setToast(`Copied “${name}”. Paste it into the store search.`);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  };

  const { progress, counts } = view.sheet;
  const pct = progress.total ? Math.round((progress.ordered / progress.total) * 100) : 0;
  const sectionTitle = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.title ?? "";
  const flagged = view.sheet.sections.flatMap((s) => s.lines).filter((l) => l.conflict || l.gone).length;
  const deliveryInUse = view.sheet.sections.some((s) => s.lines.some((l) => l.store === "delivery"));
  const lineProps = { stores: view.stores, open, setOpen, call, tz: timeZone, onAddStore: setAddFor, onCopied: copied };

  return (
    <div className="space-y-3">
      {/* The slim bar: never printed. */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-[#E8DDD5]/95 backdrop-blur border-b border-[#DDD5CC] print:hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] text-[#2C2420]">
          <span className="font-medium">{progress.total === 0 ? "The client buys everything on this list" : `${progress.ordered} of ${progress.total} ordered`}</span>
          {progress.total > 0 && (
            <span className="h-1.5 w-20 rounded-full bg-white overflow-hidden" aria-hidden>
              <span className="block h-full bg-[#55684A]" style={{ width: `${pct}%` }} />
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span role="tablist" aria-label="View" className="inline-flex rounded-lg border border-[#B5845A] overflow-hidden">
              {(["sheet", "store"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 text-[13px] font-medium ${mode === m ? "bg-[#B5845A] text-white" : "text-[#9A7049] bg-white"}`}
                >
                  {m === "sheet" ? "Sheet" : "By store"}
                </button>
              ))}
            </span>
            <button type="button" onClick={() => window.print()} className="rounded-lg bg-[#2C2420] text-white px-2.5 py-1 text-[13px] font-medium">
              Print or save as PDF
            </button>
          </span>
        </div>
        <p className="mt-1 text-[13px] text-[#4A3F38]">
          {counts.map((c, i) => {
            const s = storeOf(view.stores, c.store);
            return (
              <span key={c.label}>
                {i > 0 && " · "}
                <span className="whitespace-nowrap">
                {s && <span aria-hidden className="mr-1 inline-block h-2.5 w-3 rounded-[2px] border border-black/20 align-[-0.05em]" style={{ background: s.color }} />}
                {c.label} {c.count}
                </span>
              </span>
            );
          })}
          {saving > 0 && <span className="ml-2 text-[#A39585]">Saving...</span>}
        </p>
        {flagged > 0 && (
          <p className="mt-1 text-[13px] text-[#8A4B12]">
            {flagged === 1 ? "1 line changed" : `${flagged} lines changed`} since it was edited. Tap a line marked “changed” to keep yours or use the new one.
          </p>
        )}
        {view.meta.legacyDelivery && (
          <p className="mt-1 text-[13px] text-[#4A3F38]">
            This shopping list had “Delivery to event on day of” ticked before it became a store, so the legend still shows it.{" "}
            {deliveryInUse ? "It is now set on lines." : "Set it as the store on the lines that are delivered."}{" "}
            <button type="button" onClick={() => call({ action: "clear_legacy_delivery" })} className="underline">
              {deliveryInUse ? "Done, clear the old tick" : "Clear the old tick"}
            </button>
          </p>
        )}
        {error && <p className="mt-1 text-[13px] text-[#A0412D]">{error}</p>}
      </div>

      {/* The Sheet: on screen in Sheet mode, and always the printed page. */}
      <article className={`${page} ${mode === "sheet" ? "" : "hidden print:block"}`}>
        <Header view={view} />
        {view.sheet.sections.map((s) => {
          const removed = view.sheet.removed.filter((l) => l.section === s.id);
          const sectionOpen = open?.kind === "section" && open.section === s.id;
          return (
            <section key={s.id} aria-labelledby={`sec-${s.id}`} className="mt-3">
              <div className="relative flex items-baseline justify-between gap-2">
                <h2 id={`sec-${s.id}`} className="font-bold">
                  {s.title}
                </h2>
                {s.lines.length > 0 && (
                  <>
                    <button type="button" onClick={() => setOpen(sectionOpen ? null : { kind: "section", section: s.id })} className="shrink-0 text-[12px] text-[#777] hover:text-black hover:underline print:hidden">
                      Set all in this section to ▾
                    </button>
                    {sectionOpen && (
                      <StoreMenu
                        stores={view.stores}
                        current={null}
                        className="right-0 top-full mt-1"
                        onClose={() => setOpen(null)}
                        onPick={(st) => {
                          setOpen(null);
                          call({ action: "section_store", section: s.id, store: st });
                        }}
                        onAdd={() => {
                          setOpen(null);
                          setAddFor({ section: s.id });
                        }}
                      />
                    )}
                  </>
                )}
              </div>
              {s.lines.length > 0 && (
                <ul>
                  {s.lines.map((l) => (
                    <Line key={l.ref} line={l} {...lineProps} />
                  ))}
                </ul>
              )}
              <div className="pl-8 print:hidden">
                <AddLine section={s.id} call={call} />
                {removed.length > 0 && (
                  <details className="text-[13px] text-[#777]">
                    <summary className="cursor-pointer hover:text-black">Removed lines ({removed.length})</summary>
                    <ul className="mt-0.5">
                      {removed.map((l) => (
                        <li key={l.ref} className="flex flex-wrap items-center gap-2">
                          <span className="line-through">{l.text}</span>
                          <button type="button" onClick={() => call({ action: "restore", ref: l.ref })} className="underline">
                            Put back
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </section>
          );
        })}
        <Legend view={view} call={call} open={open} setOpen={setOpen} />
        {view.meta.note && <p className="mt-3 whitespace-pre-wrap">Note: {view.meta.note}</p>}
        <Recipes view={view} />
      </article>

      {mode === "store" && (
        <article className={`${page} print:hidden`}>
          <Header view={view} />
          {view.byStore.map((g) => {
            const s = storeOf(view.stores, g.store);
            return (
              <section key={g.title} className="mt-3">
                <h2 className="font-bold">
                  {s && (
                    <>
                      [<Box color={s.color} />]{" "}
                    </>
                  )}
                  {g.title.toUpperCase()} <span className="font-normal">({g.lines.length})</span>
                </h2>
                {g.lines.length === 0 ? (
                  <p className="pl-8 text-[#777]">Every line has a store.</p>
                ) : (
                  <ul>
                    {g.lines.map((l) => (
                      <Line key={l.ref} line={l} {...lineProps} sectionLabel={sectionTitle(l.section)} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          <Legend view={view} call={call} open={open} setOpen={setOpen} />
        </article>
      )}

      <section className="max-w-[8.5in] mx-auto space-y-1.5 print:hidden">
        <label htmlFor="sheet-note" className="block text-sm font-medium text-[#2C2420]">
          Note on the shopping list
        </label>
        <textarea
          id="sheet-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note.trim() !== view.meta.note && call({ action: "note", note })}
          placeholder="Anything Natalie should know when ordering"
          className="w-full rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[#2C2420]"
        />
        {view.meta.noteBy && (
          <p className="text-xs text-[#6B5D52]">
            Last edited by {view.meta.noteBy} {timeLabel(view.meta.noteAt, undefined, timeZone)}
          </p>
        )}
        <p className="text-xs text-[#A39585]">
          Edits here only change this shopping list. They never change the Client&apos;s list, the calculation, or any other event.
          {view.suggestions ? " A dashed swatch is a suggestion: the store that item was last given on another event." : ""}
        </p>
      </section>

      {addFor && (
        <AddStoreDialog
          stores={view.stores}
          onClose={() => setAddFor(null)}
          onSave={async (name, color) => {
            const r = await send({ action: "add_store", name, color, ...addFor });
            if (!r.ok) return r.error;
            setAddFor(null);
            return null;
          }}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-[#2C2420] text-white px-4 py-2 text-sm shadow-lg print:hidden">
          {toast}
        </div>
      )}
    </div>
  );
}
