import Link from "next/link";
import { timed } from "@/lib/timing";
import { requireAdmin } from "@/lib/team/auth";
import { clientsList } from "@/lib/client-history-db";
import { searchClients } from "@/lib/client-history";
import { longDate } from "@/lib/team/time";
import TeamHeader from "../../team-header";

export const dynamic = "force-dynamic";

// Every client, one row each (by email), searchable by name, email or phone.
// Admins only: requireAdmin runs before anything is read, and clientsList
// returns nothing for anyone else.
async function ClientsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const q = (await searchParams).q;
  const query = typeof q === "string" ? q.slice(0, 100) : "";
  const admin = await requireAdmin(`/team/admin/clients${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const all = (await clientsList(admin)) ?? [];
  const shown = searchClients(all, query);
  return (
    <>
      <TeamHeader signedIn admin />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Clients</h1>
          <p className="text-[15px] text-[#6B5D52]">{all.length} clients, one row per email.</p>
        </div>
        <form method="get" action="/team/admin/clients" className="px-1 flex gap-2" role="search">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Name, email or phone"
            aria-label="Search clients"
            className="min-w-0 flex-1 rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[15px] text-[#2C2420]"
          />
          <button type="submit" className="rounded-lg bg-[#2C2420] text-white px-3 py-2 text-sm">
            Search
          </button>
        </form>
        {query && (
          <p className="px-1 text-sm text-[#6B5D52]">
            {shown.length} {shown.length === 1 ? "match" : "matches"} for &ldquo;{query}&rdquo;.{" "}
            <Link href="/team/admin/clients" className="text-[#B5845A] underline">
              Clear
            </Link>
          </p>
        )}
        <ul className="rounded-2xl border border-[#DDD5CC] bg-white divide-y divide-[#EEE8E2]">
          {shown.map((c) => (
            <li key={c.key}>
              <Link href={`/team/admin/clients/${encodeURIComponent(c.key)}`} className="block px-4 py-3 hover:bg-[#FAF7F4]">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-[#2C2420] truncate">{c.name || c.email}</span>
                  <span className="shrink-0 text-sm text-[#6B5D52]">
                    {c.events} {c.events === 1 ? "event" : "events"}
                  </span>
                </span>
                <span className="block text-sm text-[#6B5D52] break-words">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
                <span className="block text-sm text-[#6B5D52]">
                  {[c.lastEvent ? `Last ${longDate(c.lastEvent)}` : "", c.nextEvent ? `Next ${longDate(c.nextEvent)}` : ""].filter(Boolean).join(" · ") || "No dated events"}
                </span>
              </Link>
            </li>
          ))}
          {shown.length === 0 && <li className="px-4 py-6 text-center text-[15px] text-[#6B5D52]">No clients found.</li>}
        </ul>
      </main>
    </>
  );
}

export default async function Page(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return timed("clients", () => ClientsPage(props));
}
