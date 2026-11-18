import Link from "next/link";
import { getCurrentPrincipal } from "@/lib/partners/auth";
import { dashboardRows } from "@/lib/partners/event-page";
import { partnerEventHref } from "@/lib/partners/db";
import PartnerHeader from "./partner-header";
import PartnerLoginForm from "./login-form";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  "Not started": "bg-[#F3E3DF] text-[#8C3B2B]",
  "In progress": "bg-[#FFF3DC] text-[#7A5A16]",
  Planned: "bg-[#E4EEDC] text-[#3F5F2A]",
  "Menu approved": "bg-[#DCEBE7] text-[#245A4E]",
};

/**
 * /partners: sign in with a text code, then every event you are linked to.
 * Reads only the partner cookie: a staff session is never signed in here.
 */
export default async function PartnersHome() {
  const me = await getCurrentPrincipal();
  if (!me) {
    return (
      <>
        <PartnerHeader signedIn={false} />
        <main className="max-w-md mx-auto px-4 py-10">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] mb-1">Partner sign in</h1>
          <p className="text-[15px] text-[#6B5D52] mb-6">For event planners and hosts working with The Mix Fix. Enter your phone number and we will text you a code.</p>
          <PartnerLoginForm />
        </main>
      </>
    );
  }
  const rows = await dashboardRows(me);
  const upcoming = rows.filter((r) => !r.past);
  const past = rows.filter((r) => r.past);
  const name = me.kind === "partner" ? me.partner.name : me.name;

  const list = (items: typeof rows) => (
    <ul className="space-y-2">
      {items.map((r) => (
        <li key={r.key}>
          <Link href={partnerEventHref(r.key)} className="block rounded-2xl bg-[#F5F0EB] border border-[#DDD5CC] px-4 py-3 hover:border-[#B5845A]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="font-heading font-bold text-[#2C2420]">
                {[r.eventFor, r.eventType].filter(Boolean).join(" · ")}
              </p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_TONE[r.status] ?? ""}`}>{r.status}</span>
            </div>
            <p className="text-[15px] text-[#6B5D52]">{[r.date, r.city, r.package].filter(Boolean).join(" · ")}</p>
            {me.kind === "partner" && <p className="text-xs text-[#A39585] mt-0.5">{r.holdsBooking ? "You hold the booking" : "The booking is held by someone else"}</p>}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PartnerHeader signedIn name={me.kind === "partner" ? name : undefined} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#2C2420]">{name ? `Hi ${name.split(" ")[0]}` : "Your events"}</h1>
          <p className="text-[15px] text-[#6B5D52]">{me.kind === "partner" ? "Every event you are planning with us." : "The events you can view."}</p>
        </div>
        {rows.length === 0 && <p className="text-[15px] text-[#6B5D52]">No events yet. When you are added to an event, it shows here.</p>}
        {upcoming.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-heading text-lg font-bold text-[#2C2420]">Upcoming</h2>
            {list(upcoming)}
          </section>
        )}
        {past.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-heading text-lg font-bold text-[#2C2420]">Past</h2>
            {list(past)}
          </section>
        )}
      </main>
    </>
  );
}
