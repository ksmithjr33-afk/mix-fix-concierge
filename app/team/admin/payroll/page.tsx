import Link from "next/link";
import type { Metadata } from "next";
import { requireFullAdmin } from "@/lib/team/auth";
import { chicagoToday } from "@/lib/team/time";
import { money } from "@/lib/team/pay";
import { weekLabel } from "@/lib/team/timesheet";
import { choosePeriod, dayLabel, lastWeek, PAYROLL_PATH, shiftWeek } from "@/lib/team/payroll";
import { REIMBURSEMENTS_NOT_READY } from "@/lib/team/reimbursements";
import { payrollView } from "@/lib/team/payroll-db";
import TeamHeader from "../../team-header";
import PayrollBoard from "./payroll-board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payroll", robots: { index: false, follow: false } };

// Payroll: admins only (role admin, never managers), the same check as Business.
// The weekly payout sheet: one pay week, Monday to Sunday, paid the next Monday.
// Opens on last week. A custom date range is the secondary option.
const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";
const arrow = "rounded-full px-3 py-2 text-sm min-h-[44px] inline-flex items-center bg-[#EFE8E0] text-[#2C2420]";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const p = await searchParams;
  const me = await requireFullAdmin(PAYROLL_PATH);
  const today = chicagoToday();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const period = choosePeriod({ week: one(p.week), from: one(p.from), to: one(p.to) }, today);
  const view = (await payrollView(me, period))!;
  const s = view.summary;
  const qs = `from=${period.from}&to=${period.to}`;
  const isWeek = period.key === "week";
  const last = lastWeek(today);
  const prev = shiftWeek(period, -1);
  const next = shiftWeek(period, 1);

  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Payroll</h1>
          <p className="text-[15px] text-[#2C2420]">
            {isWeek ? "Pay week" : "Custom range"} {weekLabel(period.from, period.to)}
          </p>
          {isWeek && <p className="text-[15px] font-semibold text-[#2C2420]">Pay date {dayLabel(period.payDate)}</p>}
        </div>

        <nav className="flex flex-wrap items-center gap-2" aria-label="Pay week">
          <Link href={`${PAYROLL_PATH}?week=${prev.from}`} className={arrow} aria-label="Previous week">
            ‹ Previous week
          </Link>
          {(!isWeek || period.from !== last.from) && (
            <Link href={PAYROLL_PATH} className={arrow}>
              Last week
            </Link>
          )}
          <Link href={`${PAYROLL_PATH}?week=${next.from}`} className={arrow} aria-label="Next week">
            Next week ›
          </Link>
          <details className="w-full sm:w-auto sm:ml-auto" open={!isWeek}>
            <summary className="cursor-pointer text-sm text-[#B5845A] underline min-h-[44px] inline-flex items-center">Custom range</summary>
            <form className="flex flex-wrap items-center gap-2 mt-1" action={PAYROLL_PATH}>
              <input type="date" name="from" defaultValue={period.from} aria-label="From" className="rounded-lg border border-[#DDD5CC] px-2 py-2 text-[16px]" />
              <input type="date" name="to" defaultValue={period.to} aria-label="To" className="rounded-lg border border-[#DDD5CC] px-2 py-2 text-[16px]" />
              <button className="rounded-full px-3 py-2 text-sm min-h-[44px] bg-[#2C2420] text-white">Show</button>
            </form>
          </details>
        </nav>

        <section className={card} aria-label="Summary">
          <dl className="grid grid-cols-2 sm:grid-cols-6 gap-x-4 gap-y-2 tabular-nums">
            <Stat label="Total to bartenders" value={money(s.owedCents)} />
            <Stat label="Paid" value={money(s.paidCents)} />
            <Stat label="Unpaid" value={money(s.unpaidCents)} />
            <Stat label="Events" value={String(s.events)} />
            <Stat label="People" value={String(s.people)} />
            <Stat label="Need attention" value={String(s.attention)} warn={s.attention > 0} />
          </dl>
          <p className="text-xs text-[#6B5D52] mt-2">
            Each amount is hours times rate, plus gas, reimbursements and the gratuity. The rate is the person&apos;s own rate when one is set on their profile, otherwise the package rate. Gratuity is split evenly among the bartenders. Overtime pay is not figured here; the payroll provider does that.
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm">
            <a href={`/api/team/admin/payroll/export?kind=sheet&${qs}`} className="text-[#B5845A] underline font-medium">
              Download payout sheet CSV
            </a>
            <a href={`/api/team/admin/payroll/export?kind=people&${qs}`} className="text-[#B5845A] underline">
              Download Pay Out CSV
            </a>
            <a href={`/api/team/admin/payroll/export?kind=lines&${qs}`} className="text-[#B5845A] underline">
              Download lines CSV
            </a>
          </p>
        </section>

        {!view.ready && (
          <p className={`${card} text-[15px] text-[#9A7049]`}>Paid records are not set up yet, so everything shows as unpaid and nothing can be marked paid until the payroll migration runs.</p>
        )}
        {view.ready && !view.reimbursementsReady && <p className={`${card} text-[15px] text-[#9A7049]`}>{REIMBURSEMENTS_NOT_READY}</p>}

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
