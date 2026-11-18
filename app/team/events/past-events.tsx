"use client";

import { useEffect, useRef, useState } from "react";
import type { EventListItem } from "@/lib/team/event-list";
import { pastMonths } from "@/lib/team/past-months";
import { EventRow } from "./event-list";

/**
 * The Past events tab: newest first, by month and day, 30 at a time. Search and
 * Show more ask the server, which decides what this person may see.
 */
export default function PastEvents({ initial, initialMore }: { initial: EventListItem[]; initialMore: boolean }) {
  const [items, setItems] = useState(initial);
  const [more, setMore] = useState(initialMore);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"" | "search" | "more">("");
  const [error, setError] = useState("");
  const seq = useRef(0);
  const first = useRef(true);

  const load = async (q: string, offset: number) => {
    const n = ++seq.current;
    setBusy(offset ? "more" : "search");
    setError("");
    try {
      const res = await fetch(`/api/team/events/past?q=${encodeURIComponent(q)}&offset=${offset}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not load past events.");
      if (n !== seq.current) return; // a newer search took over
      setItems((prev) => (offset ? [...prev, ...(data.items as EventListItem[]).filter((e) => !prev.some((p) => p.id === e.id))] : data.items));
      setMore(!!data.more);
    } catch (err) {
      if (n === seq.current) setError(err instanceof Error ? err.message : "Could not load past events.");
    } finally {
      if (n === seq.current) setBusy("");
    }
  };

  // Search runs on the server over every past event, a moment after typing stops.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => load(query.trim(), 0), 250);
    return () => clearTimeout(t);
  }, [query]);

  const months = pastMonths(items);
  const anyAtAll = initial.length > 0;

  return (
    <div className="space-y-4">
      {anyAtAll && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          aria-label="Search past events by name"
          className="w-full rounded-xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]"
        />
      )}
      {!anyAtAll && <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">No past events.</p>}
      {anyAtAll && months.length === 0 && busy !== "search" && <p className="text-[15px] text-[#6B5D52] px-1">{query.trim() ? "No events match that name." : "No past events."}</p>}
      {months.map((m) => (
        <section key={m.month} className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#B5845A] px-1">{m.label}</h2>
          {m.days.map((d) => (
            <div key={d.day}>
              <h3 className="font-heading text-[15px] font-bold text-[#2C2420] px-1 pb-1">{d.label}</h3>
              <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
                {d.events.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {error && <p className="text-sm text-[#A0412D] px-1">{error}</p>}
      {more && (
        <button
          type="button"
          onClick={() => load(query.trim(), items.length)}
          disabled={!!busy}
          className="w-full rounded-xl border border-[#B5845A] text-[#9A7049] py-2.5 text-sm font-medium disabled:opacity-40"
        >
          {busy === "more" ? "Loading..." : "Show more"}
        </button>
      )}
    </div>
  );
}
