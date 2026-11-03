// Read only summary of a submitted event, shown under the update mode chat.
// Same sections the client saw at the end of intake. No oz amounts.

type EventData = Record<string, unknown>;

interface Drink {
  name?: string;
  base_spirit?: string;
  ingredients?: string[] | string;
  is_mocktail?: boolean;
}

function text(v: unknown): string {
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

export default function EventSummary({ data }: { data: EventData }) {
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
        <Row label="Client" value={text(data.client_name)} />
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
        <Row label="Allergies" value={allergies.join(", ")} />
      </Section>

      {drinks.length > 0 && (
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4">
          <h3 className="font-heading text-base font-bold text-[#2C2420] mb-2">Signature drinks</h3>
          <ul className="space-y-3">
            {drinks.map((drink, i) => (
              <li key={i} className="border-b border-[#DDD5CC] last:border-0 pb-3 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading font-bold text-[#B5845A]">{drink.name}</span>
                  <span className="text-xs text-[#A39585] bg-[#E8DDD5] px-2 py-0.5 rounded-full shrink-0">
                    {drink.is_mocktail ? "Mocktail" : drink.base_spirit}
                  </span>
                </div>
                <p className="text-sm text-[#6B5D52] mt-1">
                  {toArray(drink.ingredients).map(stripMeasurements).join(", ")}
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
        <Row label="Requests" value={text(data.special_requests) || "None"} />
        <Row label="Second bar setup" value={data.dual_bar_setup === true ? "Yes" : ""} />
      </Section>

      <Section title="Day of contact">
        <Row label="Contact" value={contactLine || "To be confirmed"} />
      </Section>
    </div>
  );
}
