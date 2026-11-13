"use client";

import Link from "next/link";
import { useState } from "react";
import type { EventListItem, ListSection } from "@/lib/team/event-list";
import { matchesSearch } from "@/lib/team/search";

const BADGE = {
  ok: "bg-[#E4EBDF] text-[#55684A]",
  warn: "bg-[#F6E3DC] text-[#A0412D]",
  muted: "bg-[#E8DDD5] text-[#6B5D52]",
};

/** Accept and decline for an event offered to this staff member. */
function Respond({ e, onDone }: { e: EventListItem; onDone: (status: "accepted" | "declined") => void }) {
  const [busy, setBusy] = useState<"" | "accept" | "decline">("");
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [error, setError] = useState("");
  const send = async (response: "accept" | "decline") => {
    setBusy(response);
    setError("");
    try {
      const res = await fetch("/api/team/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: e.id, response }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      onDone(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="px-3 pb-3 -mt-1 pl-[5.25rem] space-y-1.5">
      {confirmDecline ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[#2C2420]">Decline this event?</span>
          <button type="button" onClick={() => send("decline")} disabled={!!busy} className="rounded-lg bg-[#A0412D] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40">
            {busy === "decline" ? "Declining..." : "Yes, decline"}
          </button>
          <button type="button" onClick={() => setConfirmDecline(false)} disabled={!!busy} className="text-sm text-[#6B5D52] underline">
            Keep it
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => send("accept")} disabled={!!busy} className="rounded-lg bg-[#8B9E7E] text-white px-4 py-1.5 text-sm font-medium disabled:opacity-40">
            {busy === "accept" ? "Accepting..." : "Accept"}
          </button>
          <button type="button" onClick={() => setConfirmDecline(true)} disabled={!!busy} className="rounded-lg border border-[#A39585] text-[#6B5D52] px-4 py-1.5 text-sm font-medium disabled:opacity-40">
            Decline
          </button>
        </div>
      )}
      {error && <p className="text-sm text-[#A0412D]">{error}</p>}
    </div>
  );
}

/** Select mode on the staffing page: checkboxes on events that can be posted, a short reason on the rest. */
export interface ListSelect {
  selected: Set<string>;
  reasons: Record<string, string>;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
}

export default function EventList({ sections, empty, respond = false, select }: { sections: ListSection[]; empty: string; respond?: boolean; select?: ListSelect }) {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const statusOf = (e: EventListItem) => statuses[e.id] ?? e.status;
  const shown = sections
    .map((s) => ({
      ...s,
      days: s.days
        .map((d) => ({ ...d, events: d.events.filter((e) => matchesSearch(e, query) && statusOf(e) !== "declined") }))
        .filter((d) => d.events.length > 0),
    }))
    .filter((s) => s.days.length > 0);
  const anyEvents = sections.length > 0;

  return (
    <div className="space-y-4">
      {anyEvents && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          aria-label="Search events by name"
          className="w-full rounded-xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-2.5 text-[16px] text-[#2C2420] placeholder:text-[#A39585] focus:outline-none focus:ring-2 focus:ring-[#B5845A]/30 focus:border-[#B5845A]"
        />
      )}
      {select && (() => {
        const ids = shown.flatMap((s) => s.days.flatMap((d) => d.events)).filter((e) => !select.reasons[e.id]).map((e) => e.id);
        return (
          <button type="button" onClick={() => select.selectAll(ids)} disabled={ids.length === 0} className="text-sm text-[#9A7049] underline disabled:opacity-40 px-1">
            Select all shown ({ids.length})
          </button>
        );
      })()}
      {(!anyEvents || (shown.length === 0 && !query)) && (
        <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">{empty}</p>
      )}
      {anyEvents && shown.length === 0 && query && <p className="text-[15px] text-[#6B5D52] px-1">No events match that name.</p>}
      {shown.map((s) => (
        <section key={s.name} className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#B5845A] px-1">{s.name}</h2>
          {s.days.map((d) => (
            <div key={d.day ?? "tbd"}>
              <h3 className="font-heading text-[15px] font-bold text-[#2C2420] px-1 pb-1">{d.label}</h3>
              <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
                {d.events.map((e) => {
                  const status = statusOf(e);
                  const offered = respond && status === "offered";
                  return (
                    <li key={e.id} className={`relative ${select ? "flex items-stretch" : ""}`}>
                      {select && (
                        <div className="w-24 shrink-0 flex items-center justify-center border-r border-[#DDD5CC] px-1 text-center">
                          {select.reasons[e.id] ? (
                            <span className="text-[11px] italic text-[#A39585]">{select.reasons[e.id]}</span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={select.selected.has(e.id)}
                              onChange={() => select.toggle(e.id)}
                              className="h-5 w-5 accent-[#B5845A]"
                              aria-label={`Select ${e.title}`}
                            />
                          )}
                        </div>
                      )}
                      {e.chat && (
                        <Link
                          href={e.chat.href}
                          className="absolute right-3 bottom-2 z-10 text-[11px] font-medium text-[#9A7049] underline"
                          aria-label={e.chat.unread ? `Message team, ${e.chat.unread} unread` : "Message team"}
                        >
                          Chat{e.chat.unread ? ` (${e.chat.unread})` : ""}
                        </Link>
                      )}
                      <Link href={e.href ?? `/team/e/${e.id}`} className={`${select ? "flex-1 min-w-0 " : ""}flex items-start gap-3 px-3 py-2.5 hover:bg-[#EFE7DF] transition-colors ${e.chat ? "pb-6" : ""}`}>
                        <span className="w-[4.5rem] shrink-0 pt-0.5 text-sm font-medium text-[#2C2420] tabular-nums">
                          {e.arrival || "TBD"}
                          <span className="block text-[10px] font-normal uppercase tracking-wide text-[#A39585]">arrive</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-heading font-bold text-[#2C2420]">{e.title}</span>
                            {!!e.chat?.unread && <span className="shrink-0 h-2.5 w-2.5 rounded-full bg-[#A0412D]" title="Unread chat messages" aria-label="Unread chat messages" />}
                            {offered && <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${BADGE.warn}`}>New</span>}
                            {e.badge && (
                              <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${BADGE[e.badge.tone]}`}>{e.badge.text}</span>
                            )}
                          </span>
                          <span className="block text-sm text-[#6B5D52] break-words">{e.detail}</span>
                          {e.repeat && <span className="mt-0.5 mr-1 inline-block text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#EDE3F5] text-[#5B3F7A]">{e.repeat}</span>}
                          {e.noMenu && <span className="mt-0.5 inline-block text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F6E3DC] text-[#A0412D]">No approved menu</span>}
                          {e.pay && <span className="block text-xs text-[#55684A]">{e.pay} estimated pay, before taxes and tips</span>}
                        </span>
                      </Link>
                      {offered && <Respond e={e} onDone={(next) => setStatuses((m) => ({ ...m, [e.id]: next }))} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
