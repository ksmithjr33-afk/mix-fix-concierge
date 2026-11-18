import Link from "next/link";
import { requireAdmin } from "@/lib/team/auth";
import { activityByPartner, getPartner, partnerEventLinks } from "@/lib/partners/db";
import { bookingOf, LINKED_VIA_LABEL } from "@/lib/partners/rules";
import { adminEventTitle } from "@/lib/team/event-list";
import { eventData } from "@/lib/team/markets";
import { chicagoStamp, eventSchedule, longDate } from "@/lib/team/time";
import { managerHref } from "@/lib/team/manager-tabs";
import TeamHeader from "../../../team-header";
import { EditPartner } from "../partner-form";

export const dynamic = "force-dynamic";

/** One partner, admins and managers only: profile, internal notes, every event they were linked to, and their activity. */
export default async function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/team/admin/partners/${encodeURIComponent(id)}`);
  const back = { href: "/team/admin/partners", label: "All partners" };
  const p = await getPartner(id);
  if (!p) {
    return (
      <>
        <TeamHeader signedIn admin back={back} />
        <main className="max-w-md mx-auto px-4 py-10 text-center text-[15px] text-[#6B5D52]">We could not find that partner.</main>
      </>
    );
  }
  const [links, activity] = await Promise.all([partnerEventLinks(id), activityByPartner(id)]);
  return (
    <>
      <TeamHeader signedIn admin back={back} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="px-1">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] break-words">
            {p.name || p.phone}
            {!p.active && <span className="ml-2 align-middle text-xs font-bold uppercase text-[#A0412D]">Deactivated</span>}
          </h1>
          <p className="text-[15px] text-[#6B5D52]">{[p.company, p.phone, p.email].filter(Boolean).join(" · ")}</p>
          <p className="text-sm text-[#6B5D52]">{p.last_sign_in_at ? `Last sign in ${chicagoStamp(p.last_sign_in_at)}` : "Never signed in"}</p>
        </div>
        <EditPartner
          id={id}
          active={p.active}
          initial={{ name: p.name, company: p.company, phone: p.phone, email: p.email, website: p.website, markets: p.markets ?? [], internal_notes: p.internal_notes ?? "" }}
        />
        <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 space-y-2">
          <h2 className="font-heading text-lg font-bold text-[#2C2420]">Events</h2>
          {links.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">Not linked to any event yet.</p>
          ) : (
            <ul className="divide-y divide-[#DDD5CC]">
              {links.map(({ link, session }) => {
                const ed = eventData(session);
                const holds = link.is_lead && !link.removed_at && bookingOf(session).holder === "planner";
                return (
                  <li key={link.id} className="py-2 text-[15px]">
                    <Link href={managerHref(session.id)} className="font-medium text-[#2C2420] underline">
                      {adminEventTitle(ed)}
                    </Link>
                    <span className="block text-[#6B5D52]">
                      {[longDate(eventSchedule(ed).day), link.is_lead ? "Lead" : "", holds ? "Holds the booking" : "", `${LINKED_VIA_LABEL[link.linked_via]}${link.linked_by_name ? ` (${link.linked_by_name})` : ""}, ${chicagoStamp(link.linked_at)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {link.removed_at && <span className="block text-sm text-[#A0412D]">Removed {chicagoStamp(link.removed_at)}{link.removed_by_name ? ` by ${link.removed_by_name}` : ""}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-[#DDD5CC] bg-[#F5F0EB] px-4 py-3 space-y-2">
          <h2 className="font-heading text-lg font-bold text-[#2C2420]">Activity</h2>
          {activity.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">Nothing yet.</p>
          ) : (
            <ul className="space-y-1">
              {activity.map((a) => (
                <li key={a.id} className="text-sm text-[#2C2420]">
                  <span className="text-[#6B5D52]">{chicagoStamp(a.created_at)}</span> {a.actor_name}: {[a.action, a.detail].filter(Boolean).join(", ")}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
