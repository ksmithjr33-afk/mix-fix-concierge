import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireFullAdmin } from "@/lib/team/auth";
import { chicagoToday } from "@/lib/team/time";
import { money } from "@/lib/team/pay";
import { weekLabel } from "@/lib/team/timesheet";
import { choosePeriod, PERIOD_COOKIE, PERIOD_LABEL, PAYROLL_PATH, type PeriodKey } from "@/lib/team/payroll";
import { payrollView } from "@/lib/team/payroll-db";
import TeamHeader from "../../team-header";
import PayrollBoard from "./payroll-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payroll", robots: { index: false, follow: false } };

// Payroll: admins only (role admin, never managers), the same check as Business.
// Everything to run payroll for a pay period, and a hand kept paid record.
const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";
const pill = (on: boolean) => `rounded-full px-3 py-2 text-sm min-h-[44px] inline-flex items-center ${on ? "bg-[#2C2420] text-white" : "bg-[#EFE8E0] text-[#2C2420]"}`;

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const p = await searchParams;
  const me = await requireFullAdmin(PAYROLL_PATH);
  const today = chicagoToday();
  const period = choosePeriod({ period: p.period, from: p.from, to: p.to }, (await cookies()).get(PERIOD_COOKIE)?.value, today);
  const view = (await payrollView(me, period))!;
  const s = view.summary;
  const qs = `from=${period.from}&to=${period.to}`;

  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Payroll</h1>
          <p className="text-[15px] text-[#6B5D52]">{weekLabel(period.from, period.to)}</p>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Pay period">
          {(["this_week", "last_week", "last_two_weeks"] as PeriodKey[]).map((k) => (
            <Link key={k} href={`${PAYROLL_PATH}?period=${k}`} className={pill(period.key === k)}>
              {PERIOD_LABEL[k]}
            </Link>
          ))}
          <form className="flex flex-wrap items-center gap-2" action={PAYROLL_PATH}>
            <input type="hidden" name="period" value="custom" />
            <input type="date" name="from" defaultValue={period.from} aria-label="From" className="rounded-lg border border-[#DDD5CC] px-2 py-2 text-[16px]" />
            <input type="date" name="to" defaultValue={period.to} aria-label="To" className="rounded-lg border border-[#DDD5CC] px-2 py-2 text-[16px]" />
            <button className={pill(period.key === "custom")}>Custom</button>
          </form>
        </nav>

        <section className={card} aria-label="Summary">
          <dl className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2 tabular-nums">
            <Stat label="Total owed" value={money(s.owedCents)} />
            <Stat label="Paid" value={money(s.paidCents)} />
            <Stat label="Unpaid" value={money(s.unpaidCents)} />
            <Stat label="People" value={String(s.people)} />
            <Stat label="Need attention" value={String(s.attention)} warn={s.attention > 0} />
          </dl>
          <p className="text-xs text-[#6B5D52] mt-2">
            Totals are hours times rate plus mileage and tips. Overtime pay is not figured here; the payroll provider does that.
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm">
            <a href={`/api/team/admin/payroll/export?kind=lines&${qs}`} className="text-[#B5845A] underline">
              Download lines CSV
            </a>
            <a href={`/api/team/admin/payroll/export?kind=people&${qs}`} className="text-[#B5845A] underline">
              Download people CSV
            </a>
          </p>
        </section>

        {!view.ready && (
          <p className={`${card} text-[15px] text-[#9A7049]`}>Paid records are not set up yet, so everything shows as unpaid and nothing can be marked paid until the payroll migration runs.</p>
        )}

        <PayrollBoard key={`${period.from}:${period.to}`} view={view} today={today} />
      </main>
    </>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#A39585]">{label}</dt>
      <dd className={`font-heading text-lg font-bold ${warn ? "text-[#A0412D]" : "text-[#2C2420]"}`}>{value}</dd>
    </div>
  );
}
