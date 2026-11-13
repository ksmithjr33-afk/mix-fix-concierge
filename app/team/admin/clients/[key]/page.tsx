import Link from "next/link";
import { timed } from "@/lib/timing";
import { requireAdmin } from "@/lib/team/auth";
import { clientPage } from "@/lib/client-history-db";
import TeamHeader from "../../../team-header";
import ClientHistoryCard from "../../e/[id]/client-history-card";

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
