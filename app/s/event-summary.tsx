// Read only summary of a submitted event, shown under the update mode chat.
// Same sections the client saw at the end of intake. No oz amounts. Every line
// speaks to the client ("You provide the alcohol"), and team notes never show:
// the event passed in is clientEventData, and special requests are filtered again here.

import { isBlank } from "@/lib/blank";
import { packageShortFor } from "@/lib/packages-info";
import { clientRequests } from "@/lib/team-notes";

type EventData = Record<string, unknown>;

interface Drink {
  name?: string;
  base_spirit?: string;
  ingredients?: string[] | string;
  is_mocktail?: boolean;
}

function text(v: unknown): string {
  if (typeof v === "string" && isBlank(v)) return "";
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v).trim();
}

function toArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string" && val.trim()) return val.split(",").map((s) => s.trim());
  return [];
}

/** Strip oz measurements and "Top with" prefixes for client display. */
function stripMeasurements(ingredient: string): string {
  return ingredient
    .replace(/^\d+(\.\d+)?\s*oz\s+/i, "")
    .replace(/^top with\s+/i, "")
    .replace(/^splash of\s+/i, "")
    .trim();
}

function venueLabel(v: unknown): string {
  if (v === "private_residence") return "Private residence";
  if (v === "venue") return "Venue";
  return text(v);
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="py-2.5 border-b border-[#DDD5CC] last:border-0">
      <dt className="text-xs text-[#A39585] uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-[15px] text-[#2C2420] whitespace-pre-wrap break-words">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4">
      <h3 className="font-heading text-base font-bold text-[#2C2420] mb-1">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

/** Dive Bar never calls its drinks signature drinks: the menu card's classics, or the set menu. */
function drinksTitle(data: EventData): string {
  if (!String(data.package ?? "").toLowerCase().includes("dive")) return "Signature drinks";
  return data.dive_menu_card === true ? "Your menu card classics" : "Dive Bar set menu";
}

export default function EventSummary({
  data,
  cups = false,
  noBarback = false,
  asks = null,
}: {
  data: EventData;
  cups?: boolean;
  noBarback?: boolean;
  asks?: React.ReactNode; // the client's own questions (finish the drink menu, the extra drink), under Add ons and special requests
}) {
  // What the package includes, in the same short wording every page and the concierge use.
  const short = packageShortFor(data.package, {
    wedding: String(data.event_type ?? "").toLowerCase().includes("wedding"),
    // noBarback: a barback was never part of this booking, so the line is left out (not "removed").
    barback: String(data.barback ?? "").trim().toLowerCase() === "removed" ? (noBarback ? "none" : "removed") : "on",
    cups,
  }, "client");
  const drinks = (Array.isArray(data.signature_drinks) ? data.signature_drinks : []) as Drink[];
  const start = text(data.bar_service_start);
  const end = text(data.bar_service_end);
  const beerWine = [data.beer ? "Beer" : "", data.wine ? "Wine" : ""].filter(Boolean).join(" and ");
  const contactLine = [text(data.day_of_contact_name), text(data.day_of_contact_phone)]
    .filter(Boolean)
    .join(", ");
  const allergies = toArray(data.allergies).filter((a) => !/^(none|no)$/i.test(a));

  return (
    <div className="space-y-3">
      <Section title="Event">
        <Row label="Name" value={text(data.client_name)} />
        <Row label="Event" value={text(data.event_name) || text(data.event_type)} />
        <Row label="Date" value={text(data.event_date)} />
        <Row label="Guest count" value={text(data.guest_count)} />
      </Section>

      <Section title="Times">
        <Row label="Bar service" value={start && end ? `${start} to ${end}` : start} />
      </Section>

      <Section title="Location and parking">
        <Row label="Venue type" value={venueLabel(data.venue_type)} />
        <Row label="Address" value={text(data.event_address)} />
        <Row label="Bar setting" value={text(data.indoor_outdoor)} />
        <Row label="Bar floor access" value={text(data.bar_floor_access)} />
        <Row label="Bar on site" value={text(data.bar_on_site)} />
        <Row label="Bar details" value={text(data.bar_details)} />
        <Row label="Parking" value={text(data.parking_info)} />
      </Section>

      <Section title="Package">
        <Row label="Package" value={text(data.package)} />
        {short && (
          <div className="py-2.5 border-b border-[#DDD5CC] last:border-0" data-package-short>
            <dt className="text-xs text-[#A39585] uppercase tracking-wide mb-0.5">What is included</dt>
            <dd className="text-[15px] text-[#2C2420] space-y-1">
              <p>{short.line}</p>
              {short.bullets.length > 0 && (
                <ul className="list-disc pl-5 space-y-0.5">
                  {short.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {short.provides && <p className="text-[#6B5D52]">{short.provides}</p>}
            </dd>
          </div>
        )}
        <Row label="Allergies" value={allergies.join(", ")} />
      </Section>

      {drinks.length > 0 && (
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4">
          <h3 className="font-heading text-base font-bold text-[#2C2420] mb-2">{drinksTitle(data)}</h3>
          <ul className="space-y-3">
            {drinks.map((drink, i) => (
              <li key={i} className="border-b border-[#DDD5CC] last:border-0 pb-3 last:pb-0">
                {/* The name, then the spirit on its own line, so they never run together. */}
                <p className="font-heading font-bold text-[#B5845A]">{drink.name}</p>
                {(drink.is_mocktail || text(drink.base_spirit)) && (
                  <p className="text-xs text-[#A39585] uppercase tracking-wide mt-0.5">{drink.is_mocktail ? "Mocktail" : text(drink.base_spirit)}</p>
                )}
                <p className="text-sm text-[#6B5D52] mt-1">
                  {toArray(drink.ingredients).map(stripMeasurements).join(", ") || "Recipe not finished yet"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section title="Beer and wine">
        <Row label="Serving" value={beerWine || "None"} />
        <Row label="Details" value={text(data.beer_and_wine_details)} />
        <Row
          label="Provided by"
          value={data.client_providing_beer_wine === true ? "You are bringing the beer and wine" : ""}
        />
      </Section>

      <Section title="Add ons and special requests">
        {asks}
        <Row label="Requests" value={clientRequests(data) || "None"} />
        <Row label="Second bar setup" value={data.dual_bar_setup === true ? "Yes" : ""} />
      </Section>

      <Section title="Day of contact">
        <Row label="Contact" value={contactLine || "To be confirmed"} />
      </Section>
    </div>
  );
}
