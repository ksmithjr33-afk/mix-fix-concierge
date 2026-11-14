import Link from "next/link";
import type { SaveAlerts as Alerts } from "@/lib/unsaved-sessions-db";
import { longDate } from "@/lib/team/time";

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Top of the admin Staffing page: clients who finished the concierge but did
// not save, and saved events whose date was already past when they booked.
// Renders nothing when there is nothing to check.
export default function SaveAlerts({ alerts }: { alerts: Alerts | null }) {
  if (!alerts || (alerts.unsaved.length === 0 && alerts.pastDate.length === 0 && alerts.stale.length === 0 && alerts.pricePending.length === 0)) return null;
  return (
    <div className="space-y-3" role="alert">
      {alerts.unsaved.length > 0 && (
        <section className="rounded-xl border-2 border-[#B3261E] bg-[#FDECEA] p-4 space-y-2">
          <h2 className="font-semibold text-[#8C1D18]">
            {alerts.unsaved.length === 1 ? "1 client finished the concierge but did not save" : `${alerts.unsaved.length} clients finished the concierge but did not save`}
          </h2>
          <p className="text-sm text-[#6B5D52]">These are missing from every team list. Their conversation is kept. Nothing was sent to them.</p>
          <ul className="text-sm text-[#2C2420] space-y-1">
            {alerts.unsaved.map((u) => (
              <li key={u.sessionId}>
                <span className="font-medium">{u.name}</span> · event {u.eventDate} · finished {when(u.finishedAt)} · session {u.sessionId.slice(0, 8)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {alerts.pricePending.length > 0 && (
        <section className="rounded-xl border-2 border-[#B3261E] bg-[#FDECEA] p-4 space-y-2">
          <h2 className="font-semibold text-[#8C1D18]">
            Price needed: {alerts.pricePending.length} {alerts.pricePending.length === 1 ? "event" : "events"}
          </h2>
          <p className="text-sm text-[#6B5D52]">A client change is saved but could not be priced. Set the new total on the event.</p>
          <ul className="text-sm space-y-1">
            {alerts.pricePending.map((p) => (
              <li key={p.sessionId}>
                <Link href={`/team/admin/e/${p.sessionId}`} className="text-[#B5845A] underline">
                  {p.name}
                </Link>{" "}
                · {p.summary}
              </li>
            ))}
          </ul>
        </section>
      )}
      {alerts.stale.length > 0 && (
        <section className="rounded-xl border border-[#E0B04A] bg-[#FFF8EC] p-4 space-y-2">
          <h2 className="font-semibold text-[#2C2420]">Possibly stale booking details, check with the client</h2>
          <p className="text-sm text-[#6B5D52]">A repeat client&apos;s new booking arrived with the same details as their earlier event. The booking system may have copied the old ones.</p>
          <ul className="text-sm space-y-1">
            {alerts.stale.map((b) => (
              <li key={b.sessionId}>
                {b.submitted ? (
                  <Link href={`/team/admin/e/${b.sessionId}`} className="text-[#B5845A] underline">
                    {b.name}
                  </Link>
                ) : (
                  <span className="font-medium">{b.name}</span>
                )}{" "}
                · same {b.fields.join(", ")} as their earlier booking · booked {when(b.createdAt)}
                {b.submitted ? "" : " · has not finished the concierge"}
              </li>
            ))}
          </ul>
        </section>
      )}
      {alerts.pastDate.length > 0 && (
        <section className="rounded-xl border border-[#E0B04A] bg-[#FFF8EC] p-4 space-y-2">
          <h2 className="font-semibold text-[#2C2420]">
            {alerts.pastDate.length === 1 ? "1 event was booked with a date that had already passed" : `${alerts.pastDate.length} events were booked with a date that had already passed`}
          </h2>
          <p className="text-sm text-[#6B5D52]">They only show under Past events. Usually the year is wrong. Confirm the date with the client, then fix it on the event.</p>
          <ul className="text-sm space-y-1">
            {alerts.pastDate.map((p) => (
              <li key={p.sessionId}>
                <Link href={`/team/admin/e/${p.sessionId}`} className="text-[#B5845A] underline">
                  {p.name}
                </Link>{" "}
                · saved as {longDate(p.eventDate)} · booked {when(p.submittedAt)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
