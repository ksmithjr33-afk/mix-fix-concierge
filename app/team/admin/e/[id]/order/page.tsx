import { requireAdmin } from "@/lib/team/auth";
import { getSubmittedSession } from "@/lib/team/events";
import { eventTitle } from "@/lib/team/event-list";
import { marketTz, sessionMarket } from "@/lib/team/markets";
import { getSheetView, syncOrderSheet } from "@/lib/order-sheet-db";
import TeamHeader from "../../../../team-header";
import OrderSheet from "./order-sheet";

export const dynamic = "force-dynamic";

// The order sheet for one event, admins only: requireAdmin sends anyone signed
// out to sign in, and bartenders (and admins in Bartender view) to their own events.
export default async function OrderSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/team/admin/e/${encodeURIComponent(id)}/order`);
  const back = { href: `/team/admin/e/${encodeURIComponent(id)}`, label: "Event" };
  const session = await getSubmittedSession(id);
  if (!session) {
    return (
      <>
        <TeamHeader signedIn admin back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">We could not find that event.</main>
      </>
    );
  }
  await syncOrderSheet(session);
  const view = await getSheetView(session);
  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <OrderSheet initial={view} title={eventTitle(session.event_data ?? {})} timeZone={marketTz(sessionMarket(session))} />
    </>
  );
}
