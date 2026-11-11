import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { leftoverStock } from "@/lib/team/closeout-db";
import { chicagoToday } from "@/lib/team/time";
import TeamHeader from "../../team-header";

export const dynamic = "force-dynamic";

const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Leftover stock, admins only: what came back unopened in bartenders' wrap
// ups, totalled by item and size across a date range, so the person ordering
// can see what is on hand before buying for the next event.
export default async function LeftoverStockPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = await searchParams;
  const today = chicagoToday();
  const to = isYmd(q.to) ? q.to : today;
  const from = isYmd(q.from) ? q.from : addDays(to, -30);
  await requireAdmin(`/team/admin/leftovers?from=${from}&to=${to}`);
  const { rows, wrapUps } = await leftoverStock(from <= to ? from : to, from <= to ? to : from);
  const field = "rounded-lg border border-[#DDD5CC] bg-white px-2.5 py-2 text-[15px] text-[#2C2420]";
  return (
    <>
      <TeamHeader signedIn admin back={{ href: "/team/admin/events", label: "Events" }} />
      <main className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Leftover stock</h1>
          <p className="text-[15px] text-[#6B5D52]">Unopened items bartenders counted in their wrap ups, by item and size. Check here before buying for the next event.</p>
        </div>
        <form method="get" className="px-1 flex flex-wrap items-end gap-3">
          <label className="text-sm text-[#6B5D52]">
            From
            <input type="date" name="from" defaultValue={from} className={`${field} block mt-0.5`} />
          </label>
          <label className="text-sm text-[#6B5D52]">
            To
            <input type="date" name="to" defaultValue={to} className={`${field} block mt-0.5`} />
          </label>
          <button type="submit" className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-[15px] font-medium">
            Show
          </button>
          <Link href="/team/admin/leftovers" className="text-sm text-[#B5845A] underline pb-2">
            Last 30 days
          </Link>
        </form>
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4">
          <p className="text-sm text-[#6B5D52] mb-2">
            Events from {from} to {to}: {wrapUps} {wrapUps === 1 ? "wrap up" : "wrap ups"} with an inventory.
          </p>
          {rows.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">Nothing came back unopened in this range.</p>
          ) : (
            <table className="w-full text-[15px] text-[#2C2420]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[#A39585]">
                  <th className="py-1.5 font-medium">Item</th>
                  <th className="py-1.5 font-medium">Size</th>
                  <th className="py-1.5 font-medium text-right">Unopened</th>
                  <th className="py-1.5 font-medium text-right">Events</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.item}|${r.size}`} className="border-t border-[#DDD5CC]">
                    <td className="py-2 pr-2">{r.item}</td>
                    <td className="py-2 pr-2 text-[#6B5D52]">{r.size || "—"}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{r.count}</td>
                    <td className="py-2 text-right tabular-nums text-[#6B5D52]">{r.events}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
