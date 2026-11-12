"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  calendarGrid,
  chipTone,
  filterMarket,
  listRange,
  startView,
  type CalDay,
  type CalPrefs,
  type CalView,
  type ChipTone,
} from "@/lib/team/calendar";
import type { EventListItem } from "@/lib/team/event-list";

// The team calendar: Month, Week and List views with Today, back and forward,
// and a market filter. Each person's last view and filter are remembered (the
// view separately for a phone, which opens on List by default). It only shows
// the items the server handed it: every event for admins; for bartenders their
// own events, open shifts in their markets, and their unavailable days.

/** Select mode on the staffing page: a checkbox on each event that can be posted, a short reason on the rest. */
export interface CalSelect {
  selected: Set<string>;
  reasons: Record<string, string>;
  toggle: (id: string) => void;
  selectAll?: (ids: string[]) => void;
}

const TONE: Record<ChipTone, { chip: string; dot: string; label: string }> = {
  full: { chip: "bg-[#E4EBDF] border-[#B9C9AE] border-l-[#55684A]", dot: "bg-[#55684A]", label: "Fully staffed" },
  open: { chip: "bg-[#FBF0DA] border-[#E8CF9F] border-l-[#B7791F]", dot: "bg-[#B7791F]", label: "Spots open" },
  none: { chip: "bg-[#F6E3DC] border-[#E6BBAE] border-l-[#A0412D]", dot: "bg-[#A0412D]", label: "Nobody assigned" },
  mine: { chip: "bg-[#E4EBDF] border-[#B9C9AE] border-l-[#55684A]", dot: "bg-[#55684A]", label: "Your event" },
  offered: { chip: "bg-[#FBF0DA] border-[#E8CF9F] border-l-[#B7791F]", dot: "bg-[#B7791F]", label: "Offered to you" },
  shift: { chip: "bg-[#F5F0EB] border-dashed border-[#B5845A] border-l-[#B5845A]", dot: "bg-[#B5845A]", label: "Open shift" },
  plain: { chip: "bg-[#F5F0EB] border-[#DDD5CC] border-l-[#A39585]", dot: "bg-[#A39585]", label: "Event" },
};
const LEGEND: Record<"admin" | "staff", ChipTone[]> = { admin: ["full", "open", "none"], staff: ["mine", "offered", "shift"] };
const MENU_TEXT = { unassigned: "text-[#A0412D]", assigned: "text-[#6B5D52]", picked_up: "text-[#55684A]" };
const WEEK_HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "List | Calendar" switch above an events list. */
export function ListCalendarToggle({ calendar, listHref, calendarHref }: { calendar: boolean; listHref: string; calendarHref: string }) {
  const cls = (on: boolean) => `px-3 py-1.5 rounded-md text-sm font-medium ${on ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"}`;
  return (
    <nav className="inline-flex gap-1 bg-[#DDD5CC] p-1 rounded-lg" aria-label="Layout">
      <Link href={listHref} aria-current={!calendar ? "page" : undefined} className={cls(!calendar)}>
        List
      </Link>
      <Link href={calendarHref} aria-current={calendar ? "page" : undefined} className={cls(calendar)}>
        Calendar
      </Link>
    </nav>
  );
}

function savePref(patch: Partial<CalPrefs>) {
  fetch("/api/team/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
}

function Pick({ e, select }: { e: EventListItem; select: CalSelect }) {
  if (e.kind === "shift") return null;
  const reason = select.reasons[e.id];
  if (reason) return <span className="block px-2 pt-1 text-xs italic text-[#A39585]">{reason}</span>;
  return (
    <label className="flex items-center gap-1.5 px-2 pt-1.5 text-xs font-medium text-[#2C2420]">
      <input type="checkbox" checked={select.selected.has(e.id)} onChange={() => select.toggle(e.id)} className="h-4 w-4 accent-[#B5845A]" aria-label={`Select ${e.title}`} />
      Select
    </label>
  );
}

/** One event: start time, name, market, and the staffing color. Tapping it opens the event. */
function Chip({ e, big, select, marketLabel }: { e: EventListItem; big: boolean; select?: CalSelect; marketLabel: (m: unknown) => string }) {
  const tone = TONE[chipTone(e)];
  const on = !!select?.selected.has(e.id);
  const unread = e.chat?.unread ?? 0;
  const market = marketLabel(e.market);
  const title = [e.arrival || "Time TBD", e.title, market, tone.label, e.menu?.text, unread ? `${unread} unread messages` : ""].filter(Boolean).join(" · ");
  return (
    <div className={`relative rounded-lg border border-l-4 ${tone.chip} ${on ? "ring-2 ring-[#B5845A]" : ""} hover:brightness-[0.97] transition`}>
      {select && <Pick e={e} select={select} />}
      <Link href={e.href ?? `/team/e/${e.id}`} className={`block ${big ? "px-3 py-2" : "px-2 py-1"}`} title={title} aria-label={title}>
        <span className={`flex items-center gap-1.5 ${big ? "text-sm" : "text-xs"} text-[#6B5D52]`}>
          <span className="font-semibold tabular-nums text-[#2C2420]">{e.arrival || "TBD"}</span>
          {market && <span className="truncate">· {market}</span>}
          {e.kind === "shift" && <span className="shrink-0 font-semibold text-[#9A7049]">· Open shift</span>}
        </span>
        <span className={`block font-heading font-bold text-[#2C2420] ${big ? "text-base break-words" : "text-[13px] leading-snug truncate"}`}>{e.title}</span>
        {e.menu && <span className={`block ${big ? "text-sm" : "text-[11px] truncate"} ${MENU_TEXT[e.menu.state]}`}>{e.menu.text}</span>}
        {big && e.badge && <span className="block text-sm text-[#6B5D52] break-words">{e.badge.text}</span>}
      </Link>
      {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-[#A0412D] ring-2 ring-white" aria-hidden="true" />}
    </div>
  );
}

function Unavailable({ big }: { big?: boolean }) {
  return <span className={`inline-block rounded bg-[#DDD5CC] px-1.5 ${big ? "py-0.5 text-sm" : "text-[11px]"} font-medium text-[#6B5D52]`}>Unavailable</span>;
}

/** All of one day's events, opened from "+2 more" or a day on the phone month. */
function DayPanel({ day, unavailable, onClose, children }: { day: CalDay; unavailable: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose} role="dialog" aria-modal="true" aria-label={day.label}>
      <div className="w-full sm:max-w-lg max-h-[85dvh] flex flex-col bg-[#F5F0EB] rounded-t-2xl sm:rounded-2xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[#DDD5CC] flex items-center justify-between gap-3">
          <h3 className="font-heading text-lg font-bold text-[#2C2420]">
            {day.today ? "Today · " : ""}
            {day.label}
          </h3>
          <button type="button" onClick={onClose} className="text-[15px] text-[#6B5D52] underline">
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-3 space-y-2">
          {unavailable && <p className="text-[15px] text-[#6B5D52]">You marked this day unavailable.</p>}
          {day.events.length === 0 && !unavailable && <p className="text-[15px] text-[#6B5D52]">Nothing on this day.</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

const PER_CELL = 3;

export default function CalendarView({
  items,
  today,
  prefs,
  markets,
  unavailable = [],
  empty,
  select,
  audience,
}: {
  items: EventListItem[];
  today: string;
  prefs: CalPrefs;
  markets: { key: string; label: string }[]; // the market filter; fewer than two hides it
  unavailable?: string[]; // bartenders: their own unavailable days
  empty: string;
  select?: CalSelect;
  audience: "admin" | "staff";
}) {
  const [phone, setPhone] = useState(false);
  const [view, setView] = useState<CalView>(startView(prefs, false));
  const [anchor, setAnchor] = useState(today);
  const [market, setMarket] = useState(prefs.market);
  const [open, setOpen] = useState<string | null>(null);

  // A phone opens on its own remembered view (List by default).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => {
      setPhone(mq.matches);
      setView(startView(prefs, mq.matches));
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [prefs]);

  const labels = useMemo(() => new Map(markets.map((m) => [m.key, m.label])), [markets]);
  const marketLabel = (m: unknown) => (typeof m === "string" ? (labels.get(m) ?? "") : "");
  const shown = useMemo(() => filterMarket(items, market), [items, market]);
  const away = useMemo(() => new Set(unavailable), [unavailable]);
  const grid = useMemo(() => (view === "list" ? null : calendarGrid(view, anchor, today, shown)), [view, anchor, today, shown]);
  const list = useMemo(() => (view === "list" ? listRange(anchor, today, shown, away) : null), [view, anchor, today, shown, away]);
  const label = grid?.label ?? list?.label ?? "";

  const pickView = (v: CalView) => {
    setView(v);
    savePref(phone ? { phoneView: v } : { wideView: v });
  };
  const pickMarket = (m: string) => {
    setMarket(m);
    savePref({ market: m });
  };
  const move = (dir: -1 | 1) => setAnchor(grid ? (dir < 0 ? grid.prev : grid.next) : list ? (dir < 0 ? list.prev : list.next) : anchor);

  const days = grid ? grid.days : (list?.days ?? []);
  const visibleEvents = grid ? grid.days.filter((d) => d.inMonth).flatMap((d) => d.events) : (list?.days.flatMap((d) => d.events) ?? []);
  const selectable = select ? visibleEvents.filter((e) => e.kind !== "shift" && !select.reasons[e.id]).map((e) => e.id) : [];
  const openDay = open ? days.find((d) => d.ymd === open) : undefined;
  const chip = (e: EventListItem, big: boolean) => <Chip key={`${e.kind ?? "e"}-${e.id}`} e={e} big={big} select={select} marketLabel={marketLabel} />;
  const past = (d: CalDay) => d.ymd < today;
  const btn = "rounded-lg border border-[#DDD5CC] bg-[#F5F0EB] px-3 py-1.5 text-[15px] text-[#2C2420] hover:bg-[#EFE7DF]";
  const viewCls = (on: boolean) => `px-3 py-1.5 rounded-md text-[15px] font-medium ${on ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"}`;

  return (
    <section className="space-y-3" aria-label="Calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => move(-1)} className={btn} aria-label="Back">
            ‹
          </button>
          <button type="button" onClick={() => setAnchor(today)} className={btn}>
            Today
          </button>
          <button type="button" onClick={() => move(1)} className={btn} aria-label="Forward">
            ›
          </button>
          <h2 className="ml-1 font-heading text-lg sm:text-xl font-bold text-[#2C2420]">{label}</h2>
        </div>
        <div className="inline-flex gap-1 bg-[#DDD5CC] p-1 rounded-lg" role="group" aria-label="Calendar view">
          {(["month", "week", "list"] as const).map((v) => (
            <button key={v} type="button" onClick={() => pickView(v)} aria-pressed={view === v} className={viewCls(view === v)}>
              {v === "month" ? "Month" : v === "week" ? "Week" : "List"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {markets.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Market">
            {[{ key: "all", label: "All markets" }, ...markets].map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => pickMarket(m.key)}
                aria-pressed={market === m.key}
                className={`text-sm px-3 py-1 rounded-full border ${market === m.key ? "bg-[#2C2420] text-white border-[#2C2420]" : "border-[#DDD5CC] text-[#6B5D52] bg-[#F5F0EB]"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-[#6B5D52]" aria-label="Colors">
          {LEGEND[audience].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${TONE[t].dot}`} />
              {TONE[t].label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#A0412D] ring-2 ring-white" />
            Unread chat
          </li>
        </ul>
      </div>

      {select?.selectAll && (
        <button type="button" onClick={() => select.selectAll!(selectable)} disabled={selectable.length === 0} className="text-sm text-[#9A7049] underline disabled:opacity-40">
          Select all shown ({selectable.length})
        </button>
      )}

      {view === "month" && grid && (
        <>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-xs sm:text-sm font-bold uppercase tracking-wider text-[#A39585]">
            {WEEK_HEAD.map((w) => (
              <span key={w}>{phone ? w.slice(0, 1) : w}</span>
            ))}
          </div>
          {/* Laptop: tall days with up to three chips and "+2 more". */}
          <ol className="hidden sm:grid grid-cols-7 gap-1.5">
            {grid.days.map((d) => {
              const extra = d.events.length - PER_CELL;
              return (
                <li
                  key={d.ymd}
                  className={`min-h-[10.5rem] rounded-xl border p-1.5 space-y-1 ${d.today ? "border-2 border-[#B5845A] bg-[#FFF8EC]" : "border-[#DDD5CC]"} ${
                    d.inMonth ? (d.today ? "" : "bg-[#F5F0EB]/70") : "bg-transparent"
                  } ${past(d) || !d.inMonth ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    {away.has(d.ymd) ? <Unavailable /> : <span />}
                    <span className={`text-sm tabular-nums ${d.today ? "rounded-full bg-[#B5845A] text-white font-bold px-2" : "text-[#6B5D52] font-medium"}`}>{d.dayNum}</span>
                  </div>
                  {d.events.slice(0, PER_CELL).map((e) => chip(e, false))}
                  {extra > 0 && (
                    <button type="button" onClick={() => setOpen(d.ymd)} className="w-full rounded-md px-2 py-0.5 text-left text-sm font-medium text-[#9A7049] hover:bg-[#EFE7DF]">
                      +{extra} more
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {/* Phone: a compact grid with a dot per event; tap a day to open it. */}
          <ol className="grid sm:hidden grid-cols-7 gap-1">
            {grid.days.map((d) => (
              <li key={d.ymd}>
                <button
                  type="button"
                  onClick={() => setOpen(d.ymd)}
                  className={`w-full h-14 rounded-lg border flex flex-col items-center justify-start pt-1 gap-1 ${d.today ? "border-2 border-[#B5845A] bg-[#FFF8EC]" : "border-[#DDD5CC] bg-[#F5F0EB]/70"} ${
                    past(d) || !d.inMonth ? "opacity-50" : ""
                  } ${away.has(d.ymd) ? "bg-[#DDD5CC]" : ""}`}
                  aria-label={`${d.label}: ${d.events.length ? `${d.events.length} ${d.events.length === 1 ? "event" : "events"}` : "no events"}${away.has(d.ymd) ? ", unavailable" : ""}`}
                >
                  <span className={`text-sm tabular-nums ${d.today ? "font-bold text-[#B5845A]" : "text-[#2C2420]"}`}>{d.dayNum}</span>
                  <span className="flex gap-0.5">
                    {d.events.slice(0, 3).map((e) => (
                      <span key={`${e.kind ?? "e"}-${e.id}`} className={`h-1.5 w-1.5 rounded-full ${TONE[chipTone(e)].dot}`} />
                    ))}
                    {d.events.length > 3 && <span className="text-[9px] leading-none text-[#6B5D52]">+</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}

      {view === "week" && grid && (
        <ol className="grid grid-cols-1 lg:grid-cols-7 gap-2">
          {grid.days.map((d) => (
            <li
              key={d.ymd}
              className={`rounded-xl border p-2 lg:min-h-[16rem] space-y-1.5 ${d.today ? "border-2 border-[#B5845A] bg-[#FFF8EC]" : "border-[#DDD5CC] bg-[#F5F0EB]/70"} ${past(d) ? "opacity-60" : ""}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-sm font-bold uppercase tracking-wider ${d.today ? "text-[#B5845A]" : "text-[#6B5D52]"}`}>
                  {d.weekday} <span className={`tabular-nums ${d.today ? "rounded-full bg-[#B5845A] text-white px-1.5" : ""}`}>{d.dayNum}</span>
                </span>
                {away.has(d.ymd) && <Unavailable />}
                <span className="lg:hidden text-sm text-[#A39585]">{d.events.length ? `${d.events.length} ${d.events.length === 1 ? "event" : "events"}` : "No events"}</span>
              </div>
              {d.events.map((e) => chip(e, true))}
            </li>
          ))}
        </ol>
      )}

      {view === "list" && list && (
        <ol className="space-y-4">
          {list.days.map((d) => (
            <li key={d.ymd} className={past(d) ? "opacity-60" : ""}>
              <h3 className={`flex items-center gap-2 px-1 pb-1.5 font-heading text-base sm:text-lg font-bold ${d.today ? "text-[#B5845A]" : "text-[#2C2420]"}`}>
                {d.today && <span className="rounded-full bg-[#B5845A] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">Today</span>}
                {d.label}
                {away.has(d.ymd) && <Unavailable big />}
              </h3>
              <div className={`grid gap-2 sm:grid-cols-2 xl:grid-cols-3 ${d.today ? "rounded-xl border-2 border-[#B5845A] bg-[#FFF8EC] p-2" : ""}`}>
                {d.events.map((e) => chip(e, true))}
                {d.events.length === 0 && <p className="px-1 text-[15px] text-[#6B5D52]">You marked this day unavailable.</p>}
              </div>
            </li>
          ))}
          {list.days.length === 0 && <li className="text-[15px] text-[#6B5D52] bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-4">{empty}</li>}
        </ol>
      )}

      {grid && visibleEvents.length === 0 && <p className="text-[15px] text-[#6B5D52] px-1">{empty}</p>}

      {openDay && (
        <DayPanel day={openDay} unavailable={away.has(openDay.ymd)} onClose={() => setOpen(null)}>
          {openDay.events.map((e) => chip(e, true))}
        </DayPanel>
      )}
    </section>
  );
}

