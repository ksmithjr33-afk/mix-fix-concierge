"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import TierBadge from "./tier-badge";

export interface RosterItem {
  staffId: string;
  name: string;
  markets: { key: string; label: string }[];
  marketLabel: string;
  worked: number;
  rated: number;
  lastAvg: number | null;
  allAvg: number | null;
  lowest: number | null;
  tier: string; // "Ace"
  tierWhy: string;
  ranks: Record<string, number>;
  rank: number | null;
  lastEvent: string | null; // "Nov 14, 2026"
  lastEventDay: string | null;
  facts: { late: number; noClockOut: number; declined: number; handedOff: number; noCloseout: number };
  onboarding: string; // "5 of 5"
  onboardingDone: boolean;
  cert: string;
  manualSigned: boolean;
  payrollDone: boolean;
}

type SortKey = "rank" | "name" | "lastAvg" | "allAvg" | "rated" | "worked" | "lowest" | "lastEvent";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "rank", label: "Rank" },
  { key: "name", label: "Name" },
  { key: "lastAvg", label: "Last 10 average" },
  { key: "allAvg", label: "All time average" },
  { key: "rated", label: "Events rated" },
  { key: "worked", label: "Events worked" },
  { key: "lowest", label: "Lowest mark" },
  { key: "lastEvent", label: "Last event" },
];
const TIER_ORDER: Record<string, number> = { Ace: 0, Solid: 1, Coach: 2, New: 3 };
const avg = (n: number | null) => (n === null ? "" : n.toFixed(2));
const input = "rounded-xl border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420]";

function Facts({ f }: { f: RosterItem["facts"] }) {
  const parts = [
    f.late ? `${f.late} late` : "",
    f.noClockOut ? `${f.noClockOut} no clock out` : "",
    f.declined ? `${f.declined} declined` : "",
    f.handedOff ? `${f.handedOff} handed off` : "",
    f.noCloseout ? `${f.noCloseout} no closeout` : "",
  ].filter(Boolean);
  return <span className="block text-[11px] text-[#6B5D52]">{parts.length ? `90 days: ${parts.join(" · ")}` : "90 days: nothing to flag"}</span>;
}

export default function RosterTable({ rows, markets, window }: { rows: RosterItem[]; markets: { key: string; label: string }[]; window: number }) {
  const [market, setMarket] = useState("");
  const [tier, setTier] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("rank");
  const [desc, setDesc] = useState(false);

  const rankOf = (r: RosterItem) => (market ? (r.ranks[market] ?? null) : r.rank);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = rows.filter((r) => (!market || r.markets.some((m) => m.key === market)) && (!tier || r.tier === tier) && words.every((w) => r.name.toLowerCase().includes(w)));
    const val = (r: RosterItem): number | string => {
      if (sort === "name") return r.name.toLowerCase();
      if (sort === "rank") return rankOf(r) ?? 9999 + TIER_ORDER[r.tier];
      if (sort === "lastEvent") return r.lastEventDay ?? "";
      const v = r[sort];
      return v === null ? -1 : v;
    };
    const dir = desc ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, market, tier, query, sort, desc]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" aria-label="Search staff by name" className={`${input} flex-1 min-w-[10rem]`} />
        <select value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Market" className={input}>
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier" className={input}>
          <option value="">All tiers</option>
          {["Ace", "Solid", "Coach", "New"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by" className={input}>
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label.replace("Last 10", `Last ${window}`)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setDesc((d) => !d)} className={`${input} text-sm`} aria-label="Reverse the order">
          {desc ? "High to low" : "Low to high"}
        </button>
      </div>
      {market === "" && <p className="text-xs text-[#6B5D52] px-1">Rank is within each person&apos;s first market. Pick a market to rank within it. New is listed but not ranked.</p>}
      {shown.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">{rows.length ? "Nobody matches." : "Nobody on the roster yet."}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.staffId}>
              <Link href={`/team/admin/scorecard/${r.staffId}`} className="block rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3 hover:bg-[#FAF7F3]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-10 shrink-0 text-sm font-bold text-[#2C2420] tabular-nums">{rankOf(r) ? `#${rankOf(r)}` : ""}</span>
                  <span className="font-heading font-bold text-[#2C2420]">{r.name}</span>
                  <TierBadge tier={r.tier} title={r.tierWhy} />
                  <span className="text-sm text-[#6B5D52]">{r.marketLabel}</span>
                </div>
                <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 text-sm text-[#2C2420]">
                  <span>Last {window}: <b>{avg(r.lastAvg) || "none"}</b></span>
                  <span>All time: <b>{avg(r.allAvg) || "none"}</b></span>
                  <span>Lowest: <b>{r.lowest ?? "none"}</b></span>
                  <span>
                    {r.rated} rated of {r.worked} worked
                  </span>
                  <span className="col-span-2 sm:col-span-4 text-[13px] text-[#6B5D52]">Last event: {r.lastEvent ?? "none yet"}</span>
                </div>
                <Facts f={r.facts} />
                <span className="block text-[11px] text-[#6B5D52]">
                  Onboarding {r.onboarding}
                  {r.cert ? ` · ${r.cert}` : ""} · Manual {r.manualSigned ? "signed" : "not signed"} · Payroll setup {r.payrollDone ? "done" : "not done"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
