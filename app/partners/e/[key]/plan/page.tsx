import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/partners/auth";
import { eventAccess, plannersOn } from "@/lib/partners/db";
import { intakeMessages, partnerChatMessages, visibleMessages } from "@/lib/partners/event-page";
import { plannerChatContext } from "@/lib/partners/planning";
import { eventPhrase } from "@/lib/partners/chat";
import { moneyAccess } from "@/lib/partners/rules";
import PartnerHeader from "../../../partner-header";
import PartnerChat from "./partner-chat";

export const dynamic = "force-dynamic";

/** The planning chat (before the planning is in) or update mode (after), for a linked planner. Hosts never get here. */
export default async function PartnerPlanPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const me = await requirePrincipal();
  const access = await eventAccess(me, key);
  if (!access || access.viewer.kind !== "planner" || !access.actor.partnerId) notFound();
  const s = access.session;
  const submitted = s.status === "submitted" && !!s.event_data;
  const money = moneyAccess(access.booking, access.viewer);
  const live = new Map((await plannersOn(s.id)).map((p) => [p.partner.id, p.partner.name || "A planner"]));
  const raw = submitted ? await partnerChatMessages(s.id, access.actor.partnerId) : await intakeMessages(s.id);
  const ctx = await plannerChatContext(access);
  return (
    <>
      <PartnerHeader signedIn name={me.kind === "partner" ? me.partner.name : undefined} />
      <main className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        <Link href={`/partners/e/${encodeURIComponent(key)}`} className="text-sm text-[#B5845A] underline px-1">
          Back to the event
        </Link>
        <PartnerChat
          eventKey={key}
          mode={submitted ? "update" : "intake"}
          startVersion={s.version}
          heading={submitted ? `Update ${eventPhrase(ctx)}` : `Plan ${eventPhrase(ctx)}`}
          greeting={submitted ? `Hi ${ctx.plannerName.split(" ")[0] || "there"}! You are planning ${eventPhrase(ctx)}. What would you like to change?` : ""}
          initial={visibleMessages(raw, money, access.actor.partnerId, live)}
          holdsBooking={ctx.holdsBooking}
          holderFirstName={ctx.holderFirstName}
        />
      </main>
    </>
  );
}
