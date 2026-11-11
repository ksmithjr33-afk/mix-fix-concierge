import { requireAdmin } from "@/lib/team/auth";
import { listStores } from "@/lib/order-sheet-stores";
import TeamHeader from "../../team-header";
import StoreManager from "./store-manager";

export const dynamic = "force-dynamic";

// Manage stores, admins only: the stores order sheets can use, their
// highlight colors and order, and retiring a store.
export default async function AdminStoresPage() {
  await requireAdmin("/team/admin/stores");
  const stores = await listStores();
  return (
    <>
      <TeamHeader signedIn admin back={{ href: "/team/admin/events", label: "Events" }} />
      <main className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Manage stores</h1>
          <p className="text-[15px] text-[#6B5D52]">
            The stores on every order sheet, in the order they are offered and shown on the legend. A retired store stays on old sheets that used it but is not
            offered on new lines.
          </p>
        </div>
        <StoreManager initial={stores} />
      </main>
    </>
  );
}
