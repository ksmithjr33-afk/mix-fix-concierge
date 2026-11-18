import Link from "next/link";
import { requireFullAdmin } from "@/lib/team/auth";
import { chicagoToday } from "@/lib/team/time";
import { money } from "@/lib/team/pay";
import { COST_KEYS, COST_LABEL, profitTitle } from "@/lib/team/business";
import { RANGE_LABEL, breakdown, cashView, completeness, rangeFor, totalsOf, type RangePreset, type Totals } from "@/lib/team/business-overview";
import { cashEvents, overviewEvents } from "@/lib/team/business-overview-db";
import { costSettings, mileageSettings, suppliesSettings } from "@/lib/team/business-settings-db";
import { managerHref } from "@/lib/team/manager-tabs";
import TeamHeader from "../../team-header";
import SettingsForm from "./settings-form";

export const dynamic = "force-dynamic";

// Business overview: admins only (role admin, never managers). Totals count
// complete events only; incomplete events are listed and counted on their own.
const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";
const h2 = "font-heading text-base font-bold text-[#2C2420] mb-1";
const dateText = (ymd: string | null) => {
  if (!ymd) return "no date";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
};

export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const p = await searchParams;
  const me = await requireFullAdmin("/team/admin/business");
  const today = chicagoToday();
  const range = rangeFor(p.range, today, p.from, p.to);
  const [events, cash, mileage, costs, perGuest] = await Promise.all([overviewEvents(me, range.from, range.to), cashEvents(me, today), mileageSettings(), costSettings(me), suppliesSettings(me)]);
  const totals = totalsOf(events);
  const done = completeness(events);
  const byPackage = breakdown(events, (e) => e.package);
  const byMarket = breakdown(events, (e) => e.market);
  const money$ = cashView(cash, today);
  const qs = `from=${range.from}&to=${range.to}`;

  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Business</h1>
          <p className="text-[15px] text-[#6B5D52]">
            {dateText(range.from)} to {dateText(range.to)}
          </p>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Date range">
          {(["this_month", "last_month", "next_30"] as RangePreset[]).map((k) => (
            <Link key={k} href={`/team/admin/business?range=${k}`} className={`rounded-full px-3 py-2 text-sm min-h-[44px] inline-flex items-center ${range.preset === k ? "bg-[#2C2420] text-white" : "bg-[#EFE8E0] text-[#2C2420]"}`}>
              {RANGE_LABEL[k]}
            </Link>
          ))}
          <form className="flex flex-wrap items-center gap-2" action="/team/admin/business">
            <input type="hidden" name="range" value="custom" />
            <input type="date" name="from" defaultValue={range.from} aria-label="From" className="rounded-lg border border-[#DDD5CC] px-2 py-2 text-[16px]" />
            <input type="date" name="to" defaultValue={range.to} aria-label="To" className="rounded-lg border border-[#DDD5CC] px-2 py-2 text-[16px]" />
            <button className={`rounded-full px-3 py-2 text-sm min-h-[44px] ${range.preset === "custom" ? "bg-[#2C2420] text-white" : "bg-[#EFE8E0] text-[#2C2420]"}`}>Custom</button>
          </form>
        </nav>

        <section className={card} aria-label="Data completeness">
          <h2 className={h2}>Data completeness</h2>
          <p className="text-[15px] text-[#2C2420]">
            <span className="font-semibold">
              {done.withTotal} of {done.events}
            </span>{" "}
            events have a total on file. {done.complete} complete, {done.incomplete} incomplete.
          </p>
          {done.incomplete > 0 && (
            <p className="text-sm text-[#9A7049]">
              Incomplete events are left out of the totals below{done.incompleteRevenueCents ? ` (${money(done.incompleteRevenueCents)} in totals on file)` : ""}.
            </p>
          )}
          {done.gaps.length > 0 && (
            <ul className="mt-2 divide-y divide-[#EFE8E0]">
              {done.gaps.map((g) => (
                <li key={g.sessionId} className="py-1.5">
                  <Link href={managerHref(g.sessionId, "business")} className="text-[15px] text-[#B5845A] underline">
                    {g.title}
                  </Link>
                  <span className="text-sm text-[#6B5D52]"> · {dateText(g.day)}</span>
                  <span className="block text-sm text-[#2C2420]">
                    {g.missing.map((m, i) => (
                      <span key={m.key}>
                        {i > 0 && ", "}
                        {m.key === "per_guest" ? (
                          <a href="#settings" className="text-[#B5845A] underline">
                            {m.text}
                          </a>
                        ) : (
                          m.text
                        )}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-label="Totals">
          <h2 className={h2}>Totals, complete events</h2>
          <TotalsList t={totals} />
        </section>

        <section className={card} aria-label="By package">
          <h2 className={h2}>By package</h2>
          <Breakdown rows={byPackage} />
        </section>
        <section className={card} aria-label="By market">
          <h2 className={h2}>By market</h2>
          <Breakdown rows={byMarket} />
          <p className="text-xs text-[#A39585] mt-1">By lead source: lead source is not stored yet, so there is no breakdown.</p>
        </section>

        <section className={card} aria-label="Cash">
          <h2 className={h2}>Cash</h2>
          <dl className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0.5 text-[15px] tabular-nums">
            <dt />
            <dd className="text-xs text-[#6B5D52] text-right">Balances due</dd>
            <dd className="text-xs text-[#6B5D52] text-right">Est. payroll</dd>
            <dt>Next 30 days</dt>
            <dd className="text-right">{money(money$.next30.balancesDueCents)}</dd>
            <dd className="text-right">{money(money$.next30.payrollCents)}</dd>
            <dt>Next 60 days</dt>
            <dd className="text-right">{money(money$.next60.balancesDueCents)}</dd>
            <dd className="text-right">{money(money$.next60.payrollCents)}</dd>
          </dl>
          {money$.next60.unknownBalances > 0 && <p className="text-sm text-[#9A7049]">{money$.next60.unknownBalances} balances due with no total on file are not counted.</p>}
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[#6B5D52]">
                  <th className="font-normal py-1">Week of</th>
                  <th className="font-normal text-right">Balances due</th>
                  <th className="font-normal text-right">Est. payroll</th>
                </tr>
              </thead>
              <tbody>
                {money$.weeks.map((w) => (
                  <tr key={w.week} className="border-t border-[#EFE8E0]">
                    <td className="py-1">{dateText(w.week)}</td>
                    <td className="text-right">
                      {money(w.balancesDueCents)}
                      {w.unknownBalances > 0 && <span className="text-xs text-[#9A7049]"> +{w.unknownBalances} unknown</span>}
                    </td>
                    <td className="text-right">{money(w.payrollCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="text-sm font-semibold text-[#2C2420] mt-3">Unpaid balances inside 14 days of the event</h3>
          {money$.overdue.length === 0 ? (
            <p className="text-sm text-[#6B5D52]">None.</p>
          ) : (
            <ul className="divide-y divide-[#EFE8E0]">
              {money$.overdue.map((o) => (
                <li key={o.sessionId} className="py-1.5 flex flex-wrap justify-between gap-x-3">
                  <Link href={managerHref(o.sessionId, "business")} className="text-[15px] text-[#B5845A] underline">
                    {o.title}
                  </Link>
                  <span className="text-sm tabular-nums">
                    {dateText(o.day)} · {o.balanceCents === null ? "total not on file" : money(o.balanceCents)} · {o.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-label="Events">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h2 className="font-heading text-base font-bold text-[#2C2420]">Events</h2>
            <a href={`/api/team/admin/business/export?${qs}`} className="rounded-lg bg-[#B5845A] text-white px-3 py-2 text-sm font-medium">
              Export CSV
            </a>
          </div>
          {events.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">No events in this range.</p>
          ) : (
            <ul className="divide-y divide-[#EFE8E0]">
              {[...events]
                .sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""))
                .map((e) => (
                  <li key={e.sessionId} className="py-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                    <span>
                      <Link href={managerHref(e.sessionId, "business")} className="text-[15px] text-[#B5845A] underline">
                        {e.title}
                      </Link>
                      <span className="text-sm text-[#6B5D52]"> · {dateText(e.day)} · {e.package} · {e.market}</span>
                    </span>
                    <span className="text-sm tabular-nums text-right">
                      {e.business.revenue.totalCents === null ? "no total" : money(e.business.revenue.totalCents)} ·{" "}
                      {e.business.complete ? (
                        <>
                          {profitTitle(e.business)} {money(e.business.profitCents ?? 0)}
                          {e.business.marginPct !== null && ` (${e.business.marginPct}%)`}
                        </>
                      ) : (
                        <span className="text-[#9A7049]">{e.business.missing.map((m) => m.text).join(", ")}</span>
                      )}
                      <span className="block text-xs text-[#6B5D52]">
                        Collected {money(e.business.revenue.collectedCents)} ·{" "}
                        {e.business.revenue.overpaidCents ? (
                          <span className="text-[#A0412D]">Overpaid by {money(e.business.revenue.overpaidCents)}</span>
                        ) : e.business.revenue.balanceCents === null ? (
                          "remaining unknown"
                        ) : (
                          `${money(e.business.revenue.balanceCents)} remaining`
                        )}
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className={card} aria-label="Supply costs">
          <h2 className={h2}>Supply costs</h2>
          <p className="text-[15px] text-[#2C2420]">
            <Link href="/team/admin/business/supplies" className="text-[#B5845A] underline">
              Open the cost catalog
            </Link>{" "}
            to set what each product costs and import a CSV. Shopping list lines we buy are matched by name or alias.
          </p>
        </section>

        <SettingsForm mileage={mileage} costs={costs!} perGuest={perGuest!} />
      </main>
    </>
  );
}

function TotalsList({ t }: { t: Totals }) {
  const row = "flex justify-between gap-3 py-1 text-[15px] tabular-nums";
  return (
    <div className="divide-y divide-[#EFE8E0]">
      <div className={row}>
        <span>Events</span>
        <span>{t.events}</span>
      </div>
      <div className={row}>
        <span>Revenue</span>
        <span>{money(t.revenueCents)}</span>
      </div>
      {COST_KEYS.map((k) => (
        <div key={k} className={`${row} text-[#6B5D52]`}>
          <span className="pl-3">{COST_LABEL[k]}</span>
          <span>{money(t.costs[k])}</span>
        </div>
      ))}
      <div className={`${row} font-semibold`}>
        <span>Profit</span>
        <span>{money(t.profitCents)}</span>
      </div>
      <div className={row}>
        <span>Margin</span>
        <span>{t.marginPct === null ? "—" : `${t.marginPct}%`}</span>
      </div>
      <div className={row}>
        <span>Profit per event</span>
        <span>{t.profitPerEventCents === null ? "—" : money(t.profitPerEventCents)}</span>
      </div>
      <div className={row}>
        <span>Average ticket</span>
        <span>{t.averageTicketCents === null ? "—" : money(t.averageTicketCents)}</span>
      </div>
    </div>
  );
}

function Breakdown({ rows }: { rows: { key: string; totals: Totals; incomplete: number }[] }) {
  if (rows.length === 0) return <p className="text-[15px] text-[#6B5D52]">No events in this range.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-[#6B5D52]">
            <th className="font-normal py-1" />
            <th className="font-normal text-right">Events</th>
            <th className="font-normal text-right">Revenue</th>
            <th className="font-normal text-right">Profit</th>
            <th className="font-normal text-right">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-[#EFE8E0]">
              <td className="py-1">{r.key}</td>
              <td className="text-right">
                {r.totals.events}
                {r.incomplete > 0 && <span className="text-xs text-[#9A7049]"> +{r.incomplete} incomplete</span>}
              </td>
              <td className="text-right">{money(r.totals.revenueCents)}</td>
              <td className="text-right">{money(r.totals.profitCents)}</td>
              <td className="text-right">{r.totals.marginPct === null ? "—" : `${r.totals.marginPct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
