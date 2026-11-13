import { requireAdmin } from "@/lib/team/auth";
import { MANUAL_PACKAGES } from "@/lib/manual-event";
import { allowsMocktails, drinkLimits, drinksFor, menuPool } from "@/lib/menu-catalog";
import { DIVE_SET_MENU } from "@/lib/dive-menu";
import TeamHeader from "../../../team-header";
import AddEventForm, { type PackageMenu } from "./add-event-form";

export const dynamic = "force-dynamic";

// Add an event by hand, for clients who booked before the concierge existed or
// never completed it. Admins only (the route checks again on the server).
export default async function AddEventPage() {
  await requireAdmin("/team/admin/events/new");
  const menus: Record<string, PackageMenu> = Object.fromEntries(
    MANUAL_PACKAGES.map((p) => [
      p,
      {
        pool: menuPool(p),
        mocktails: allowsMocktails(p),
        ...drinkLimits(p),
        drinks: drinksFor(p).map((d) => ({ key: d.key, name: d.name, group: d.group, ingredients: d.ingredients.join(", ") })),
      },
    ])
  );
  return (
    <>
      <TeamHeader signedIn admin back={{ href: "/team/admin/events", label: "All events" }} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Add event</h1>
          <p className="text-[15px] text-[#6B5D52]">For a client who booked before the concierge existed or never completed it. Nothing is sent to the client.</p>
        </div>
        <AddEventForm packages={[...MANUAL_PACKAGES]} menus={menus} diveSetMenu={[...DIVE_SET_MENU]} />
      </main>
    </>
  );
}
