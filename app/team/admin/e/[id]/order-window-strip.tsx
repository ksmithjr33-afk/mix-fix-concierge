import Link from "next/link";
import type { EventOrderWindows } from "@/lib/team/order-window-db";
import { ITEM_TITLE, NEEDED_LABEL } from "@/lib/team/order-window";

/**
 * Order windows for everyone on the event, so whoever orders sees them without
 * opening a profile: on the Team tab and at the top of the Shopping list tab.
 * Each person's answer (Delivery or Pickup, the windows, the note), or "Order
 * window needed" in red. Home and the usual note come from their profile.
 * Admin side only. Hidden on events where we buy nothing.
 */
export default function OrderWindowStrip({ data }: { data: EventOrderWindows | null }) {
  if (!data || !data.asks || data.people.length === 0) return null;
  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 space-y-2" aria-label="Order windows for the team" data-order-windows>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-bold text-[#2C2420]">{ITEM_TITLE}s</h2>
        {data.placed && <span className="text-sm text-[#55684A]">Order placed: answers are locked</span>}
      </div>
      <ul className="divide-y divide-[#DDD5CC]">
        {data.people.map((p) => (
          <li key={p.staffId} className="py-2 text-[15px] text-[#2C2420]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/team/admin/staff/${p.staffId}`} className="font-medium underline decoration-[#DDD5CC]">
                {p.name}
              </Link>
              {p.needed && (
                <span className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${p.urgent ? "bg-[#A0412D] text-white" : "bg-[#F6E3DC] text-[#A0412D]"}`} data-order-window-needed>
                  {NEEDED_LABEL}
                </span>
              )}
              {!p.accepted && <span className="text-sm text-[#6B5D52]">Not accepted yet</span>}
              {p.method && <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#E4EBDF] text-[#55684A]">{p.method}</span>}
            </div>
            {p.windows.length > 0 && <p className="text-sm text-[#2C2420]">{p.windows.join(" · ")}</p>}
            {p.note && <p className="text-sm text-[#6B5D52]">Note: {p.note}</p>}
            {(p.home || p.profileNote) && (
              <p className="text-xs text-[#6B5D52]">
                Profile: {[p.home, p.pref, p.profileNote].filter(Boolean).join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
