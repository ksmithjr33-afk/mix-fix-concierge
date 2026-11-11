import Link from "next/link";
import type { AssigneeProgress } from "@/lib/team/assignments-db";
import type { MissingReport } from "@/lib/team/events";
import { timeLabel } from "@/lib/team/clock-label";
import { FLAG_LABELS, formatWorked, type PunchFlag } from "@/lib/team/clock";

// The manager view's Day of tab, read only: each person's checklist and
// shopping progress, "Something is missing" reports, and the time punches for
// this event. The bar ready photos and closeouts sit around it on the tab.

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

export function ChecklistProgress({ people, timeZone }: { people: AssigneeProgress[]; timeZone: string }) {
  const on = people.filter((p) => p.status !== "declined");
  return (
    <section className={card}>
      <h2 className="font-heading text-base font-bold text-[#2C2420] mb-2">Checklist progress</h2>
      {on.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">Nobody on this event yet.</p>
      ) : (
        <ul className="divide-y divide-[#DDD5CC]">
          {on.map((p) => (
            <li key={p.staffId} className="py-3 space-y-2">
              <p className="font-medium text-[#2C2420]">
                {p.name}
                {p.status === "offered" && <span className="ml-2 text-xs font-normal text-[#9A7049]">waiting for reply</span>}
              </p>
              <Bar label="Checklist" checked={p.checklist.checked} total={p.checklist.total} />
              <Bar label="Shopping list" checked={p.shopping.checked} total={p.shopping.total} />
              <p className="text-xs text-[#6B5D52]">
                {p.confirmedAt ? `Has everything, confirmed ${timeLabel(p.confirmedAt, undefined, timeZone)}` : "Has not confirmed the checklist"}
                {p.barReadyAt ? ` · Bar ready ${timeLabel(p.barReadyAt, undefined, timeZone)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MissingReports({ reports, timeZone }: { reports: MissingReport[]; timeZone: string }) {
  return (
    <section className={`${card} ${reports.length ? "border-[#E3C9A0] bg-[#FFF8EC]" : ""}`}>
      <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Missing item reports</h2>
      {reports.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">No one has reported anything missing.</p>
      ) : (
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
