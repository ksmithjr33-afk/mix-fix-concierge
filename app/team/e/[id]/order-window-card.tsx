"use client";

import { useState } from "react";
import type { OrderWindowView } from "@/lib/team/order-window-db";
import { ITEM_TITLE, MAX_WINDOWS, METHOD_LABEL, METHODS, NOTE_MAX, PLACED_LINE, QUESTION, type Answer, type Method, type Window } from "@/lib/team/order-window";

const field =
  "rounded-lg border border-[#DDD5CC] bg-white px-2 py-1.5 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]";

interface FormWindow {
  date: string;
  from: string;
  to: string;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toForm = (ws: Window[]): FormWindow[] => ws.map((w) => ({ date: w.date, from: hhmm(w.from), to: hhmm(w.to) }));
const same = (a: FormWindow[], b: FormWindow[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * "Order window": a pre event checklist item on the person's event page, and
 * the first thing they see right after accepting. Open until answered (red
 * inside 5 days of the event), editable until the order is placed.
 */
export default function OrderWindowCard({ initial, justAccepted = false }: { initial: OrderWindowView; justAccepted?: boolean }) {
  const [view, setView] = useState(initial);
  const [editing, setEditing] = useState(!initial.answer && !initial.locked);
  const start: Answer = view.answer ?? view.prefill;
  const blank = (): FormWindow => ({ date: view.days.length > 1 ? view.days[view.days.length - 2].value : (view.days[0]?.value ?? ""), from: "", to: "" });
  const [method, setMethod] = useState<Method>(start.method);
  const [windows, setWindows] = useState<FormWindow[]>(start.windows.length ? toForm(start.windows) : [blank()]);
  const [note, setNote] = useState(start.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const open = !view.answer;
  // Untouched usual windows: one tap confirms them.
  const isPrefill = open && view.prefill.windows.length > 0 && method === view.prefill.method && same(windows, toForm(view.prefill.windows)) && !note.trim();

  const switchMethod = (m: Method) => {
    if (m === method) return;
    // Still showing the usual times for the other method: show the usual times for this one.
    if (same(windows, toForm(view.usual[method])) || windows.every((w) => !w.from && !w.to)) setWindows(view.usual[m].length ? toForm(view.usual[m]) : [blank()]);
    setMethod(m);
  };
  const setW = (i: number, patch: Partial<FormWindow>) => setWindows((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/order-window", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: view.sessionId, method, windows, note }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setView(d.view);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const tone = open ? (view.urgent ? "border-[#A0412D] bg-[#F6E3DC]" : "border-[#E3C9A0] bg-[#FFF8EC]") : "border-[#8B9E7E] bg-[#EEF2EA]";

  return (
    <section className={`rounded-2xl border px-4 py-3 space-y-3 ${tone}`} aria-label={ITEM_TITLE} id="order-window" data-order-window={open ? (view.urgent ? "urgent" : "open") : "done"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">{ITEM_TITLE}</h2>
        <span className={`text-sm font-medium ${open ? (view.urgent ? "text-[#A0412D]" : "text-[#8A4B12]") : "text-[#55684A]"}`}>{open ? (view.urgent ? "Needed now" : "To do") : "Done"}</span>
      </div>

      {!editing && view.answer && (
        <div className="space-y-1">
          <p className="text-[15px] text-[#2C2420]">{view.summary}</p>
          {view.answer.note && <p className="text-sm text-[#6B5D52]">Note: {view.answer.note}</p>}
          {view.locked ? (
            <p className="text-sm text-[#6B5D52]">{PLACED_LINE}</p>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-[#9A7049] underline py-1">
              Change it
            </button>
          )}
        </div>
      )}

      {!view.answer && view.locked && <p className="text-[15px] text-[#2C2420]">{PLACED_LINE}</p>}

      {editing && !view.locked && (
        <div className="space-y-3">
          {justAccepted && open && <p className="text-[15px] text-[#55684A] font-medium">You accepted this event. One more thing:</p>}
          <p className="text-[15px] font-medium text-[#2C2420]">{QUESTION}</p>
          {view.urgent && <p className="text-sm text-[#A0412D]">The event is coming up soon. Please answer now so we can place the order.</p>}

          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Delivery or pickup">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => switchMethod(m)}
                className={`rounded-xl border py-2.5 font-medium ${method === m ? "border-[#B5845A] bg-[#B5845A] text-white" : "border-[#DDD5CC] bg-white text-[#2C2420]"}`}
              >
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
          <p className="text-sm text-[#6B5D52]">{method === "delivery" ? "When can you be home to receive a delivery?" : "When can you pick the order up from the store?"}</p>

          <ul className="space-y-2">
            {windows.map((w, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DDD5CC] bg-white/70 px-2 py-2">
                <select aria-label="Day" className={`${field} py-2`} value={w.date} onChange={(e) => setW(i, { date: e.target.value })}>
                  {view.days.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <span className="flex items-center gap-1 text-sm text-[#6B5D52]">
                  from
                  <input type="time" aria-label="From" className={field} value={w.from} onChange={(e) => setW(i, { from: e.target.value })} />
                  to
                  <input type="time" aria-label="To" className={field} value={w.to} onChange={(e) => setW(i, { to: e.target.value })} />
                </span>
                {windows.length > 1 && (
                  <button type="button" onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))} className="text-sm text-[#A0412D] underline px-1">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {windows.length < MAX_WINDOWS && (
            <button type="button" onClick={() => setWindows((ws) => [...ws, blank()])} className="text-sm font-medium text-[#9A7049] underline">
              Add another window
            </button>
          )}

          <label className="block text-xs text-[#A39585] uppercase tracking-wide">
            Note (optional)
            <input className={`${field} mt-1 w-full py-2.5`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} placeholder="e.g. Leave it with the front desk" />
          </label>

          {error && <p className="text-sm text-[#A0412D]">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-[#B5845A] text-white px-5 py-2.5 font-medium disabled:opacity-40">
              {busy ? "Saving..." : isPrefill ? "Confirm my usual times" : "Save"}
            </button>
            {view.answer && (
              <button type="button" onClick={() => setEditing(false)} disabled={busy} className="text-sm text-[#6B5D52] underline">
                Cancel
              </button>
            )}
          </div>
          {open && view.prefill.windows.length > 0 && <p className="text-xs text-[#6B5D52]">Filled in from the usual order windows on your profile.</p>}
        </div>
      )}
    </section>
  );
}
