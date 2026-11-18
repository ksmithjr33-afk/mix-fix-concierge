"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "w-full rounded-xl border border-[#DDD5CC] bg-[#E8DDD5] px-3 py-2 text-[16px] text-[#2C2420] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30";

export interface ClientPlanner {
  id: string;
  name: string;
  company: string;
}

/**
 * Update mode, client held events: the planners with access, add or remove
 * one, the "Planner can see pricing" switch (off by default), and a plain list
 * of what each planner did.
 */
export default function PlannersCard({
  sessionId,
  planners,
  pricingOn,
  activity,
}: {
  sessionId: string;
  planners: ClientPlanner[];
  pricingOn: boolean;
  activity: { at: string; who: string; what: string }[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ name: "", company: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/client-planners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="your-planners" className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4 space-y-3" aria-label="Your planners">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Your planners</h2>
      {planners.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">Working with an event planner? Add them and they can help with your bar planning.</p>
      ) : (
        <ul className="space-y-1">
          {planners.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-[15px] text-[#2C2420]">
              <span>
                {p.name}
                {p.company ? `, ${p.company}` : ""}
              </span>
              <button type="button" disabled={busy} onClick={() => post({ action: "remove", partnerId: p.id })} className="text-sm text-[#A0412D] underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ action: "add", ...v })) {
              setAdding(false);
              setV({ name: "", company: "", phone: "" });
            }
          }}
          className="space-y-2"
        >
          <input className={input} placeholder="Planner's name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
          <input className={input} placeholder="Company (optional)" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />
          <input className={input} type="tel" placeholder="Planner's mobile number" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} required />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
              {busy ? "Adding..." : "Add planner"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-sm text-[#6B5D52] underline">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="text-sm text-[#B5845A] underline">
          Add a planner
        </button>
      )}
      {planners.length > 0 && (
        <label className="flex items-start gap-2 text-[15px] text-[#2C2420]">
          <input type="checkbox" className="mt-1" checked={pricingOn} disabled={busy} onChange={(e) => post({ action: "pricing", on: e.target.checked })} />
          <span>
            Planner can see pricing
            <span className="block text-xs text-[#6B5D52]">Off by default. When on, your planners see your booked total and remaining balance, nothing else.</span>
          </span>
        </label>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
      {activity.length > 0 && (
        <div className="border-t border-[#DDD5CC] pt-3 space-y-1">
          <h3 className="text-xs text-[#A39585] uppercase tracking-wide">What your planners did</h3>
          <ul className="space-y-1">
            {activity.map((a, i) => (
              <li key={i} className="text-sm text-[#2C2420]">
                <span className="text-[#6B5D52]">{a.at}</span> {a.who}: {a.what}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
