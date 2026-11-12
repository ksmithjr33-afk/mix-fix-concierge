"use client";

import { useState } from "react";
import type { PickupAdminView } from "@/lib/team/menu-pickup-db";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";
const field = "w-full rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";

/**
 * The manager view's "Menu pickup" card: where the cocktail menu is printed,
 * a note, the order number, who picks it up (active staff, admins included),
 * the "Picked up" check (records who and when; an admin can undo), and
 * "No printed menu for this event".
 */
export default function MenuPickupPanel({ initial, people }: { initial: PickupAdminView; people: { id: string; name: string; role: string }[] }) {
  const [view, setView] = useState(initial);
  const [store, setStore] = useState(initial.store);
  const [storeOther, setStoreOther] = useState(initial.storeOther);
  const [note, setNote] = useState(initial.locationNote);
  const [order, setOrder] = useState(initial.orderNumber);
  const [assignee, setAssignee] = useState(initial.assigneeId);
  const [notNeeded, setNotNeeded] = useState(initial.notNeeded);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const post = async (body: Record<string, unknown>, what: string) => {
    setBusy(what);
    setError("");
    setSaved("");
    try {
      const res = await fetch("/api/team/menu-pickup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: view.sessionId, ...body }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      return d;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const save = async (over: Partial<{ notNeeded: boolean }> = {}) => {
    const nn = over.notNeeded ?? notNeeded;
    const d = await post({ action: "save", store, store_other: storeOther, location_note: note, order_number: order, assignee_id: assignee, not_needed: nn }, "save");
    if (d?.view) {
      setView(d.view);
      setSaved(d.view.assigneeId && d.view.assigneeId !== view.assigneeId && !nn ? `Saved. ${d.view.assigneeName} gets a text.` : "Saved.");
    }
  };
  const pickedUp = async () => {
    const d = await post({ action: "picked_up" }, "picked");
    if (d) setView((v) => ({ ...v, state: "picked_up", pickedUpLine: d.line, undoneLine: "", outstanding: false }));
  };
  const undo = async () => {
    const d = await post({ action: "undo" }, "undo");
    if (d?.view) setView(d.view);
  };

  const dirty =
    store !== view.store || storeOther !== view.storeOther || note !== view.locationNote || order !== view.orderNumber || assignee !== view.assigneeId;

  return (
    <section className={`${card} space-y-3`} aria-label="Menu pickup">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-heading text-base font-bold text-[#2C2420]">Menu pickup</h3>
        <span
          className={`text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
            view.state === "picked_up" ? "bg-[#E4EBDF] text-[#55684A]" : view.state === "not_needed" ? "bg-[#E8DDD5] text-[#6B5D52]" : view.outstanding ? "bg-[#F6E3DC] text-[#A0412D]" : "bg-[#E8DDD5] text-[#6B5D52]"
          }`}
        >
          {view.state === "picked_up" ? "Picked up" : view.state === "not_needed" ? "No printed menu" : view.state === "assigned" ? `Assigned to ${view.assigneeName}` : "No one assigned"}
        </span>
      </div>

      <label className="flex items-center gap-2 text-[15px] text-[#2C2420]">
        <input
          type="checkbox"
          checked={notNeeded}
          onChange={(e) => {
            setNotNeeded(e.target.checked);
            save({ notNeeded: e.target.checked });
          }}
          disabled={!!busy}
          className="h-5 w-5 accent-[#B5845A]"
        />
        No printed menu for this event
      </label>

      {!notNeeded && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-[#A39585] uppercase tracking-wide">
              Printed at
              <select value={store} onChange={(e) => setStore(e.target.value)} className={`${field} mt-1`}>
                <option value="">Not set</option>
                <option value="walmart">Walmart</option>
                <option value="walgreens">Walgreens</option>
                <option value="other">Other</option>
              </select>
            </label>
            {store === "other" && (
              <label className="block text-xs text-[#A39585] uppercase tracking-wide">
                Store name
                <input value={storeOther} onChange={(e) => setStoreOther(e.target.value)} maxLength={80} className={`${field} mt-1`} placeholder="e.g. FedEx Office" />
              </label>
            )}
            <label className="block text-xs text-[#A39585] uppercase tracking-wide">
              Store location or note (optional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={`${field} mt-1`} placeholder="e.g. Lemmon Ave, photo counter" />
            </label>
            <label className="block text-xs text-[#A39585] uppercase tracking-wide">
              Order number (optional)
              <input value={order} onChange={(e) => setOrder(e.target.value)} maxLength={60} className={`${field} mt-1`} />
            </label>
            <label className="block text-xs text-[#A39585] uppercase tracking-wide">
              Who is picking it up
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={`${field} mt-1`}>
                <option value="">No one yet</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.role === "admin" ? " (admin)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => save()} disabled={!!busy || !dirty} className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy === "save" ? "Saving..." : "Save"}
            </button>
            {saved && <span className="text-sm text-[#55684A]">{saved}</span>}
          </div>

          <div className="border-t border-[#DDD5CC] pt-3 space-y-1.5">
            {view.state === "picked_up" ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex items-center gap-2 text-[15px] font-medium text-[#55684A]">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#8B9E7E] text-white" aria-hidden="true">
                    ✓
                  </span>
                  {view.pickedUpLine}
                </p>
                <button type="button" onClick={undo} disabled={!!busy} className="text-sm text-[#6B5D52] underline disabled:opacity-40">
                  {busy === "undo" ? "Undoing..." : "Undo"}
                </button>
              </div>
            ) : (
              <label className={`flex items-center gap-2 text-[15px] ${view.assigneeId ? "text-[#2C2420]" : "text-[#A39585]"}`}>
                <input type="checkbox" checked={false} onChange={pickedUp} disabled={!!busy || !view.assigneeId} className="h-5 w-5 accent-[#8B9E7E]" />
                Picked up
                {!view.assigneeId && <span className="text-sm">(assign someone first)</span>}
              </label>
            )}
            {view.undoneLine && <p className="text-sm text-[#6B5D52]">{view.undoneLine}</p>}
          </div>
        </>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </section>
  );
}
