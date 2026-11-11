"use client";

import { useState } from "react";
import { PALETTE, textOn, type StoreInfo } from "@/lib/order-sheet-shared";
import { AddStoreDialog } from "../e/[id]/order/order-sheet";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

function ColorPicker({ stores, self, onPick, onClose }: { stores: StoreInfo[]; self: StoreInfo; onPick: (c: string) => void; onClose: () => void }) {
  const used = new Set(stores.filter((s) => s.id !== self.id).map((s) => s.color));
  return (
    <div className="mt-2 rounded-xl border border-[#DDD5CC] bg-white p-3">
      <p className="text-sm text-[#2C2420] mb-2">Pick a color nobody else uses.</p>
      <div className="flex flex-wrap gap-2">
        {PALETTE.map((p) => {
          const taken = used.has(p.color);
          return (
            <button
              key={p.color}
              type="button"
              disabled={taken}
              aria-label={`${p.name}${taken ? " (in use)" : ""}`}
              title={taken ? `${p.name}: ${stores.find((s) => s.color === p.color)?.name} uses it` : p.name}
              onClick={() => onPick(p.color)}
              className={`h-10 w-10 rounded-lg border-2 ${self.color === p.color ? "border-black ring-2 ring-black/30" : "border-black/15"} disabled:opacity-20 disabled:cursor-not-allowed`}
              style={{ background: p.color }}
            />
          );
        })}
      </div>
      <button type="button" onClick={onClose} className="mt-2 text-sm text-[#6B5D52] underline">
        Cancel
      </button>
    </div>
  );
}

export default function StoreManager({ initial }: { initial: StoreInfo[] }) {
  const [stores, setStores] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [coloring, setColoring] = useState("");
  const [adding, setAdding] = useState(false);

  const send = async (key: string, body: Record<string, unknown>): Promise<string | null> => {
    setBusy(key);
    setError("");
    try {
      const res = await fetch("/api/team/admin/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setStores(d.stores);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save.";
      setError(msg);
      return msg;
    } finally {
      setBusy("");
    }
  };

  const active = stores.filter((s) => !s.retired);
  const retired = stores.filter((s) => s.retired);

  const row = (s: StoreInfo, i: number, list: StoreInfo[]) => (
    <li key={s.id} className="py-3 border-b border-[#DDD5CC] last:border-0">
      <div className="flex items-center gap-3">
        <span className="h-7 w-10 shrink-0 rounded-md border border-black/20" style={{ background: s.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          {renaming?.id === s.id ? (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!(await send(`name:${s.id}`, { action: "update", id: s.id, name: renaming.name }))) setRenaming(null);
              }}
            >
              <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: s.id, name: e.target.value })} aria-label="Store name" className="min-w-0 flex-1 rounded-lg border border-[#DDD5CC] bg-white px-2 py-1" />
              <button type="submit" disabled={!!busy} className="rounded-lg bg-[#B5845A] text-white px-3 py-1 text-sm font-medium disabled:opacity-40">
                Save
              </button>
              <button type="button" onClick={() => setRenaming(null)} className="text-sm text-[#6B5D52] underline">
                Cancel
              </button>
            </form>
          ) : (
            <p className="text-[15px] text-[#2C2420] break-words">
              <span className="px-1 font-bold" style={{ background: s.color, color: textOn(s.color) }}>
                {s.name}
              </span>
              {s.lastLegendName ? <span className="text-sm text-[#6B5D52]"> · legend name ({s.lastLegendName})</span> : null}
            </p>
          )}
        </div>
        {!s.retired && (
          <div className="flex shrink-0 flex-col">
            <button type="button" aria-label={`Move ${s.name} up`} disabled={i === 0 || !!busy} onClick={() => send(`move:${s.id}`, { action: "move", id: s.id, direction: "up" })} className="px-2 text-[#6B5D52] disabled:opacity-25">
              ▲
            </button>
            <button type="button" aria-label={`Move ${s.name} down`} disabled={i === list.length - 1 || !!busy} onClick={() => send(`move:${s.id}`, { action: "move", id: s.id, direction: "down" })} className="px-2 text-[#6B5D52] disabled:opacity-25">
              ▼
            </button>
          </div>
        )}
      </div>
      {renaming?.id !== s.id && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-[3.25rem] text-sm">
          <button type="button" onClick={() => setRenaming({ id: s.id, name: s.name })} className="text-[#9A7049] underline">
            Rename
          </button>
          <button type="button" onClick={() => setColoring(coloring === s.id ? "" : s.id)} className="text-[#9A7049] underline">
            Change color
          </button>
          {s.retired ? (
            <button type="button" disabled={!!busy} onClick={() => send(`retire:${s.id}`, { action: "update", id: s.id, retired: false })} className="text-[#9A7049] underline">
              Bring back
            </button>
          ) : (
            <button type="button" disabled={!!busy} onClick={() => send(`retire:${s.id}`, { action: "update", id: s.id, retired: true })} className="text-[#A0412D] underline">
              Retire
            </button>
          )}
        </div>
      )}
      {coloring === s.id && (
        <ColorPicker
          stores={stores}
          self={s}
          onClose={() => setColoring("")}
          onPick={async (c) => {
            if (!(await send(`color:${s.id}`, { action: "update", id: s.id, color: c }))) setColoring("");
          }}
        />
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-[#A0412D] px-1">{error}</p>}
      <section className={card}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-base font-bold text-[#2C2420]">Stores</h2>
          <button type="button" onClick={() => setAdding(true)} className="rounded-lg bg-[#B5845A] text-white px-3 py-1.5 text-sm font-medium">
            Add a store
          </button>
        </div>
        <ul>{active.map((s, i) => row(s, i, active))}</ul>
      </section>
      {retired.length > 0 && (
        <section className={card}>
          <h2 className="font-heading text-base font-bold text-[#2C2420]">Retired</h2>
          <p className="text-sm text-[#6B5D52]">Still shown on the sheets that used them. Not offered on new lines. Their colors stay taken so old sheets never show two stores in one color.</p>
          <ul>{retired.map((s, i) => row(s, i, retired))}</ul>
        </section>
      )}
      {adding && (
        <AddStoreDialog
          stores={stores}
          onClose={() => setAdding(false)}
          onSave={async (name, color) => {
            const err = await send("add", { action: "add", name, color });
            if (!err) setAdding(false);
            return err;
          }}
        />
      )}
    </div>
  );
}
