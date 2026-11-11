// The client's shopping list on their event page, built from the event as it
// is saved now with the same logic as the shopping list they are sent.

import { clientList } from "@/lib/client-list";

type EventData = Record<string, unknown>;

export default function ShoppingList({ data, pending }: { data: EventData; pending: boolean }) {
  const list = clientList(data);
  return (
    <section id="shopping-list" className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4 scroll-mt-4">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">Your shopping list</h2>
      <p className="text-xs text-[#A39585] mb-2">Always matches your latest saved event details.</p>
      {pending && (
        <p className="rounded-xl bg-[#FFF8EC] border border-[#E3C9A0] px-3 py-2 text-sm text-[#6B5D52] mb-3">
          A change you asked for is waiting for our team to approve. This list shows your event as it is saved now.
        </p>
      )}
      {list.sections.length === 0 ? (
        <p className="text-[15px] text-[#6B5D52]">There is nothing for you to buy on this package.</p>
      ) : (
        <div className="space-y-3">
          {list.sections.map((s) => (
            <div key={s.title}>
              <h3 className="text-xs text-[#A39585] uppercase tracking-wide mb-1">{s.title}</h3>
              <ul className="space-y-1">
                {s.lines.map((l) => (
                  <li key={l} className="text-[15px] text-[#2C2420] break-words">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {list.notes.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-[#DDD5CC] pt-3">
          {list.notes.map((n) => (
            <p key={n} className="text-sm text-[#6B5D52]">
              {n}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
