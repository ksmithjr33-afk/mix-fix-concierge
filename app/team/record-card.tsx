import { recordRows, NEW_UNDER, RECORD_DAYS } from "@/lib/team/reliability";
import type { StaffRecord } from "@/lib/team/reliability-db";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

// The full reliability record: last 90 days next to all time. Server rendered.
export default function RecordCard({ record, title = "Reliability record" }: { record: StaffRecord; title?: string }) {
  const recent = recordRows(record.last90);
  const all = recordRows(record.allTime);
  return (
    <section className={card} aria-label={title}>
      <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">{title}</h2>
      {record.allTime.isNew && (
        <p className="text-sm text-[#6B5D52] mb-2">
          <span className="font-bold uppercase tracking-wide text-[11px] px-1.5 py-0.5 rounded bg-[#E8DDD5] text-[#6B5D52] mr-1">New</span>
          Percentages show after {NEW_UNDER} events worked.
        </p>
      )}
      <table className="w-full text-[15px]">
        <thead>
          <tr className="text-xs text-[#6B5D52]">
            <th className="text-left font-medium py-1"></th>
            <th className="text-right font-medium py-1 pl-2 whitespace-nowrap">Last {RECORD_DAYS} days</th>
            <th className="text-right font-medium py-1 pl-2 whitespace-nowrap">All time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#DDD5CC]">
          {all.map((row, i) => (
            <tr key={row.label}>
              <td className="py-1.5 text-[#2C2420]">{row.label}</td>
              <td className="py-1.5 pl-2 text-right text-[#2C2420] whitespace-nowrap">{recent[i].value}</td>
              <td className="py-1.5 pl-2 text-right text-[#2C2420] whitespace-nowrap">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-[#6B5D52] mt-2">On time means clocked in at or before arrival time. Bar ready counts the first photo before service starts.</p>
    </section>
  );
}
