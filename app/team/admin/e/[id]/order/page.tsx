import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/team/auth";
import { managerHref } from "@/lib/team/manager-tabs";

export const dynamic = "force-dynamic";

// The order sheet link (and order_sheet_url in the GHL payloads) keeps working:
// it opens the Order sheet tab of the manager view. Admins only: requireAdmin
// sends anyone signed out to sign in, and bartenders (and admins in Bartender
// view) to their own events, before anything about the event is read.
export default async function OrderSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/team/admin/e/${encodeURIComponent(id)}/order`);
  redirect(managerHref(id, "order"));
}
