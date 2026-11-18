// What GHL sent when the client booked: the raw package summary (line breaks
// kept) and the booked values beside it. Admins and managers only: it has the
// discount and gratuity amounts, so the page renders it only for them.

import type { BookingSummary } from "@/lib/booking-summary";

const dollars = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export default function BookingSummaryCard({ summary }: { summary: BookingSummary }) {
  const rows: [string, string][] = [];
  if (summary.bookedStart) rows.push(["Booked start", summary.bookedStart]);
  if (summary.bartenders) rows.push(["Bartenders booked", String(summary.bartenders)]);
  if (summary.tipPerBartender !== null) rows.push(["Tip per bartender", dollars(summary.tipPerBartender)]);
  if (summary.promoCode) rows.push(["Promo code", summary.promoCode]);
  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3" aria-label="Booking summary">
      <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Booking summary</h2>
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm text-[#2C2420] mb-2">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[#6B5D52]">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {summary.text && <p className="whitespace-pre-wrap break-words text-sm text-[#2C2420]">{summary.text}</p>}
      <p className="text-xs text-[#A39585] mt-1">As booked through GHL. Admins and managers only.</p>
    </section>
  );
}
