import { requireAdmin } from "@/lib/team/auth";
import { listSyrups } from "@/lib/syrups-db";
import TeamHeader from "../../team-header";
import SyrupManager from "./syrup-manager";

export const dynamic = "force-dynamic";

// Syrup recipes, admins and managers only: the team's house made syrups and
// prep items. The Shopping list and the bartender Supplies tab show the recipe
// for every syrup an event's drinks use, matched by name or alias. Nothing is
// filled in ahead of time: a syrup with no recipe here shows "Recipe needed".
export default async function SyrupRecipesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const add = (await searchParams).add;
  await requireAdmin(`/team/admin/syrups${typeof add === "string" ? `?add=${encodeURIComponent(add)}` : ""}`);
  const syrups = await listSyrups();
  return (
    <>
      <TeamHeader signedIn admin back={{ href: "/team/admin/staff", label: "Staff" }} />
      <main className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Syrup recipes</h1>
          <p className="text-[15px] text-[#6B5D52]">
            House made syrups and prep items. Each event&apos;s Shopping list and the bartenders&apos; Supplies tab show the recipe for every syrup its drinks use, with a
            batch scaled to the Shopping list amount. A drink ingredient finds a recipe by its name or one of its other names. A syrup marked Bought, never made, or
            with a store set on its Shopping list line, shows as Store bought.
          </p>
        </div>
        <SyrupManager initial={syrups} addName={typeof add === "string" ? add.slice(0, 80) : ""} />
      </main>
    </>
  );
}
