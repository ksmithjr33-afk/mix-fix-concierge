"use client";

import { useMemo, useState } from "react";
import { itemKey, LEVEL_LABEL, LOW_STOCK_LABEL, MAX_ITEM, MAX_NOTE, type Level } from "@/lib/team/low-stock";

// "Running low": a button and a short form. Pick an item from the list or type
// one, Running low or Out, an optional note, one tap to send. Built for a
// phone with bad signal: one small request, a timeout, and the form stays
// filled so Send can be tapped again (the server folds a repeat into the
// same report, so a retry never texts twice).

const SEND_TIMEOUT_MS = 15_000;

export default function RunningLowButton({ sessionId, items, kit = false }: { sessionId: string | null; items: string[]; kit?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border-2 border-[#A0412D] text-[#A0412D] bg-white py-3 font-medium hover:bg-[#FBEDE9]"
      >
        {LOW_STOCK_LABEL}
      </button>
      {open && <RunningLowSheet sessionId={sessionId} items={items} kit={kit} onClose={() => setOpen(false)} />}
    </>
  );
}

function RunningLowSheet({ sessionId, items, kit, onClose }: { sessionId: string | null; items: string[]; kit: boolean; onClose: () => void }) {
  const [item, setItem] = useState("");
  const [level, setLevel] = useState<Level>("low");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [sentKind, setSentKind] = useState<"event" | "kit">("event");
  const [error, setError] = useState("");

  const matches = useMemo(() => {
    const q = itemKey(item);
    const list = q ? items.filter((i) => itemKey(i).includes(q) && itemKey(i) !== q) : items;
    return list.slice(0, 40);
  }, [item, items]);

  const send = async () => {
    if (!item.trim() || status === "sending") return;
    setStatus("sending");
    setError("");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch("/api/team/low-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, item: item.trim(), level, note: note.trim() }),
        signal: ctrl.signal,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not send.");
      setSentKind(d.kind === "kit" ? "kit" : "event");
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(
        err instanceof Error && err.name !== "AbortError" && err.message !== "Failed to fetch" && err.message !== "Load failed"
          ? err.message
          : "Did not send. Check your signal and tap Send again."
      );
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full sm:max-w-md max-h-[90dvh] flex flex-col bg-[#F5F0EB] rounded-t-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={LOW_STOCK_LABEL}>
        <div className="px-4 py-3 border-b border-[#DDD5CC] flex items-center justify-between">
          <h3 className="font-heading text-base font-bold text-[#2C2420]">{LOW_STOCK_LABEL}</h3>
          <button type="button" onClick={onClose} className="text-sm text-[#6B5D52] min-h-[44px] px-2">
            Close
          </button>
        </div>
        {status === "sent" ? (
          <div className="px-4 py-6 text-center space-y-3">
            <p className="text-[15px] text-[#2C2420]">
              {sentKind === "event" ? "Sent to the team. We will text you when someone is on it." : "Saved. The team gets kit reports in the 9 AM summary and will text you when someone is on it."}
            </p>
            <button type="button" onClick={onClose} className="rounded-xl bg-[#B5845A] text-white px-6 py-2.5 font-medium">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="px-4 pt-3 space-y-2">
              <label className="block text-sm font-medium text-[#2C2420]" htmlFor="low-item">
                What is it?
              </label>
              <input
                id="low-item"
                value={item}
                onChange={(e) => setItem(e.target.value.slice(0, MAX_ITEM))}
                placeholder={items.length ? "Pick from the list or type it" : "Type the item"}
                autoComplete="off"
                enterKeyHint="send"
                onKeyDown={(e) => e.key === "Enter" && send()}
                className="w-full rounded-xl border border-[#DDD5CC] bg-white px-3.5 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30"
              />
            </div>
            {matches.length > 0 && (
              <ul className="flex-1 min-h-0 overflow-y-auto px-4 py-1">
                {matches.map((i) => (
                  <li key={i}>
                    <button type="button" onClick={() => setItem(i)} className="w-full text-left py-2.5 border-b border-[#DDD5CC] text-[15px] text-[#2C2420]">
                      {i}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="px-4 py-3 border-t border-[#DDD5CC] space-y-2 mt-auto">
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How short">
                {(["low", "out"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={level === l}
                    onClick={() => setLevel(l)}
                    className={`rounded-xl py-2.5 font-medium border-2 ${level === l ? "bg-[#A0412D] border-[#A0412D] text-white" : "bg-white border-[#DDD5CC] text-[#2C2420]"}`}
                  >
                    {LEVEL_LABEL[l]}
                  </button>
                ))}
              </div>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                placeholder="Add a note (optional)"
                className="w-full rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3.5 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30"
              />
              {kit && <p className="text-xs text-[#6B5D52]">For your own kit or stock for a future event. The team gets these in a 9 AM summary.</p>}
              {error && <p className="text-sm text-[#A0412D]">{error}</p>}
              <button type="button" onClick={send} disabled={status === "sending" || !item.trim()} className="w-full rounded-xl bg-[#B5845A] text-white py-3 font-medium disabled:opacity-40">
                {status === "sending" ? "Sending..." : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
