"use client";

import Link from "next/link";
import { useState } from "react";
import type { ListSection } from "@/lib/team/event-list";
import { matchesSearch } from "@/lib/team/search";

export default function EventList({ sections, empty }: { sections: ListSection[]; empty: string }) {
  const [query, setQuery] = useState("");
  const shown = sections
    .map((s) => ({
      ...s,
      days: s.days.map((d) => ({ ...d, events: d.events.filter((e) => matchesSearch(e, query)) })).filter((d) => d.events.length > 0),
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
      {!anyEvents && (
        <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">{empty}</p>
      )}
      {anyEvents && shown.length === 0 && <p className="text-[15px] text-[#6B5D52] px-1">No events match that name.</p>}
      {shown.map((s) => (
        <section key={s.name} className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#B5845A] px-1">{s.name}</h2>
          {s.days.map((d) => (
            <div key={d.day ?? "tbd"}>
              <h3 className="font-heading text-[15px] font-bold text-[#2C2420] px-1 pb-1">{d.label}</h3>
              <ul className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] divide-y divide-[#DDD5CC] overflow-hidden">
                {d.events.map((e) => (
                  <li key={e.id}>
                    <Link href={`/team/e/${e.id}`} className="flex items-start gap-3 px-3 py-2.5 hover:bg-[#EFE7DF] transition-colors">
                      <span className="w-[4.5rem] shrink-0 pt-0.5 text-sm font-medium text-[#2C2420] tabular-nums">
                        {e.arrival || "TBD"}
                        <span className="block text-[10px] font-normal uppercase tracking-wide text-[#A39585]">arrive</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-heading font-bold text-[#2C2420]">{e.title}</span>
                        <span className="block text-sm text-[#6B5D52] break-words">{e.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
