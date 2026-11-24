import Link from "next/link";
import type { EventAvailability } from "@/lib/team/delivery-availability";

/**
 * Deliveries and pickups for everyone on the event, so whoever orders sees it
 * without opening a profile: on the Team tab and at the top of the Shopping
 * list tab. The day before and the day of the event, then "See the whole week".
 * Admin side only. Only times, home, preference and the note.
 */
export default function DeliveryStrip({ people }: { people: { staffId: string; name: string; availability: EventAvailability }[] }) {
  if (people.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 space-y-2" aria-label="Deliveries and pickups for the team">
      <h2 className="font-heading text-base font-bold text-[#2C2420]">Deliveries and pickups</h2>
      <ul className="divide-y divide-[#DDD5CC]">
        {people.map(({ staffId, name, availability: a }) => (
          <li key={staffId} className="py-2 text-[15px] text-[#2C2420]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/team/admin/staff/${staffId}`} className="font-medium underline decoration-[#DDD5CC]">
                {name}
              </Link>
              <span className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${a.confirmed ? "bg-[#E4EBDF] text-[#55684A]" : "bg-[#F6E3DC] text-[#A0412D]"}`}>
                {a.confirmed ? "Confirmed this week" : "Not confirmed this week"}
              </span>
            </div>
            {a.set ? (
              <>
                <p className="text-sm text-[#6B5D52]">
                  Deliveries: {a.receive} · Pickups: {a.pickup}
                  {[a.home, a.pref].filter(Boolean).length ? ` · ${[a.home, a.pref].filter(Boolean).join(" · ")}` : ""}
                </p>
                {a.notes && <p className="text-sm text-[#6B5D52]">Note: {a.notes}</p>}
                <details className="text-sm text-[#6B5D52]">
                  <summary className="cursor-pointer text-[#B5845A]">See the whole week</summary>
                  <table className="mt-1 text-left">
                    <tbody>
                      {a.full.map((d) => (
                        <tr key={d.day}>
                          <th className="pr-3 font-medium">{d.day}</th>
                          <td className="pr-3">Deliveries: {d.receive}</td>
                          <td>Pickups: {d.pickup}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </>
            ) : (
              <p className="text-sm text-[#6B5D52]">Times not filled in yet.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
