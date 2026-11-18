import { requireAdmin } from "@/lib/team/auth";
import { listReports } from "@/lib/team/low-stock-db";
import TeamHeader from "../../team-header";
import LowStockList from "./report-list";

export const dynamic = "force-dynamic";

// Running low, admins and managers: open reports newest first, then the
// ones resolved most recently.
export default async function RunningLowPage() {
  const me = await requireAdmin("/team/admin/running-low");
  const all = await listReports(me, { limit: 100 });
  const open = all.filter((r) => r.status !== "resolved");
  const resolved = all.filter((r) => r.status === "resolved").slice(0, 20);
  return (
    <>
      <TeamHeader signedIn admin back={{ href: "/team/admin/events", label: "Events" }} />
      <main className="max-w-2xl mx-auto px-4 py-4 sm:py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">Running low</h1>
          <p className="text-[15px] text-[#6B5D52]">
            What staff are short on. Event reports text admins and managers right away; kit reports go out in the 9 AM summary. On it texts the person who reported it.
          </p>
        </div>
        <LowStockList initial={open} empty="Nothing open." />
        {resolved.length > 0 && (
          <details className="space-y-2">
            <summary className="cursor-pointer px-1 text-sm text-[#6B5D52]">Recently resolved ({resolved.length})</summary>
            <LowStockList initial={resolved} />
          </details>
        )}
      </main>
    </>
  );
}
