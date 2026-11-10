import type { ShiftSummary } from "@/lib/team/shifts";
import type { SameDayEvent } from "@/lib/team/shifts-db";

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="py-2.5 border-b border-[#DDD5CC] last:border-0">
      <dt className="text-xs text-[#A39585] uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-[15px] text-[#2C2420]">{value}</dd>
    </div>
  );
}

/** A posted shift: only the allowlisted summary. No client name, address, contact details, or pricing. */
export default function ShiftCard({ shift, sameDay }: { shift: ShiftSummary; sameDay: SameDayEvent[] }) {
  const service = shift.serviceStart && shift.serviceEnd ? `${shift.serviceStart} to ${shift.serviceEnd}` : shift.serviceStart;
  const pacific = shift.timeZone === "America/Los_Angeles";
  return (
    <section className={card}>
      {shift.cover && <p className="text-[11px] font-bold uppercase tracking-wide text-[#A0412D] mb-1">Cover needed</p>}
      <dl>
        <Row label="Date" value={shift.date} />
        <Row label="Arrive" value={shift.arrival ? `${shift.arrival}${pacific ? " Pacific time" : ""}` : "Time to be confirmed"} />
        <Row label="Service" value={service ? `${service}${pacific ? " Pacific time" : ""}` : ""} />
        <Row label="City" value={shift.city} />
        <Row label="Event" value={shift.eventType} />
        <Row label="Guests" value={shift.guestCount} />
        <Row label="Package" value={shift.package} />
        <Row label="Bartenders" value={shift.bartenders ? String(shift.bartenders) : ""} />
        <Row label="Open spots" value={shift.cover ? "1" : String(shift.spotsOpen)} />
      </dl>
      <div className="pt-2.5">
        {sameDay.length === 0 ? (
          <p className="text-sm text-[#6B5D52]">You have no other event that day.</p>
        ) : (
          sameDay.map((e, i) => (
            <p key={i} className={`text-sm ${e.overlaps ? "text-[#A0412D]" : "text-[#9A7049]"}`}>
              You are on {e.title} that day{e.arrival ? `, arrive ${e.arrival}` : ""}.{e.overlaps ? " The times overlap." : ""}
            </p>
          ))
        )}
      </div>
    </section>
  );
}
