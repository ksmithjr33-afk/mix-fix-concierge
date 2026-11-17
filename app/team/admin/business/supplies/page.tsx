import { requireFullAdmin } from "@/lib/team/auth";
import { catalogRows } from "@/lib/team/supply-costs-db";
import TeamHeader from "../../../team-header";
import CatalogManager from "./catalog-manager";

export const dynamic = "force-dynamic";

// The supply cost catalog, under Business. Admins only (role admin, never managers).
export default async function SupplyCostsPage() {
  const me = await requireFullAdmin("/team/admin/business/supplies");
  const rows = await catalogRows(me);
  return (
    <>
      <TeamHeader signedIn admin back={{ href: "/team/admin/business", label: "Business" }} />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Supply costs</h1>
          <p className="text-[15px] text-[#6B5D52]">What each product costs us. Shopping list lines we buy are matched by product name or an alias, and each event&apos;s supply estimate is the matched lines times their quantity.</p>
        </div>
        <CatalogManager initial={rows} />
      </main>
    </>
  );
}
