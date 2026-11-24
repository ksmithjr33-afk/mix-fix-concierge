"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "../../copy-button";
import { CALENDAR_ONLY_SKIPPED } from "@/lib/calendar-only";

export interface PackageMenu {
  pool: "none" | "set" | "craft" | "craft_classics" | "classics";
  mocktails: boolean;
  included: number;
  max: number;
  drinks: { key: string; name: string; group: string; ingredients: string }[];
}

interface DrinkRow {
  kind: "menu" | "custom";
  key: string;
  name: string;
  ingredients: string;
  is_mocktail: boolean;
}

const card = "bg-[#F5F0EB] rounded-2xl border border-[#DDD5CC] px-4 py-3 sm:px-5 sm:py-4 space-y-3";
const input = "block w-full rounded-lg border border-[#DDD5CC] bg-white px-3 py-2 text-[16px] text-[#2C2420]";
const labelCls = "block text-sm text-[#6B5D52] space-y-1";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className={labelCls}>
      <span>{label}</span>
      {children}
      {hint && <span className="block text-xs text-[#A39585]">{hint}</span>}
    </label>
  );
}

const blankDrink = (): DrinkRow => ({ kind: "menu", key: "", name: "", ingredients: "", is_mocktail: false });

/** The Add event form: client, event, drinks, optional prices, and the two ways to save. */
const LAST_GRATUITY_DAY = "2026-11-23";
type Model = "gratuity" | "service_fee";
const modelFor = (day: string): Model => (day && day <= LAST_GRATUITY_DAY ? "gratuity" : "service_fee");

export default function AddEventForm({
  packages,
  sfPackages,
  menus,
  sfMenus,
  diveSetMenu,
  initialDate = "",
  today = "",
}: {
  packages: string[]; // gratuity model
  sfPackages: string[]; // service fee model
  menus: Record<string, PackageMenu>; // gratuity model
  sfMenus: Record<string, PackageMenu>; // service fee model: Bartender Only is the classics only
  diveSetMenu: string[];
  initialDate?: string; // YYYY-MM-DD, from a tap on the calendar
  today?: string; // YYYY-MM-DD: past dates stay refused (the server checks too)
}) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>({ package: "", booked_on: today, ...(initialDate ? { event_date: initialDate } : {}) });
  // The pricing model defaults from Booked on; the admin can pick the other one.
  const [model, setModel] = useState<Model>(modelFor(today));
  // Service fee model only: is a tip jar allowed at the event. Yes by default.
  const [tipJar, setTipJar] = useState<"yes" | "no">("yes");
  const modelPackages = model === "service_fee" ? sfPackages : packages;
  const changeModel = (m: Model) => {
    setModel(m);
    const list = m === "service_fee" ? sfPackages : packages;
    if (v.package && !list.includes(v.package)) pickPackage("");
  };
  // "New booking" (today's behavior) or "Already confirmed, add to our calendar only".
  const [calendarOnly, setCalendarOnly] = useState(false);
  const [flags, setFlags] = useState({ beer: false, wine: false, client_providing_beer_wine: false, send_list: false });
  const [drinks, setDrinks] = useState<DrinkRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<{ mode: "confirmed" | "link"; message: string; list: { id: string; title: string; status: string }[] } | null>(null);
  const [link, setLink] = useState("");

  const menu = v.package ? (model === "service_fee" ? sfMenus : menus)[v.package] ?? null : null;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const setDrink = (i: number, patch: Partial<DrinkRow>) => setDrinks((list) => list.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const pickPackage = (pkg: string) => {
    setV((o) => ({ ...o, package: pkg }));
    setDrinks([]);
    if (pkg === "Beer and Wine") setFlags((f) => ({ ...f, beer: true, wine: true }));
  };

  const save = async (mode: "confirmed" | "link", confirmDuplicate = false) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/team/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v,
          pricing_model: model,
          ...(model === "service_fee" ? { package_price: "", gratuity: "", tip_jar: tipJar === "yes" } : { addons_total: "" }),
          ...flags,
          ...(calendarOnly ? { send_list: false, calendar_only: true } : {}),
          mode,
          confirm_duplicate: confirmDuplicate,
          drinks: drinks.map((d) => (d.kind === "menu" || menu?.pool === "classics" ? { key: d.key } : { name: d.name, ingredients: d.ingredients, is_mocktail: d.is_mocktail })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && Array.isArray(d.duplicate)) {
        setDuplicate({ mode, message: d.error, list: d.duplicate });
        return;
      }
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setDuplicate(null);
      if (d.mode === "link") setLink(d.link);
      else router.push(d.managerUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (link) {
    return (
      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Booking saved</h2>
        <p className="text-[15px] text-[#6B5D52]">Nothing was sent to the client. Copy their concierge link and send it yourself. The event shows on the events list once they finish.</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-white border border-[#DDD5CC] px-3 py-2 text-sm text-[#2C2420]">{link}</code>
          <CopyButton text={link} />
        </div>
        <a href="/team/admin/events" className="text-sm text-[#B5845A] underline">
          Back to events
        </a>
      </section>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
      <fieldset className={card}>
        <legend className="sr-only">What kind of event</legend>
        {(
          [
            [false, "New booking", "The client gets the normal booking messages from GHL."],
            [true, "Already confirmed, add to our calendar only", "Nothing is sent to GHL or the client. The team side works as normal."],
          ] as [boolean, string, string][]
        ).map(([on, label, hint]) => (
          <label key={label} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${calendarOnly === on ? "border-[#B5845A] bg-white" : "border-[#DDD5CC]"}`}>
            <input type="radio" name="kind" className="mt-1 h-4 w-4 accent-[#B5845A]" checked={calendarOnly === on} onChange={() => setCalendarOnly(on)} />
            <span>
              <span className="block text-[15px] font-medium text-[#2C2420]">{label}</span>
              <span className="block text-sm text-[#6B5D52]">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Client</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <input className={input} value={v.first_name ?? ""} onChange={set("first_name")} autoComplete="off" />
          </Field>
          <Field label="Last name">
            <input className={input} value={v.last_name ?? ""} onChange={set("last_name")} autoComplete="off" />
          </Field>
          <Field label="Email">
            <input className={input} type="email" value={v.email ?? ""} onChange={set("email")} autoComplete="off" />
          </Field>
          <Field label="Phone">
            <input className={input} type="tel" value={v.phone ?? ""} onChange={set("phone")} autoComplete="off" />
          </Field>
        </div>
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Event</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Event type" hint="Wedding, birthday, corporate...">
            <input className={input} value={v.event_type ?? ""} onChange={set("event_type")} />
          </Field>
          <Field label="Event name (optional)">
            <input className={input} value={v.event_name ?? ""} onChange={set("event_name")} />
          </Field>
          <Field label="Date">
            <input className={input} type="date" min={today || undefined} value={v.event_date ?? ""} onChange={set("event_date")} />
          </Field>
          <Field label="Guest count">
            <input className={input} inputMode="numeric" value={v.guest_count ?? ""} onChange={set("guest_count")} />
          </Field>
          <Field label="Bar service starts">
            <input className={input} type="time" value={v.bar_service_start ?? ""} onChange={set("bar_service_start")} />
          </Field>
          <Field label="Bar service ends">
            <input className={input} type="time" value={v.bar_service_end ?? ""} onChange={set("bar_service_end")} />
          </Field>
          <Field label="Arrival time" hint="When the bartenders arrive to set up.">
            <input className={input} type="time" value={v.arrival_time ?? ""} onChange={set("arrival_time")} />
          </Field>
          <Field label="Number of bartenders">
            <input className={input} inputMode="numeric" value={v.bartenders ?? ""} onChange={set("bartenders")} />
          </Field>
        </div>
        <Field label="Address" hint="Street, city, state and zip. The market comes from this.">
          <input className={input} value={v.event_address ?? ""} onChange={set("event_address")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Theme">
            <input className={input} value={v.theme ?? ""} onChange={set("theme")} />
          </Field>
          <Field label="Colors">
            <input className={input} value={v.event_colors ?? ""} onChange={set("event_colors")} />
          </Field>
          <Field label="Day of contact name">
            <input className={input} value={v.day_of_contact_name ?? ""} onChange={set("day_of_contact_name")} />
          </Field>
          <Field label="Day of contact phone">
            <input className={input} type="tel" value={v.day_of_contact_phone ?? ""} onChange={set("day_of_contact_phone")} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className={input} rows={3} value={v.notes ?? ""} onChange={set("notes")} />
        </Field>
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Package and drinks</h2>
        <div className="grid gap-3 grid-cols-2">
          <Field label="Booked on">
            <input
              className={input}
              type="date"
              max={today || undefined}
              value={v.booked_on ?? ""}
              onChange={(e) => {
                const day = e.target.value;
                setV((o) => ({ ...o, booked_on: day }));
                if (day) changeModel(modelFor(day));
              }}
            />
          </Field>
          <Field label="Pricing model">
            <select className={input} value={model} onChange={(e) => changeModel(e.target.value as Model)}>
              <option value="gratuity">Gratuity model</option>
              <option value="service_fee">Service fee model</option>
            </select>
          </Field>
          {model === "service_fee" && (
            <Field label="Tip jar" hint="Staff see this on the event Details.">
              <select className={input} value={tipJar} onChange={(e) => setTipJar(e.target.value as "yes" | "no")}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
          )}
        </div>
        <p className="text-xs text-[#A39585]">Booked on November 23, 2026 or earlier is the gratuity model, after that the service fee model. Pick the other one if this booking is different.</p>
        <Field label="Package">
          <select className={input} value={v.package} onChange={(e) => pickPackage(e.target.value)}>
            <option value="">Pick a package</option>
            {modelPackages.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#2C2420]">
          {(["beer", "wine", "client_providing_beer_wine"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-[#B5845A]" checked={flags[k]} onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))} />
              {k === "beer" ? "Beer" : k === "wine" ? "Wine" : "Client provides the beer and wine"}
            </label>
          ))}
        </div>
        {menu?.pool === "set" && <p className="text-sm text-[#6B5D52]">Dive Bar has its set menu: {diveSetMenu.join(", ")}. No drinks to pick.</p>}
        {menu?.pool === "none" && <p className="text-sm text-[#6B5D52]">Beer and Wine has no signature drinks.</p>}
        {menu && menu.max > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-[#6B5D52]">
              {menu.included} signature drinks are included. Each one past that is $50, up to {menu.max}.{" "}
              {menu.pool === "classics"
                ? "Classics only: no specialty menu, no mocktails, no custom drinks."
                : `${menu.pool === "craft" ? "Specialty menu only, no mocktails." : "Specialty menu and classics, mocktails allowed."} A custom drink needs its exact recipe.`}
            </p>
            {drinks.map((d, i) => (
              <div key={i} className="rounded-xl border border-[#DDD5CC] bg-white px-3 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[#2C2420]">Drink {i + 1}{i >= menu.included ? " (additional, $50)" : ""}</span>
                  <button type="button" onClick={() => setDrinks((list) => list.filter((_, j) => j !== i))} className="text-sm text-[#A0412D] underline">
                    Remove
                  </button>
                </div>
                {menu.pool !== "classics" && (
                <div className="flex gap-4 text-sm text-[#2C2420]">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" className="accent-[#B5845A]" checked={d.kind === "menu"} onChange={() => setDrink(i, { kind: "menu" })} /> From our menu
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" className="accent-[#B5845A]" checked={d.kind === "custom"} onChange={() => setDrink(i, { kind: "custom" })} /> Custom drink
                  </label>
                </div>
                )}
                {d.kind === "menu" || menu.pool === "classics" ? (
                  <>
                    <select className={input} value={d.key} onChange={(e) => setDrink(i, { key: e.target.value })}>
                      <option value="">Pick a drink</option>
                      {[...new Set(menu.drinks.map((m) => m.group))].map((g) => (
                        <optgroup key={g} label={g}>
                          {menu.drinks.filter((m) => m.group === g).map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {d.key && <p className="text-xs text-[#6B5D52]">{menu.drinks.find((m) => m.key === d.key)?.ingredients}</p>}
                  </>
                ) : (
                  <>
                    <input className={input} placeholder="Drink name" value={d.name} onChange={(e) => setDrink(i, { name: e.target.value })} />
                    <textarea className={input} rows={3} placeholder={"One ingredient per line, with amounts:\n2 oz vodka\n0.5 oz lime juice\nTop with ginger beer"} value={d.ingredients} onChange={(e) => setDrink(i, { ingredients: e.target.value })} />
                    {menu.mocktails && (
                      <label className="flex items-center gap-2 text-sm text-[#2C2420]">
                        <input type="checkbox" className="h-4 w-4 accent-[#B5845A]" checked={d.is_mocktail} onChange={(e) => setDrink(i, { is_mocktail: e.target.checked })} /> Mocktail
                      </label>
                    )}
                  </>
                )}
              </div>
            ))}
            {drinks.length < menu.max && (
              <button type="button" onClick={() => setDrinks((list) => [...list, blankDrink()])} className="rounded-lg border-2 border-[#B5845A] text-[#9A7049] px-4 py-2 text-sm font-medium">
                Add a drink
              </button>
            )}
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="font-heading text-base font-bold text-[#2C2420]">Price (optional)</h2>
        {model === "service_fee" && (
          <p className="text-xs text-[#A39585]">Service fee model: the service fee (20%, 10% on Premium) is carved out of the total less add ons.</p>
        )}
        <div className="grid gap-3 grid-cols-2">
          {model === "service_fee" ? (
            <Field label="Add ons inside the total">
              <input className={input} inputMode="decimal" value={v.addons_total ?? ""} onChange={set("addons_total")} />
            </Field>
          ) : (
            <>
              <Field label="Package price">
                <input className={input} inputMode="decimal" value={v.package_price ?? ""} onChange={set("package_price")} />
              </Field>
              <Field label="Gratuity">
                <input className={input} inputMode="decimal" value={v.gratuity ?? ""} onChange={set("gratuity")} />
              </Field>
            </>
          )}
          <Field label="Total">
            <input className={input} inputMode="decimal" value={v.total ?? ""} onChange={set("total")} />
          </Field>
          <Field label="Deposit paid">
            <input className={input} inputMode="decimal" value={v.deposit_paid ?? ""} onChange={set("deposit_paid")} />
          </Field>
        </div>
      </section>

      <section className={card}>
        {!calendarOnly && (
          <label className="flex items-start gap-2 text-[15px] text-[#2C2420]">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[#B5845A]" checked={flags.send_list} onChange={(e) => setFlags((f) => ({ ...f, send_list: e.target.checked }))} />
            <span>
              Send the client their list
              <span className="block text-xs text-[#A39585]">Off: the client is not sent their shopping list. Nothing else is ever sent to the client from here.</span>
            </span>
          </label>
        )}
        {duplicate && (
          <div className="rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-3 space-y-2">
            <p className="text-[15px] text-[#2C2420]">{duplicate.message}</p>
            <ul className="text-sm text-[#6B5D52] list-disc pl-5">
              {duplicate.list.map((d) => (
                <li key={d.id}>
                  {d.title} ({d.status === "submitted" ? "confirmed" : "concierge not finished"})
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => save(duplicate.mode, true)} className="rounded-lg bg-[#B5845A] text-white px-4 py-2 text-sm font-medium disabled:opacity-40">
                Save anyway
              </button>
              <button type="button" disabled={busy} onClick={() => setDuplicate(null)} className="rounded-lg border-2 border-[#B5845A] text-[#9A7049] px-4 py-2 text-sm font-medium disabled:opacity-40">
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-[#A0412D]">{error}</p>}
        <div className="flex flex-col sm:flex-row gap-2">
          <button type="button" disabled={busy || !!duplicate} onClick={() => save("confirmed")} className="rounded-lg bg-[#B5845A] text-white px-4 py-2.5 text-[15px] font-medium disabled:opacity-40">
            {busy ? "Saving..." : "Save as a confirmed event"}
          </button>
          {!calendarOnly && (
            <button type="button" disabled={busy || !!duplicate} onClick={() => save("link")} className="rounded-lg border-2 border-[#B5845A] text-[#9A7049] px-4 py-2.5 text-[15px] font-medium disabled:opacity-40">
              Save and send the client the concierge link
            </button>
          )}
        </div>
        {calendarOnly ? (
          <div className="rounded-xl border border-[#E3C9A0] bg-[#FFF8EC] px-3 py-3 space-y-1.5" data-calendar-only-note>
            <p className="text-[15px] font-medium text-[#2C2420]">Calendar only. For this client:</p>
            <ul className="list-disc pl-5 text-sm text-[#2C2420] space-y-0.5">
              {CALENDAR_ONLY_SKIPPED.map((s) => (
                <li key={s.key}>{s.label}</li>
              ))}
            </ul>
            <p className="text-sm text-[#6B5D52]">The team side works as normal: staffing, texts to staff, Tools, Supplies, ice, menu pickup, chat, clock and wrap up. You can turn on client messages later from the event.</p>
          </div>
        ) : (
          <p className="text-xs text-[#A39585]">A confirmed event gets its lists, Tools, recipes and market right away. The link option saves the booking, and the client fills in the rest themselves.</p>
        )}
      </section>
    </form>
  );
}
