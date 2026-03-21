"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  generateShoppingList,
  type ShoppingListItem,
} from "@/lib/shopping-list";

interface SignatureDrink {
  name: string;
  base_spirit: string;
  flavor_profile: string;
  description: string;
  ingredients: string[];
  method: string;
  garnish: string;
  is_mocktail?: boolean;
}

interface EventData {
  client_name: string;
  email: string;
  event_type: string;
  event_name?: string;
  event_date: string;
  venue_type: string;
  bar_service_start?: string;
  bar_service_end?: string;
  event_address?: string;
  indoor_outdoor?: string;
  bar_on_site?: string;
  bar_details?: string;
  parking_info?: string;
  guest_count: number;
  age_range?: string;
  drinking_pace?: string;
  theme?: string;
  event_colors?: string;
  allergies?: string[] | null;
  day_of_contact_name?: string;
  day_of_contact_phone?: string;
  package: string;
  signature_drinks?: SignatureDrink[] | null;
  extra_bottles?: string;
  beer?: boolean;
  wine?: boolean;
  beer_and_wine_details?: string | null;
  special_requests?: string;
  menu_style?: string;
  menu_notes?: string;
}

/** Safely coerce a value that should be an array but might be a string or other type */
function toArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.trim()) return val.split(",").map((s) => s.trim());
  return [];
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3 border-b border-[#DDD5CC] last:border-0">
      <dt className="text-xs text-[#A39585] uppercase tracking-wide mb-1">
        {label}
      </dt>
      <dd className="text-[15px] text-[#2C2420]">{value || "N/A"}</dd>
    </div>
  );
}

const timelineSteps = [
  {
    title: "Shopping List",
    description:
      "We will build your custom alcohol shopping list with quantities and brand suggestions. Expect it by email within 7 to 10 days.",
  },
  {
    title: "Menu Design",
    description:
      "Our designer creates two signature menu design options for your event. Delivered by text within 2 to 4 weeks with unlimited reasonable edits.",
  },
  {
    title: "Final Payment",
    description:
      "Remaining balance is due 2 weeks before your event.",
  },
  {
    title: "Event Day",
    description:
      "Our team arrives, sets up, and handles everything. You just enjoy your event!",
  },
];

export default function CompletePage() {
  const [data, setData] = useState<EventData | null>(null);

  const shoppingListItems = useMemo(() => {
    if (!data) return [];
    try {
      return generateShoppingList({
        guest_count: data.guest_count ?? 50,
        drinking_pace: data.drinking_pace ?? "moderate",
        package: data.package ?? "",
        signature_drinks: Array.isArray(data.signature_drinks)
          ? data.signature_drinks.map((d) => ({ ...d, ingredients: toArray(d.ingredients) }))
          : [],
        beer: data.beer ?? false,
        wine: data.wine ?? false,
        extra_bottles: data.extra_bottles,
      });
    } catch {
      return [];
    }
  }, [data]);

  const groupedShoppingList = useMemo(() => {
    const grouped = new Map<string, ShoppingListItem[]>();
    for (const item of shoppingListItems) {
      const list = grouped.get(item.category) ?? [];
      list.push(item);
      grouped.set(item.category, list);
    }
    return grouped;
  }, [shoppingListItems]);

  useEffect(() => {
    const stored = localStorage.getItem("mixfix_event_data");
    if (stored) {
      try {
        setData(JSON.parse(stored));
      } catch {
        // invalid data
      }
    }
  }, []);

  useEffect(() => {
    if (!data) return;
    if (!Array.isArray(data.signature_drinks) || data.signature_drinks.length === 0) return;

    const generateMenus = async () => {
      try {
        const response = await fetch('/api/generate-menu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventName: data.event_name || 'Cocktail Menu',
            eventType: data.event_type || '',
            clientName: data.client_name || '',
            eventColors: data.event_colors
              ? (typeof data.event_colors === 'string'
                  ? data.event_colors.split(',').map((c: string) => c.trim())
                  : Array.isArray(data.event_colors) ? data.event_colors : ['#B5845A', '#8B9E7E', '#F5F0EB'])
              : ['#B5845A', '#8B9E7E', '#F5F0EB'],
            packageType: data.package || '',
            drinks: data.signature_drinks.map((d: SignatureDrink) => ({
              name: d.name,
              ingredients: Array.isArray(d.ingredients) ? d.ingredients.join(', ') : d.description || '',
              type: d.is_mocktail ? 'mocktail' : 'cocktail',
            })),
            menuStyle: data.menu_style || 'elegant',
            menuNotes: data.menu_notes || '',
          }),
        });
        if (response.ok) {
          console.log('Menu generation triggered successfully');
        }
      } catch (err) {
        console.error('Menu generation error:', err);
      }
    };
    generateMenus();
  }, [data]);

  if (!data) {
    return (
      <div className="min-h-dvh bg-[#E8DDD5] flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-bold text-[#2C2420] mb-3">
            No event data found
          </h1>
          <p className="text-[#6B5D52] mb-6">
            Complete a planning session to see your event details here.
          </p>
          <Link
            href="/chat"
            className="inline-block bg-[#B5845A] text-white px-6 py-3 rounded-xl font-medium hover:bg-[#9A7049] transition-colors"
          >
            Start Planning
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#E8DDD5]">
      {/* Header */}
      <header className="bg-[#F5F0EB] border-b border-[#DDD5CC] px-4 py-3 sm:py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <img
            src="/logo.png"
            alt="The Mix Fix"
            className="h-8 sm:h-10"
          />
          <Link href="/" className="text-sm text-[#B5845A] hover:underline">
            Home
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Confirmation Banner */}
        <div className="bg-[#B5845A] text-white rounded-2xl p-5 sm:p-6 text-center">
          <div className="text-3xl mb-2">&#127864;</div>
          <h2 className="font-heading text-xl sm:text-2xl font-bold mb-2">
            You&apos;re All Set!
          </h2>
          <p className="text-white/90 text-[15px] leading-relaxed max-w-md mx-auto">
            We have everything we need to start building your custom cocktail
            experience. Here&apos;s a summary of your event details.
          </p>
        </div>

        {/* Event Overview */}
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] p-5 sm:p-6">
          <h3 className="font-heading text-lg font-bold text-[#2C2420] mb-4">
            Event Overview
          </h3>
          <dl>
            <DetailRow label="Client" value={data.client_name} />
            <DetailRow label="Email" value={data.email} />
            <DetailRow label="Event Type" value={data.event_type} />
            <DetailRow label="Event Name" value={data.event_name ?? ""} />
            <DetailRow label="Date" value={data.event_date} />
            <DetailRow label="Venue Type" value={data.venue_type} />
            {data.bar_service_start && data.bar_service_end && (
              <DetailRow
                label="Bar Service"
                value={`${data.bar_service_start} to ${data.bar_service_end}`}
              />
            )}
            <DetailRow label="Address" value={data.event_address ?? ""} />
            <DetailRow label="Setting" value={data.indoor_outdoor ?? ""} />
            <DetailRow label="Bar on Site" value={data.bar_on_site ?? ""} />
            {data.bar_details && (
              <DetailRow label="Bar Details" value={data.bar_details} />
            )}
            <DetailRow label="Parking Info" value={data.parking_info ?? ""} />
            <DetailRow
              label="Guest Count"
              value={String(data.guest_count)}
            />
            <DetailRow label="Age Range" value={data.age_range ?? ""} />
            <DetailRow label="Drinking Pace" value={data.drinking_pace ?? ""} />
            <DetailRow label="Package" value={data.package ?? ""} />
            {data.beer_and_wine_details && (
              <DetailRow label="Beer & Wine Details" value={data.beer_and_wine_details} />
            )}
          </dl>
        </section>

        {/* Theme & Preferences */}
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] p-5 sm:p-6">
          <h3 className="font-heading text-lg font-bold text-[#2C2420] mb-4">
            Theme & Preferences
          </h3>
          <dl>
            <DetailRow label="Theme / Vibe" value={data.theme ?? ""} />
            <DetailRow label="Event Colors" value={data.event_colors ?? ""} />
            <DetailRow label="Menu Style" value={data.menu_style ?? ""} />
            {data.menu_notes && (
              <DetailRow label="Menu Design Notes" value={data.menu_notes} />
            )}
            <DetailRow
              label="Allergies / Avoid"
              value={
                toArray(data.allergies).length > 0
                  ? toArray(data.allergies).join(", ")
                  : "None"
              }
            />
            <DetailRow
              label="Day of Contact"
              value={
                data.day_of_contact_name
                  ? `${data.day_of_contact_name} ${data.day_of_contact_phone || ""}`
                  : "TBD"
              }
            />
            <DetailRow
              label="Beer"
              value={data.beer ? "Yes" : "No"}
            />
            <DetailRow
              label="Wine"
              value={data.wine ? "Yes" : "No"}
            />
            {data.extra_bottles && (
              <DetailRow label="Extra Bottles" value={data.extra_bottles} />
            )}
            {data.special_requests && (
              <DetailRow
                label="Special Requests"
                value={data.special_requests}
              />
            )}
          </dl>
        </section>

        {/* Signature Drinks */}
        {Array.isArray(data.signature_drinks) && data.signature_drinks.length > 0 && (
          <section className="space-y-4">
            <h3 className="font-heading text-lg font-bold text-[#2C2420]">
              Your Signature Drinks
            </h3>
            {data.signature_drinks.map((drink, i) => (
              <div
                key={i}
                className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] p-5 sm:p-6"
              >
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-heading text-base font-bold text-[#B5845A]">
                    {drink.name}
                    {drink.is_mocktail && (
                      <span className="ml-2 text-xs text-[#6B5D52] bg-[#E8DDD5] px-2 py-0.5 rounded-full font-normal">
                        Mocktail
                      </span>
                    )}
                  </h4>
                  <span className="text-xs text-[#A39585] bg-[#E8DDD5] px-2 py-1 rounded-full">
                    {drink.is_mocktail ? "Non Alcoholic" : drink.base_spirit}
                  </span>
                </div>
                <p className="text-sm text-[#6B5D52] mb-3">
                  {drink.description}
                </p>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-[#A39585]">Flavor: </span>
                    <span className="text-[#2C2420]">
                      {drink.flavor_profile}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#A39585]">Ingredients: </span>
                    <span className="text-[#2C2420]">
                      {toArray(drink.ingredients).join(", ")}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#A39585]">Method: </span>
                    <span className="text-[#2C2420]">{drink.method}</span>
                  </div>
                  <div>
                    <span className="text-[#A39585]">Garnish: </span>
                    <span className="text-[#2C2420]">{drink.garnish}</span>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Shopping List */}
        {shoppingListItems.length > 0 && (
          <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] p-5 sm:p-6">
            <h3 className="font-heading text-lg font-bold text-[#2C2420] mb-4">
              Your Shopping List
            </h3>
            <div className="space-y-5">
              {Array.from(groupedShoppingList).map(([category, items]) => (
                <div key={category}>
                  <h4 className="text-xs text-[#A39585] uppercase tracking-wide mb-2">
                    {category}
                  </h4>
                  <ul className="space-y-2">
                    {items.map((item, i) => (
                      <li
                        key={i}
                        className="flex items-start justify-between gap-3 py-2 border-b border-[#DDD5CC] last:border-0"
                      >
                        <div>
                          <span className="text-[15px] text-[#2C2420]">
                            {item.item}
                          </span>
                          {item.notes && (
                            <p className="text-xs text-[#A39585] mt-0.5">
                              {item.notes}
                            </p>
                          )}
                        </div>
                        <span className="text-sm text-[#B5845A] font-medium whitespace-nowrap">
                          {item.quantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* What Happens Next - Timeline */}
        <section className="bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] p-5 sm:p-6">
          <h3 className="font-heading text-lg font-bold text-[#2C2420] mb-6">
            What Happens Next
          </h3>
          <div className="relative">
            {timelineSteps.map((step, i) => (
              <div key={i} className="flex gap-4 pb-6 last:pb-0">
                {/* Timeline indicator */}
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-[#8B9E7E] text-white text-sm font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>
                  {i < timelineSteps.length - 1 && (
                    <div className="w-0.5 flex-1 bg-[#8B9E7E]/30 mt-2" />
                  )}
                </div>
                {/* Content */}
                <div className="pt-1 pb-2">
                  <h4 className="text-[15px] font-bold text-[#2C2420] mb-1">
                    {step.title}
                  </h4>
                  <p className="text-sm text-[#6B5D52] leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-[#6B5D52] mt-6 pt-4 border-t border-[#DDD5CC] leading-relaxed">
            You can make adjustments to your plan anytime up to 2 weeks before
            the event. Text us anytime with questions.
          </p>
        </section>

        {/* Contact & Back to Home */}
        <div className="text-center pb-6 sm:pb-8 space-y-3">
          <a
            href="tel:4697548512"
            className="block text-sm text-[#6B5D52] hover:text-[#B5845A] transition-colors"
          >
            Questions? Text us at (469) 754-8512
          </a>
          <Link
            href="/"
            className="text-sm text-[#B5845A] hover:underline"
          >
            Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}
