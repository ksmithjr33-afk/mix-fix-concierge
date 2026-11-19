import Link from "next/link";
import { timed } from "@/lib/timing";
import { requireAdmin } from "@/lib/team/auth";
import { clientPage } from "@/lib/client-history-db";
import TeamHeader from "../../../team-header";
import ClientHistoryCard from "../../e/[id]/client-history-card";
import { clientAgreements } from "@/lib/team/agreements-db";
import { plannersBySession } from "@/lib/partners/db";
import { managerHref } from "@/lib/team/manager-tabs";

export const dynamic = "force-dynamic";

// One client's full event list, newest first. Admins only: requireAdmin runs
// before anything is read, and clientPage returns nothing for anyone else.
async function ClientPage({ params }: { params: Promise<{ key: string }> }) {
  // The email key, whether or not Next already decoded it ("%40" or "@").
  const raw = (await params).key;
  let key = raw;
  try {
    key = decodeURIComponent(raw);
  } catch {
    key = raw;
  }
  const admin = await requireAdmin(`/team/admin/clients/${encodeURIComponent(key)}`);
  const page = await clientPage(key, admin);
  const back = { href: "/team/admin/clients", label: "All clients" };
  if (!page || page === "none") {
    return (
      <>
        <TeamHeader signedIn admin back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">We could not find that client.</main>
      </>
    );
  }
  const { client } = page;
  // Agreements across all their events (admins and managers only).
  const agreements = (await clientAgreements(page.rows.map((r) => r.id), admin).catch(() => null)) ?? [];
  // The planners on each event. Empty before the partners migration.
  const planners = await plannersBySession(page.rows.map((r) => r.id)).catch(() => new Map<string, { name: string; company: string; isLead: boolean }[]>());
  const withPlanners = page.rows.filter((r) => (planners.get(r.id) ?? []).length > 0);
  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">{client.name || client.email}</h1>
          <p className="text-[15px] text-[#6B5D52] break-words">{[client.email, client.phone].filter(Boolean).join(" · ")}</p>
          <p className="text-[15px] text-[#6B5D52]">
            {client.events} {client.events === 1 ? "event" : "events"}
          </p>
        </div>
        <ClientHistoryCard history={{ matchedOn: client.key, rows: page.rows }} clientKey="" title="Events" />
        {withPlanners.length > 0 && (
          <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 sm:px-5 sm:py-4 space-y-2" aria-label="Planners">
            <h2 className="font-heading text-lg font-bold text-[#2C2420]">Planners</h2>
            <ul className="divide-y divide-[#DDD5CC]">
              {withPlanners.map((r) => (
                <li key={r.id} className="py-2 text-[15px]">
                  <Link href={managerHref(r.id)} className="font-medium text-[#2C2420] underline">
                    {r.title}
                  </Link>
                  <span className="block text-[#6B5D52]">
                    {(planners.get(r.id) ?? []).map((p) => `${p.name}${p.company ? `, ${p.company}` : ""}${p.isLead ? " (Lead)" : ""}`).join("; ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 sm:px-5 sm:py-4 space-y-2" aria-label="Agreements">
          <h2 className="font-heading text-lg font-bold text-[#2C2420]">Agreements</h2>
          {agreements.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">No agreements uploaded for this client yet. Upload them on each event&apos;s Agreement tab.</p>
          ) : (
            <ul className="divide-y divide-[#DDD5CC]">
              {agreements.map((a) => (
                <li key={a.id} className="py-2 space-y-0.5">
                  <p className="text-[15px] text-[#2C2420]">
                    <a href={a.viewHref} target="_blank" rel="noreferrer" className="font-medium text-[#B5845A] underline">
                      {a.label || a.fileName || "Agreement"}
                    </a>{" "}
                    <span className="text-[#6B5D52]">({a.typeLabel})</span>
                  </p>
                  <p className="text-sm text-[#6B5D52] break-words">
                    <Link href={a.eventHref} className="underline">
                      {a.eventTitle}
                    </Link>{" "}
                    · Uploaded by {a.uploadedBy}, {a.uploadedAt}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="px-1">
          <Link href="/team/admin/clients" className="text-sm text-[#B5845A] underline">
            Back to clients
          </Link>
        </div>
      </main>
    </>
  );
}

export default async function Page(props: { params: Promise<{ key: string }> }) {
  return timed("client", () => ClientPage(props));
}
