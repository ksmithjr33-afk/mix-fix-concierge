import Link from "next/link";
import type { CalDay, CalGrid } from "@/lib/team/calendar";
import type { EventListItem } from "@/lib/team/event-list";

// Same colors as the list badges.
const TONE = {
  ok: { badge: "bg-[#E4EBDF] text-[#55684A]", block: "border-l-[#8B9E7E]" },
  warn: { badge: "bg-[#F6E3DC] text-[#A0412D]", block: "border-l-[#A0412D]" },
  muted: { badge: "bg-[#E8DDD5] text-[#6B5D52]", block: "border-l-[#A39585]" },
};

export type CalLink = (o: { mode?: "week" | "month"; d?: string }) => string;

/** "List | Calendar" switch above an events list. */
export function ListCalendarToggle({ calendar, listHref, calendarHref }: { calendar: boolean; listHref: string; calendarHref: string }) {
  const cls = (on: boolean) => `px-3 py-1 rounded-md text-sm font-medium ${on ? "bg-[#F5F0EB] text-[#2C2420] shadow-sm" : "text-[#6B5D52]"}`;
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

function ChatLink({ e }: { e: EventListItem }) {
  if (!e.chat) return null;
  return (
    <Link href={e.chat.href} className="shrink-0 text-[11px] font-medium text-[#9A7049] underline" aria-label={e.chat.unread ? `Message team, ${e.chat.unread} unread` : "Message team"}>
      Chat{e.chat.unread ? ` (${e.chat.unread})` : ""}
    </Link>
  );
}

function Block({ e, compact }: { e: EventListItem; compact: boolean }) {
  const tone = TONE[e.badge?.tone ?? "muted"];
  return (
    <div className={`rounded-lg bg-[#F5F0EB] border border-[#DDD5CC] border-l-4 ${tone.block} hover:bg-[#EFE7DF] transition-colors`}>
      <Link href={e.href ?? `/team/e/${e.id}`} className="block px-2 py-1.5" title={[e.arrival, e.title, e.badge?.text].filter(Boolean).join(" · ")}>
        <span className="block text-[11px] font-medium tabular-nums text-[#6B5D52]">{e.arrival || "Time TBD"}</span>
        <span className={`block font-heading font-bold text-[#2C2420] ${compact ? "text-xs truncate" : "text-sm break-words"}`}>{e.title}</span>
        {e.badge && (
          <span className={`mt-0.5 inline-block max-w-full truncate text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${tone.badge}`}>{e.badge.text}</span>
        )}
      </Link>
      {e.chat && (
        <div className="px-2 pb-1.5 -mt-0.5">
          <ChatLink e={e} />
        </div>
      )}
    </div>
  );
}

function DayHead({ d }: { d: CalDay }) {
  return (
    <span className={`text-xs font-bold uppercase tracking-wider ${d.today ? "text-[#B5845A]" : "text-[#6B5D52]"}`}>
      {d.weekday} <span className={`tabular-nums ${d.today ? "rounded-full bg-[#B5845A] text-white px-1.5" : ""}`}>{d.dayNum}</span>
    </span>
  );
}

/** A week (stacked days on a phone, seven columns from small screens up) or a month grid. */
export default function CalendarView({ grid, link, empty }: { grid: CalGrid; link: CalLink; empty: string }) {
  const anyEvents = grid.days.some((d) => d.events.length > 0);
  const modeCls = (on: boolean) => `px-2.5 py-1 rounded-md text-sm ${on ? "bg-[#2C2420] text-white" : "text-[#6B5D52] border border-[#DDD5CC]"}`;
  return (
    <section className="space-y-3" aria-label="Calendar">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <Link href={link({ d: grid.prev })} className="rounded-md border border-[#DDD5CC] bg-[#F5F0EB] px-2.5 py-1 text-sm text-[#2C2420]" aria-label="Previous">
            ‹
          </Link>
          <h2 className="font-heading text-[15px] font-bold text-[#2C2420]">{grid.label}</h2>
          <Link href={link({ d: grid.next })} className="rounded-md border border-[#DDD5CC] bg-[#F5F0EB] px-2.5 py-1 text-sm text-[#2C2420]" aria-label="Next">
            ›
          </Link>
        </div>
        <div className="flex gap-1.5">
          <Link href={link({ mode: "week" })} aria-current={grid.mode === "week" ? "page" : undefined} className={modeCls(grid.mode === "week")}>
            Week
          </Link>
          <Link href={link({ mode: "month" })} aria-current={grid.mode === "month" ? "page" : undefined} className={modeCls(grid.mode === "month")}>
            Month
          </Link>
          <Link href={link({ d: "today" })} className={modeCls(false)}>
            Today
          </Link>
        </div>
      </div>

      {grid.mode === "week" ? (
        <ol className="grid grid-cols-1 sm:grid-cols-7 gap-2">
          {grid.days.map((d) => (
            <li key={d.ymd} className={`rounded-xl border ${d.today ? "border-[#B5845A]" : "border-[#DDD5CC]"} bg-[#EFE7DF]/60 p-2 sm:min-h-[8rem] space-y-1.5`}>
              <div className="flex items-baseline justify-between sm:block">
                <DayHead d={d} />
                <span className="sm:hidden text-xs text-[#A39585]">{d.events.length ? `${d.events.length} ${d.events.length === 1 ? "event" : "events"}` : "No events"}</span>
              </div>
              {d.events.map((e) => (
                <Block key={e.id} e={e} compact={false} />
              ))}
            </li>
          ))}
        </ol>
      ) : (
        <>
          <div className="hidden sm:grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-[#A39585]">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <ol className="hidden sm:grid grid-cols-7 gap-1">
            {grid.days.map((d) => (
              <li key={d.ymd} className={`min-h-[6rem] rounded-lg border p-1 space-y-1 ${d.today ? "border-[#B5845A]" : "border-[#DDD5CC]"} ${d.inMonth ? "bg-[#EFE7DF]/60" : "bg-transparent opacity-60"}`}>
                <span className={`block text-right text-xs tabular-nums ${d.today ? "font-bold text-[#B5845A]" : "text-[#6B5D52]"}`}>{d.dayNum}</span>
                {d.events.map((e) => (
                  <Block key={e.id} e={e} compact />
                ))}
              </li>
            ))}
          </ol>
          {/* On a phone the month is the days that have events, in order. */}
          <ol className="sm:hidden space-y-2">
            {grid.days
              .filter((d) => d.inMonth && d.events.length > 0)
              .map((d) => (
                <li key={d.ymd} className={`rounded-xl border ${d.today ? "border-[#B5845A]" : "border-[#DDD5CC]"} bg-[#EFE7DF]/60 p-2 space-y-1.5`}>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#6B5D52]">{d.label}</span>
                  {d.events.map((e) => (
                    <Block key={e.id} e={e} compact={false} />
                  ))}
                </li>
              ))}
          </ol>
        </>
      )}
      {!anyEvents && <p className="text-[15px] text-[#6B5D52] px-1">{empty}</p>}
    </section>
  );
}
