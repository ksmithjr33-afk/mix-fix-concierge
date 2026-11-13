// The event details block, shared by the bartender view and the manager view.
// No "use client": it has no state, so the manager view renders it on the
// server and sends no JavaScript for it.

import type { StaffEventView } from "@/lib/team/event-view";

export const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4";

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  if (!value && !children) return null;
  return (
    <div className="py-2.5 border-b border-[#DDD5CC] last:border-0">
      <dt className="text-xs text-[#A39585] uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-[15px] text-[#2C2420] whitespace-pre-wrap break-words">{children ?? value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={card}>
      <h3 className="font-heading text-base font-bold text-[#2C2420] mb-1">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function Details({ v }: { v: StaffEventView }) {
  return (
    <div className="space-y-3">
      {v.whatChanged.length > 0 && (
        <section className="bg-[#FFF8EC] rounded-2xl border border-[#E3C9A0] px-4 py-3 sm:px-5 sm:py-4">
          <h3 className="font-heading text-base font-bold text-[#2C2420] mb-1">What changed</h3>
          <ul className="space-y-1">
            {v.whatChanged.map((line, i) => (
              <li key={i} className="text-[15px] text-[#2C2420] break-words">
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section title="Event">
        <Row label="Event" value={[v.eventName, v.eventType].filter(Boolean).join(", ")} />
        <Row label="Client" value={v.clientFirstName} />
        <Row label="Date" value={v.date} />
        <Row label="Arrive by" value={v.arrival} />
        <Row label="Bar service" value={v.serviceStart && v.serviceEnd ? `${v.serviceStart} to ${v.serviceEnd}` : v.serviceStart} />
        <Row label="Guest count" value={v.guestCount} />
        <Row label="Package" value={v.package} />
        <Row label="Bartenders" value={v.bartenders !== null ? String(v.bartenders) : ""} />
        <Row label="Also working" value={v.teammates.join(", ")} />
      </Section>

      <Section title="Location">
        {v.address && (
          <Row label="Address">
            {v.mapsUrl ? (
              <a href={v.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-[#B5845A] underline">
                {v.address}
              </a>
            ) : (
              v.address
            )}
          </Row>
        )}
        <Row label="Venue type" value={v.venueType} />
        <Row label="Bar setting" value={v.barSetting} />
        <Row label="Bar on site" value={v.barOnSite} />
        <Row label="Bar floor access" value={v.barFloorAccess} />
        <Row label="Bar details" value={v.barDetails} />
        <Row label="Parking" value={v.parking} />
      </Section>

      <Section title="Day of contact">
        <Row label="Contact" value={v.dayOfContact.name} />
        <Row label="Phone">
          {v.dayOfContact.phone ? (
            <a href={telHref(v.dayOfContact.phone)} className="text-[#B5845A] underline">
              {v.dayOfContact.phone}
            </a>
          ) : (
            <span className="text-[#6B5D52]">{v.dayOfContact.phoneNote}</span>
          )}
        </Row>
        <Row label="The Mix Fix">
          <a href={telHref(v.mixFixLine)} className="text-[#B5845A] underline">
            {v.mixFixLine}
          </a>
        </Row>
      </Section>

      <Section title="Style and notes">
        <Row label="Theme" value={v.theme} />
        <Row label="Colors" value={v.colors} />
        <Row label="Allergies" value={v.allergies.join(", ") || "None"} />
        <Row label="Beer and wine" value={v.beerAndWine} />
        <Row label="Special requests" value={v.specialRequests || "None"} />
        <Row label="Client note on bottles" value={v.bottleNote} />
      </Section>

      {v.drinks.length > 0 && (
        <section className={card}>
          <h3 className="font-heading text-base font-bold text-[#2C2420] mb-2">{v.setMenu ? "Dive Bar set menu" : "Signature drinks"}</h3>
          <ul className="space-y-3">
            {v.drinks.map((d, i) => (
              <li key={i} className="border-b border-[#DDD5CC] last:border-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading font-bold text-[#B5845A]">{d.name}</span>
                  {d.kind && <span className="text-xs text-[#A39585] bg-[#E8DDD5] px-2 py-0.5 rounded-full shrink-0">{d.kind}</span>}
                </div>
                <ul className="mt-1 text-sm text-[#2C2420] space-y-0.5">
                  {d.ingredients.map((ing, j) => (
                    <li key={j}>{ing}</li>
                  ))}
                </ul>
                {d.cup && <p className="text-sm text-[#6B5D52] mt-1">Cup: {d.cup}</p>}
                {d.method && <p className="text-sm text-[#6B5D52] mt-1">Method: {d.method}</p>}
                {d.garnish && <p className="text-sm text-[#6B5D52]">Garnish: {d.garnish}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.classics && (
        <section className={card}>
          <h3 className="font-heading text-base font-bold text-[#2C2420]">Also available</h3>
          <p className="text-sm text-[#6B5D52] mb-2">Guests can also order these classics at the bar.</p>
          <div className="space-y-3">
            {v.classics.map((g) => (
              <div key={g.title}>
                <h4 className="text-xs text-[#A39585] uppercase tracking-wide mb-1">{g.title}</h4>
                <ul className="space-y-1.5">
                  {g.drinks.map((d) => (
                    <li key={d.name} className="text-sm text-[#2C2420]">
                      <span className="font-bold">{d.name}:</span> {d.recipe}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {v.lastUpdated && <p className="text-xs text-[#A39585] px-1">Last updated {v.lastUpdated}</p>}
    </div>
  );
}
