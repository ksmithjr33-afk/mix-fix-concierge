import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/partners/auth";
import { eventAccess } from "@/lib/partners/db";
import { partnerEventView } from "@/lib/partners/event-page";
import PartnerHeader from "../../partner-header";
import { Approvals, LeadSwitches, PlannerList } from "./event-actions";

export const dynamic = "force-dynamic";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 space-y-2">
      <h2 className="font-heading text-lg font-bold text-[#2C2420]">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === "" || value === null || value === undefined) return null;
  return (
    <div className="flex flex-wrap gap-x-2 text-[15px]">
      <span className="text-[#6B5D52] min-w-[9rem]">{label}</span>
      <span className="text-[#2C2420] break-words">{value}</span>
    </div>
  );
}

/**
 * One linked event for a planner or host. Built on the server from what this
 * person may see (lib/partners/event-page.ts): no staff pay, notes, team chat,
 * Scorecard, or receipts ever, and money only as the booking rules allow. Not
 * linked, removed, or deactivated reads as not found.
 */
export default async function PartnerEventPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const me = await requirePrincipal();
  const access = await eventAccess(me, key);
  if (!access) notFound();
  const v = await partnerEventView(access);
  const isPlanner = v.viewer.kind === "planner";
  const isLead = v.viewer.kind === "planner" && v.viewer.isLead;
  const title = [v.eventFor.name.split(" ")[0] ? `${v.eventFor.name.split(" ")[0]}'s` : "", v.eventType || "event"].filter(Boolean).join(" ");

  return (
    <>
      <PartnerHeader signedIn name={me.kind === "partner" ? me.partner.name : undefined} />
      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <div className="px-1">
          <Link href="/partners" className="text-sm text-[#B5845A] underline">
            All events
          </Link>
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] mt-1">{title}</h1>
          {v.surprise && <p className="mt-1 inline-block text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#EDE3F5] text-[#5B3F7A]">Surprise event</p>}
          {v.eventName && <p className="text-[17px] text-[#2C2420]">{v.eventName}</p>}
          <p className="text-[15px] text-[#6B5D52]">
            {[v.date, v.status].filter(Boolean).join(" · ")}
            {isPlanner && <> · {v.holdsBooking ? "You hold the booking" : v.holder === "client" ? "The client holds the booking" : "Your Lead planner holds the booking"}</>}
          </p>
        </div>

        {isPlanner && (
          <Link href={`/partners/e/${encodeURIComponent(key)}/plan`} className="block text-center rounded-xl bg-[#B5845A] text-white py-3 font-medium">
            {v.submitted ? "Make a change with the concierge" : v.status === "Not started" ? "Start the planning chat" : "Continue the planning chat"}
          </Link>
        )}

        {v.approvals.length > 0 && <Approvals eventKey={key} items={v.approvals} />}

        {v.stillNeeded.length > 0 && (
          <Card title="Still needed">
            <ul className="list-disc pl-5 text-[15px] text-[#2C2420]">
              {v.stillNeeded.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Card>
        )}

        {v.billing && (
          <Card title="Billing">
            <Row label="Billed to:" value={v.billing.billedTo} />
            <Row label="Event for:" value={v.billing.eventFor} />
            <p className="text-sm text-[#6B5D52]">The agreement, invoice, payment link, and balance reminders go to the booking holder only.</p>
          </Card>
        )}

        <Card title="Who the event is for">
          <Row label="Name" value={v.eventFor.name} />
          {!v.readOnly && <Row label="Phone" value={v.eventFor.phone} />}
          {!v.readOnly && <Row label="Email" value={v.eventFor.email} />}
        </Card>

        <Card title="When and where">
          <Row label="Date" value={v.date} />
          <Row label="Bar service" value={v.serviceTimes} />
          <Row label="Bartender arrives" value={v.arrival} />
          <Row label="Breakdown wraps up" value={v.breakdown ? `around ${v.breakdown}` : ""} />
          <Row label="Venue" value={v.venueType} />
          <Row label="Address" value={v.mapsUrl ? <a href={v.mapsUrl} target="_blank" rel="noopener noreferrer" className="underline">{v.address}</a> : v.address} />
          <Row label="Guest count" value={v.guestCount} />
          <Row label="Day of contact" value={[v.dayOfContact.name, v.dayOfContact.phone].filter(Boolean).join(", ")} />
        </Card>

        <Card title="Package">
          <Row label="Package" value={v.package} />
          {v.packageLine && <p className="text-[15px] text-[#2C2420]">{v.packageLine}</p>}
          {v.packageBullets.length > 0 && (
            <ul className="list-disc pl-5 text-[15px] text-[#2C2420]">
              {v.packageBullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {v.packageProvides && <p className="text-[15px] text-[#6B5D52]">{v.packageProvides}</p>}
        </Card>

        {v.pricing && (
          <Card title="Pricing">
            <Row label="Booked total" value={v.pricing.total} />
            <Row label="Remaining balance" value={v.pricing.balance} />
            {v.pricing.payments.length > 0 && (
              <div className="text-[15px]">
                <p className="text-[#6B5D52]">Payments</p>
                <ul className="pl-0 text-[#2C2420]">
                  {v.pricing.payments.map((p, i) => (
                    <li key={i}>
                      {p.amount} on {p.on}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {v.pricing.agreements.map((ag) => (
              <a key={ag.id} href={`/api/partners/agreement-file?key=${encodeURIComponent(key)}&id=${encodeURIComponent(ag.id)}`} target="_blank" rel="noopener noreferrer" className="block text-[15px] text-[#B5845A] underline">
                {ag.label} ({ag.typeLabel})
              </a>
            ))}
          </Card>
        )}

        <Card title="Drinks and menu">
          {v.drinks.length === 0 ? (
            <p className="text-[15px] text-[#6B5D52]">{v.submitted ? "No signature drinks on this package." : "Picked during the planning chat."}</p>
          ) : (
            <ul className="space-y-2">
              {v.drinks.map((d, i) => (
                <li key={i} className="text-[15px]">
                  <p className="font-semibold text-[#2C2420]">{d.name}</p>
                  {d.ingredients.length > 0 && <p className="text-[#6B5D52]">{d.ingredients.map((x) => x.replace(/^\s*[\d.\/]+\s*(oz|ounces?)\s+/i, "")).join(", ")}</p>}
                </li>
              ))}
            </ul>
          )}
          {v.setMenu && <p className="text-sm text-[#6B5D52]">This package comes with a set menu.</p>}
          {v.menuCard && <p className="text-sm text-[#6B5D52]">These classics are on the printed menu card.</p>}
          {v.menu && (
            <div className="flex flex-wrap gap-3 pt-1">
              <a href={`/api/partners/menu-file?key=${encodeURIComponent(key)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#2C2420] text-white px-4 py-2 text-sm font-medium">
                View approved menu{v.menu.isPdf ? " (PDF)" : ""}
              </a>
              <a href={`/api/partners/menu-file?key=${encodeURIComponent(key)}&download=1`} className="rounded-lg border border-[#2C2420] text-[#2C2420] px-4 py-2 text-sm font-medium">
                Download
              </a>
            </div>
          )}
        </Card>

        {v.shoppingList && v.shoppingList.sections.length > 0 && (
          <Card title="Client shopping list">
            {v.shoppingList.sections.map((sec) => (
              <div key={sec.title} className="text-[15px]">
                <p className="font-semibold text-[#2C2420]">{sec.title}</p>
                <ul className="list-disc pl-5 text-[#2C2420]">
                  {sec.lines.map((l, i) => (
                    <li key={i}>{l.replace(/\s+[\u2013\u2014-]\s+/g, ", ")}</li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>
        )}

        {v.photos.length > 0 && (
          <Card title="Bar and venue photos">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {v.photos.map((p, i) => (
                <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption || "Venue photo"} className="w-full h-32 object-cover rounded-lg border border-[#DDD5CC]" />
                  {p.caption && <span className="block text-xs text-[#6B5D52] mt-0.5">{p.caption}</span>}
                </a>
              ))}
            </div>
          </Card>
        )}

        {v.bartenders.length > 0 && (
          <Card title="Your bar team">
            <p className="text-[15px] text-[#2C2420]">{v.bartenders.join(", ")}</p>
          </Card>
        )}

        <Card title="Change deadlines">
          <p className="text-[15px] text-[#2C2420]">
            {v.deadlines.withinSixDays
              ? "We are within 6 days of the event. A change to the drinks or the shopping list is sent to our team for approval."
              : `Drink changes save right away through ${v.deadlines.lastDrinkChange}. After that, a drink change is sent to our team for approval.`}
          </p>
          <p className="text-sm text-[#6B5D52]">Questions? Text us at 469 754 8512.</p>
        </Card>

        {isPlanner && <PlannerList eventKey={key} planners={v.planners} canManage={isLead && v.holder === "planner"} />}
        {isLead && v.holder === "planner" && <LeadSwitches eventKey={key} others={v.switches.others} host={v.switches.host} hostOnEvent={v.hostOnEvent} />}
      </main>
    </>
  );
}
