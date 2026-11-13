import Link from "next/link";
import type { AssigneeProgress } from "@/lib/team/assignments-db";
import type { MissingReport } from "@/lib/team/events";
import type { ListDetail } from "@/lib/team/supplies";
import { SUPPLIES_PROGRESS } from "@/lib/team/supplies";
import { CHECKLIST_TITLE } from "@/lib/team/checklist-config";
import { clockStatus, timeLabel } from "@/lib/team/clock-label";
import { FLAG_LABELS, formatWorked, type PunchFlag } from "@/lib/team/clock";

// The manager view's Day of tab, read only: for each person, what is not
// checked off on their two lists (by name and amount) with anything they
// reported missing in red at the top, then the time punches. The bar setup
// photos and the wrap ups sit around it on the tab. It updates on refresh.

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

function Bar({ label, checked, total }: { label: string; checked: number; total: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-[#6B5D52]">
        <span>{label}</span>
        <span className="tabular-nums">
          {checked} of {total} checked
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#DDD5CC] overflow-hidden mt-0.5">
        <div className="h-full bg-[#8B9E7E]" style={{ width: `${total ? (checked / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function Unchecked({ lines }: { lines: ListDetail["unchecked"] }) {
  return (
    <ul className="text-sm text-[#2C2420] space-y-0.5 mt-0.5">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[0.45em] w-2.5 h-2.5 shrink-0 rounded-sm border border-[#A39585]" />
          <span>
            {l.label}
            {l.quantity && <span className="text-[#6B5D52]"> · {l.quantity}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One of a bartender's lists: progress, when they last touched it, what is still unchecked, and the checked ones behind "Show checked". */
function ListBlock({ title, list, timeZone }: { title: string; list: ListDetail; timeZone: string }) {
  return (
    <div className="space-y-1">
      <Bar label={title} checked={list.checked.length} total={list.total} />
      <p className="text-xs text-[#6B5D52]">{list.lastTouched ? `last checked ${timeLabel(list.lastTouched, undefined, timeZone)}` : "not started"}</p>
      {list.unchecked.length > 0 &&
        (list.checked.length === 0 ? (
          // Nothing checked yet: every item is unchecked, so the list waits behind a tap.
          <details className="text-sm text-[#2C2420]">
            <summary className="cursor-pointer text-[#6B5D52]">Show the {list.unchecked.length} items</summary>
            <Unchecked lines={list.unchecked} />
          </details>
        ) : (
          <Unchecked lines={list.unchecked} />
        ))}
      {list.total > 0 && list.unchecked.length === 0 && <p className="text-sm text-[#55684A]">All checked.</p>}
      {list.checked.length > 0 && (
        <details className="text-sm text-[#6B5D52]">
          <summary className="cursor-pointer">Show checked ({list.checked.length})</summary>
          <ul className="mt-0.5 space-y-0.5">
            {list.checked.map((l, i) => (
              <li key={i} className="line-through">
                {l.label}
                {l.quantity ? ` · ${l.quantity}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Each person on the event: their missing item reports in red, then the checklist and the supplies list, unchecked items by name. */
export function BartenderLists({
  people,
  lists,
  reports,
  timeZone,
}: {
  people: AssigneeProgress[];
  lists: Map<string, { checklist: ListDetail; supplies: ListDetail }>;
  reports: MissingReport[];
  timeZone: string;
}) {
  const on = people.filter((p) => p.status !== "declined");
  return (
    <section className={card}>
      <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Bartenders&apos; lists</h2>
      {on.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">Nobody on this event yet.</p>
      ) : (
        <ul className="divide-y divide-[#DDD5CC]">
          {on.map((p) => {
            const l = lists.get(p.staffId);
            const mine = reports.filter((r) => r.staffId === p.staffId);
            return (
              <li key={p.staffId} className="py-3 space-y-3">
                <p className="font-medium text-[#2C2420]">
                  {p.name}
                  {p.status === "offered" && <span className="ml-2 text-xs font-normal text-[#9A7049]">waiting for reply</span>}
                </p>
                {mine.length > 0 && (
                  <ul className="rounded-xl border border-[#E8B4A8] bg-[#FBEDE9] px-3 py-2 space-y-1.5">
                    {mine.map((r) => (
                      <li key={r.id} className="text-[15px] text-[#A0412D]">
                        <span className="font-semibold">Reported missing</span> · {timeLabel(r.createdAt, undefined, timeZone)}
                        {r.items.length > 0 && <span className="block">{r.items.join(", ")}</span>}
                        {r.note && <span className="block">Note: {r.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {l && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ListBlock title={CHECKLIST_TITLE} list={l.checklist} timeZone={timeZone} />
                    <ListBlock title={SUPPLIES_PROGRESS} list={l.supplies} timeZone={timeZone} />
                  </div>
                )}
                <p className="text-xs text-[#6B5D52]">
                  {p.confirmedAt ? `Has everything, confirmed ${timeLabel(p.confirmedAt, undefined, timeZone)}` : "Has not confirmed the checklist"}
                  {p.barReadyAt ? ` · Bar photo ${timeLabel(p.barReadyAt, undefined, timeZone)}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Reports from people no longer on the event. Everyone else's show in red at the top of their own lists. */
export function MissingReports({ reports, timeZone }: { reports: MissingReport[]; timeZone: string }) {
  if (reports.length === 0) return null;
  return (
    <section className={`${card} border-[#E8B4A8] bg-[#FBEDE9]`}>
      <h2 className="font-heading text-base font-bold text-[#A0412D] mb-1">Other missing item reports</h2>
      {(
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="text-[15px] text-[#2C2420] border-t border-[#EDE6DF] pt-2 first:border-0 first:pt-0">
              <p className="text-sm text-[#6B5D52]">
                {r.staffFirstName} · {timeLabel(r.createdAt, undefined, timeZone)}
              </p>
              {r.items.length > 0 && <p>{r.items.join(", ")}</p>}
              {r.note && <p className="text-[#4A3F38]">Note: {r.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Top of the Details tab: who is clocked in right now, one line per person on the event. The full punch list stays on Day of. */
export function ClockStatus({ people, timeZone }: { people: AssigneeProgress[]; timeZone: string }) {
  const on = people.filter((p) => p.status !== "declined");
  return (
    <section className={card} aria-label="Clock status">
      <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Clocked in</h2>
      {on.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">Nobody on this event yet.</p>
      ) : (
        <ul className="divide-y divide-[#DDD5CC]">
          {on.map((p) => {
            const line = clockStatus(p, timeZone);
            return (
              <li key={p.staffId} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[15px]">
                <span className="font-medium text-[#2C2420]">{p.name}</span>
                <span className={`text-sm ${p.clockIn && !p.clockOut ? "text-[#55684A] font-medium" : "text-[#6B5D52]"}`}>{line}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function TimePunches({ people, timeZone }: { people: AssigneeProgress[]; timeZone: string }) {
  const on = people.filter((p) => p.status !== "declined");
  return (
    <section className={card}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Time punches</h2>
        <Link href="/team/admin/timesheets" className="text-sm text-[#B5845A] underline">
          Timesheets
        </Link>
      </div>
      {on.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">Nobody on this event yet.</p>
      ) : (
        <ul className="divide-y divide-[#DDD5CC]">
          {on.map((p) => (
            <li key={p.staffId} className="py-2 text-[15px] text-[#2C2420]">
              <span className="font-medium">{p.name}</span>{" "}
              <span className="text-sm">
                {p.clockIn ? `In ${timeLabel(p.clockIn, undefined, timeZone)}` : "Not clocked in"}
                {p.clockOut ? ` · Out ${timeLabel(p.clockOut, undefined, timeZone)}` : p.clockIn ? " · Still clocked in" : ""}
                {p.workedMinutes !== null ? ` · ${formatWorked(p.workedMinutes)}` : ""}
              </span>
              {p.punchFlags.length > 0 && <span className="block text-xs text-[#9A7049]">{p.punchFlags.map((f) => FLAG_LABELS[f as PunchFlag] ?? f).join(", ")}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-[#A39585] mt-1">Correct or approve punches on Timesheets.</p>
    </section>
  );
}
