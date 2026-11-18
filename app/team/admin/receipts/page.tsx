import Link from "next/link";
import type { Metadata } from "next";
import { requireFullAdmin } from "@/lib/team/auth";
import { allReceipts } from "@/lib/team/receipts-db";
import {
  COMPANY_LABEL,
  filterQuery,
  filterReceipts,
  parseFilters,
  RECEIPT_KIND_LABEL,
  RECEIPT_KINDS,
  RECEIPT_STATUS_LABEL,
  RECEIPT_STATUSES,
  receiptPhotoHref,
  RECEIPTS_NOT_READY,
  RECEIPTS_PATH,
  receiptTotals,
} from "@/lib/team/receipts";
import { managerHref } from "@/lib/team/manager-tabs";
import { money } from "@/lib/team/pay";
import TeamHeader from "../../team-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipts", robots: { index: false, follow: false } };

// Every receipt across all events: admins only (role admin, never managers or
// staff), the same check as Business and Payroll. Filters live in the address,
// so the CSV export builds the same filtered set.
const card = "rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3";
const field = "rounded-lg border border-[#DDD5CC] bg-white px-2 py-2 text-[16px] text-[#2C2420]";
const th = "px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[#6B5D52] whitespace-nowrap";
const td = "px-2 py-2 align-top text-sm text-[#2C2420]";
const dayText = (ymd: string | null) => (ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "no date");

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const filters = parseFilters(q);
  const me = await requireFullAdmin(`${RECEIPTS_PATH}${filterQuery(filters) ? `?${filterQuery(filters)}` : ""}`);
  const all = (await allReceipts(me))!;
  const shown = filterReceipts(all.items, filters);
  const totals = receiptTotals(shown);
  const qs = filterQuery(filters);

  return (
    <>
      <TeamHeader signedIn admin back={{ href: "/team/admin/business", label: "Business" }} />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Receipts</h1>
          <p className="text-[15px] text-[#6B5D52]">Every receipt across all events. Review them on each event&apos;s Receipts tab.</p>
        </div>

        {!all.ready && <p className={`${card} text-[15px] text-[#9A7049]`}>{RECEIPTS_NOT_READY}</p>}

        <form className={`${card} grid grid-cols-2 sm:grid-cols-4 gap-2`} action={RECEIPTS_PATH} aria-label="Filters">
          <label className="text-sm text-[#2C2420]">
            Event from
            <input type="date" name="from" defaultValue={filters.from} className={`${field} block w-full mt-1`} />
          </label>
          <label className="text-sm text-[#2C2420]">
            Event to
            <input type="date" name="to" defaultValue={filters.to} className={`${field} block w-full mt-1`} />
          </label>
          <label className="text-sm text-[#2C2420]">
            Status
            <select name="status" defaultValue={filters.status} className={`${field} block w-full mt-1`}>
              <option value="">Any</option>
              {RECEIPT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {RECEIPT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-[#2C2420]">
            Type
            <select name="kind" defaultValue={filters.kind} className={`${field} block w-full mt-1`}>
              <option value="">Any</option>
              {RECEIPT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RECEIPT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-[#2C2420]">
            Payer
            <select name="payer" defaultValue={filters.payer} className={`${field} block w-full mt-1`}>
              <option value="">Any</option>
              <option value="staff">Staff</option>
              <option value="company">{COMPANY_LABEL}</option>
            </select>
          </label>
          <label className="text-sm text-[#2C2420]">
            Person
            <select name="person" defaultValue={filters.person} className={`${field} block w-full mt-1`}>
              <option value="">Anyone</option>
              {all.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-[#2C2420] col-span-2">
            Search
            <input type="search" name="q" defaultValue={filters.q} placeholder="Event, person, note, amount" className={`${field} block w-full mt-1`} />
          </label>
          <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center gap-3">
            <button className="rounded-full px-4 py-2 text-sm min-h-[44px] bg-[#2C2420] text-white">Show</button>
            {qs && (
              <Link href={RECEIPTS_PATH} className="text-sm text-[#B5845A] underline min-h-[44px] inline-flex items-center">
                Clear filters
              </Link>
            )}
            <a href={`/api/team/admin/receipts/export${qs ? `?${qs}` : ""}`} className="ml-auto rounded-lg bg-[#B5845A] text-white px-3 py-2 text-sm font-medium min-h-[44px] inline-flex items-center">
              Export CSV
            </a>
          </div>
        </form>

        <section className={card} aria-label="Totals">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 tabular-nums">
            <div>
              <dt className="text-xs text-[#6B5D52]">Receipts shown</dt>
              <dd className="text-lg font-bold text-[#2C2420]">
                {totals.count} · {money(totals.cents)}
              </dd>
            </div>
            {RECEIPT_STATUSES.map((s) => (
              <div key={s}>
                <dt className="text-xs text-[#6B5D52]">{RECEIPT_STATUS_LABEL[s]}</dt>
                <dd className="text-lg font-bold text-[#2C2420]">
                  {totals.byStatus[s].count} · {money(totals.byStatus[s].cents)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {shown.length === 0 ? (
          <p className="px-1 text-[15px] text-[#6B5D52]">{all.items.length ? "No receipts match these filters." : "No receipts yet."}</p>
        ) : (
          <div className={`${card} overflow-x-auto`}>
            <table className="min-w-full border-collapse">
              <thead className="border-b border-[#DDD5CC]">
                <tr>
                  <th className={th}>Event</th>
                  <th className={th}>Person</th>
                  <th className={th}>Type</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Note</th>
                  <th className={th}>Status</th>
                  <th className={th}>Photos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DDD5CC]">
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>
                      <Link href={managerHref(r.sessionId, "receipts")} className="text-[#B5845A] underline">
                        {r.eventTitle}
                      </Link>
                      <span className="block text-xs text-[#6B5D52] whitespace-nowrap">{dayText(r.eventDay)}</span>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{r.personName}</td>
                    <td className={`${td} whitespace-nowrap`}>{RECEIPT_KIND_LABEL[r.kind]}</td>
                    <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{money(r.cents)}</td>
                    <td className={`${td} break-words max-w-[16rem]`}>{r.note}</td>
                    <td className={td}>
                      {RECEIPT_STATUS_LABEL[r.status]}
                      {r.status === "not_approved" && r.reason && <span className="block text-xs text-[#A0412D]">{r.reason}</span>}
                      {r.status === "approved" && r.reviewedByName && <span className="block text-xs text-[#6B5D52]">by {r.reviewedByName}</span>}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {Array.from({ length: r.photoCount }, (_, n) => (
                        <a key={n} href={receiptPhotoHref(r.id, n)} target="_blank" rel="noopener noreferrer" className="mr-2 text-[#B5845A] underline">
                          Photo {n + 1}
                        </a>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
