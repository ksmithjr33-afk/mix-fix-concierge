import Link from "next/link";
import { ESTIMATE_NOTE, PROFILE_HREF, hoursText, mileageText, money, rateSourceText, rateText, tipsText, type StaffEstimate } from "@/lib/team/pay";

// The signed in person's own estimate: Hourly, Mileage, Tips, Total. Never anyone
// else's, and nothing from the booking. Shown on an open shift before accepting
// and on the event page after.
export default function PayEstimateCard({ estimate: e }: { estimate: StaffEstimate }) {
  const row = "flex items-baseline justify-between gap-3 py-1.5";
  const label = "text-[15px] text-[#2C2420]";
  const sub = "block text-xs text-[#6B5D52]";
  const amount = "font-heading font-bold tabular-nums text-[#2C2420]";
  return (
    <section className="rounded-2xl bg-[#E4EBDF] px-4 py-3" aria-label="Your pay estimate">
      <h2 className="font-heading text-base font-bold text-[#2C2420]">Your pay estimate</h2>
      <div className="divide-y divide-[#C9D6C0]">
        <div className={row}>
          <span className={label}>
            Hourly (estimate)
            <span className={sub}>{e.minutes !== null ? `${hoursText(e.minutes)} hours at ${rateText(e.rateCents)}, ${rateSourceText({ source: e.rateSource, pkg: e.ratePkg })}` : "Times not set yet"}</span>
          </span>
          <span className={amount}>{e.hourlyCents !== null ? money(e.hourlyCents) : "—"}</span>
        </div>
        <div className={row}>
          <span className={label}>
            Mileage (estimate)
            <span className={sub}>
              {e.mileage.state === "no_address" || e.mileage.state === "not_found" ? (
                <Link href={PROFILE_HREF} className="text-[#B5845A] underline">
                  {mileageText(e.mileage)}
                </Link>
              ) : (
                mileageText(e.mileage)
              )}
            </span>
          </span>
          <span className={amount}>{e.mileage.state === "paid" ? money(e.mileage.cents) : "—"}</span>
        </div>
        <div className={row}>
          <span className={label}>
            Tips (estimate)
            <span className={sub}>{tipsText(e.tips)}</span>
          </span>
          <span className={amount}>{e.tips.state === "on_file" ? money(e.tips.cents) : "—"}</span>
        </div>
        <div className={row}>
          <span className={`${label} font-semibold`}>Total (estimate)</span>
          <span className={`${amount} text-lg`}>{money(e.totalCents)}</span>
        </div>
      </div>
      <p className="text-xs text-[#55684A] mt-1">{ESTIMATE_NOTE}</p>
    </section>
  );
}
