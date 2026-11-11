import Link from "next/link";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/team/auth";
import { myPayRows } from "@/lib/team/pay-db";
import { hoursText, money, payTotals, rateText, PAY_LABEL, PAY_NOTE } from "@/lib/team/pay";
import { todayFor } from "@/lib/team/availability-db";
import { shortDate } from "@/lib/team/time";
import TeamHeader from "../team-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My pay", robots: { index: false, follow: false } };

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

function monthBounds(ym: string): { from: string; to: string; prev: string; next: string; label: string } {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), prev, next, label: first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

// A staff member's own pay estimates, one month at a time. Only ever the signed in person's.
export default async function MyPayPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const staff = await requireStaff("/team/pay");
  const { m } = await searchParams;
  const today = await todayFor(staff.id);
  const month = typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : today.slice(0, 7);
  const b = monthBounds(month);
  const { rate, rows } = await myPayRows(staff.id, b.from, b.to);
  const totals = payTotals(rows);
  const monthTotal = totals.months.find((t) => t.month === month)?.cents ?? 0;
  return (
    <>
      <TeamHeader signedIn admin={staff.role === "admin"} back={{ href: "/team/me", label: "Me" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">My pay</h1>
          <p className="text-[15px] text-[#6B5D52]">{PAY_NOTE}</p>
          {rate && <p className="text-sm text-[#6B5D52] mt-1">Your rate: {rateText(rate)}</p>}
        </div>
        {!rate ? (
          <p className={`${card} text-[15px] text-[#6B5D52]`}>No hourly rate is set for you yet, so there is no pay to show. Ask an admin.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 px-1">
              <Link href={`/team/pay?m=${b.prev}`} className="text-sm text-[#B5845A] underline">
                Previous
              </Link>
              <p className="text-[15px] font-medium text-[#2C2420]">{b.label}</p>
              <Link href={`/team/pay?m=${b.next}`} className="text-sm text-[#B5845A] underline">
                Next
              </Link>
            </div>
            <section className={card}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-heading text-base font-bold text-[#2C2420]">Month total</h2>
                <span className="font-heading text-lg font-bold text-[#2C2420] tabular-nums">{money(monthTotal)}</span>
              </div>
              <p className="text-xs text-[#6B5D52]">{PAY_LABEL}</p>
              {totals.weeks.length > 0 && (
                <ul className="mt-2 divide-y divide-[#DDD5CC]">
                  {totals.weeks.map((w) => (
                    <li key={w.week} className="flex justify-between py-1.5 text-[15px] text-[#2C2420]">
                      <span>Week of {shortDate(w.week)}</span>
                      <span className="tabular-nums">{money(w.cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className={card}>
              <h2 className="font-heading text-base font-bold text-[#2C2420] mb-1">Events</h2>
              {rows.length === 0 ? (
                <p className="text-[15px] text-[#6B5D52]">No events this month.</p>
              ) : (
                <ul className="divide-y divide-[#DDD5CC]">
                  {rows.map((r) => (
                    <li key={r.sessionId} className="py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link href={`/team/e/${r.sessionId}`} className="min-w-0 font-medium text-[#2C2420] break-words">
                          {r.day ? shortDate(r.day) : "No date"} · {r.title}
                        </Link>
                        <span className="shrink-0 font-heading font-bold text-[#2C2420] tabular-nums">{r.payCents === null ? "--" : money(r.payCents)}</span>
                      </div>
                      <p className="text-xs text-[#6B5D52]">
                        Scheduled {r.scheduledMinutes === null ? "--" : `${hoursText(r.scheduledMinutes)} h`} · Approved {r.approvedMinutes === null ? "not yet" : `${hoursText(r.approvedMinutes)} h`}
                        {r.fromApproved ? " · from approved hours" : " · from scheduled hours"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
