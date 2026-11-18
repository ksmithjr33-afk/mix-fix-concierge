import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { listPartners } from "@/lib/partners/db";
import { chicagoToday, chicagoStamp } from "@/lib/team/time";
import { marketLabel } from "@/lib/team/markets";
import TeamHeader from "../../team-header";
import AddPartner from "./partner-form";

export const dynamic = "force-dynamic";

/**
 * Partners, admins and managers only: every planner with company, phone,
 * markets, upcoming and past events, how many they hold the booking on, and
 * last sign in. Searchable. Before the partners migration it says so.
 */
export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = (await searchParams).q;
  const query = typeof q === "string" ? q.slice(0, 100).trim() : "";
  await requireAdmin(`/team/admin/partners${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const all = await listPartners(chicagoToday());
  const needle = query.toLowerCase();
  const digits = query.replace(/\D/g, "");
  const shown = (all ?? []).filter(
    (p) => !needle || [p.name, p.company, p.email].some((f) => f.toLowerCase().includes(needle)) || (digits.length >= 3 && p.phone.replace(/\D/g, "").includes(digits))
  );
  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Partners</h1>
          <p className="text-[15px] text-[#6B5D52]">Event planners who sign in at /partners. They never see staff pay, notes, the team chat, the Scorecard, or receipts.</p>
        </div>
        {all === null ? (
          <p className="px-1 text-[15px] text-[#A0412D]">Partners are not set up yet. Run the partners database update first.</p>
        ) : (
          <>
            <form method="get" action="/team/admin/partners" className="px-1 flex gap-2" role="search">
              <input type="search" name="q" defaultValue={query} placeholder="Name, company, email or phone" aria-label="Search partners" className="min-w-0 flex-1 rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[15px] text-[#2C2420]" />
              <button type="submit" className="rounded-lg bg-[#2C2420] text-white px-3 py-2 text-sm">
                Search
              </button>
            </form>
            <AddPartner />
            <ul className="rounded-2xl border border-[#DDD5CC] bg-white divide-y divide-[#EEE8E2]">
              {shown.length === 0 && <li className="px-4 py-3 text-[15px] text-[#6B5D52]">{query ? "No partners match." : "No partners yet."}</li>}
              {shown.map((p) => (
                <li key={p.id}>
                  <Link href={`/team/admin/partners/${encodeURIComponent(p.id)}`} className="block px-4 py-3 hover:bg-[#FAF7F4]">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-[#2C2420] truncate">
                        {p.name || p.phone}
                        {!p.active && <span className="ml-2 text-xs font-bold uppercase text-[#A0412D]">Off</span>}
                      </span>
                      <span className="shrink-0 text-sm text-[#6B5D52]">
                        {p.upcoming} upcoming · {p.past} past
                      </span>
                    </span>
                    <span className="block text-sm text-[#6B5D52] break-words">{[p.company, p.phone, p.markets.map(marketLabel).join(", ")].filter(Boolean).join(" · ")}</span>
                    <span className="block text-sm text-[#6B5D52]">
                      Holds the booking on {p.holds} · {p.last_sign_in_at ? `Last sign in ${chicagoStamp(p.last_sign_in_at)}` : "Never signed in"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}
