"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PAY_PACKAGES, PAY_PACKAGE_LABEL, SERVICE_FEE_RATE_DEFAULTS, SERVICE_FEE_RATE_KEYS, SERVICE_FEE_RATE_LABEL, type MileageSettings, type PackageRates } from "@/lib/team/pay";
import { SF_SUPPLY_LABEL, SF_SUPPLY_PACKAGES, SUPPLY_PACKAGES, SUPPLY_PACKAGE_LABEL, type CostSettings, type SfSuppliesPerGuest, type SuppliesPerGuest } from "@/lib/team/business-settings";

// Business settings, admins only: hourly rate by package and mileage (staff pay), costs and supplies per guest (the Business area).
const input = "w-full rounded-lg border border-[#DDD5CC] px-3 py-2 text-[16px]";
const btn = "rounded-lg bg-[#B5845A] text-white px-3 py-2 text-sm font-medium disabled:opacity-50";

export default function SettingsForm({
  mileage,
  costs,
  perGuest,
  rates,
  sfPerGuest,
}: {
  mileage: MileageSettings;
  costs: CostSettings;
  perGuest: SuppliesPerGuest;
  rates: PackageRates;
  sfPerGuest: SfSuppliesPerGuest;
}) {
  const router = useRouter();
  const [m, setM] = useState({ thresholdMiles: String(mileage.thresholdMiles), deductionMiles: String(mileage.deductionMiles), rate: (mileage.rateCents / 100).toFixed(2), caRate: (mileage.caRateCents / 100).toFixed(2) });
  const [c, setC] = useState({ burdenPct: String(costs.burdenPct), cardPct: String(costs.cardPct), cardFixed: (costs.cardFixedCents / 100).toFixed(2) });
  const [g, setG] = useState<Record<string, string>>(Object.fromEntries(SUPPLY_PACKAGES.map((k) => [k, perGuest[k] === null ? "" : (perGuest[k]! / 100).toFixed(2)])));
  const [r, setR] = useState<Record<string, string>>(Object.fromEntries(PAY_PACKAGES.map((k) => [k, (rates[k] / 100).toFixed(2)])));
  const sfRates = rates.serviceFee ?? SERVICE_FEE_RATE_DEFAULTS;
  const [sf, setSf] = useState<Record<string, string>>(Object.fromEntries(SERVICE_FEE_RATE_KEYS.map((k) => [k, (sfRates[k] / 100).toFixed(2)])));
  const [sg, setSg] = useState<Record<string, string>>(Object.fromEntries(SF_SUPPLY_PACKAGES.map((k) => [k, (sfPerGuest[k] / 100).toFixed(2)])));
  const [msg, setMsg] = useState<{ which: string; text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (which: "rates" | "sf_rates" | "mileage" | "costs" | "supplies" | "sf_supplies", body: Record<string, string>) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/team/admin/business/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ which, ...body }) }).catch(() => null);
    setBusy(false);
    const data = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
    setMsg({ which, text: res?.ok ? "Saved." : (data.error ?? "Could not save. Try again."), error: !res?.ok });
    if (res?.ok) router.refresh();
  };
  const field = (label: string, value: string, set: (v: string) => void, hint?: string) => (
    <label className="text-sm text-[#2C2420]">
      {label}
      <input className={input} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
      {hint && <span className="text-xs text-[#6B5D52]">{hint}</span>}
    </label>
  );
  return (
    <section className="rounded-2xl border border-[#DDD5CC] bg-white px-4 py-3 space-y-4" aria-label="Business settings" id="settings">
      <h2 className="font-heading text-base font-bold text-[#2C2420]">Business settings</h2>
      <div className="space-y-2" id="rates">
        <h3 className="text-sm font-semibold text-[#2C2420]">Hourly rate by package, gratuity model events</h3>
        <p className="text-xs text-[#6B5D52]">
          The rate for a person on an event is their own rate when one is set on their profile, otherwise this package rate. Any package not listed here pays $30.00 an hour. Used for the pay estimate, the Payout card, Payroll and Business labor.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {PAY_PACKAGES.map((k) => (
            <label key={k} className="text-sm text-[#2C2420]">
              {PAY_PACKAGE_LABEL[k]}, $ an hour
              <input className={input} inputMode="decimal" value={r[k]} onChange={(e) => setR({ ...r, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <button type="button" className={btn} disabled={busy} onClick={() => save("rates", r)}>
          Save rates
        </button>
        {msg?.which === "rates" && <p className={`text-sm ${msg.error ? "text-[#A0412D]" : "text-[#55684A]"}`}>{msg.text}</p>}
      </div>
      <div className="space-y-2" id="sf-rates">
        <h3 className="text-sm font-semibold text-[#2C2420]">Hourly rate, service fee model events</h3>
        <p className="text-xs text-[#6B5D52]">
          Bartenders get the rate for the event&apos;s package. Bar backs, servers and event helpers get the support rate. A person&apos;s own rate counts only when it is higher. No gratuity share on these events.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SERVICE_FEE_RATE_KEYS.map((k) => (
            <label key={k} className="text-sm text-[#2C2420]">
              {k === "support" ? SERVICE_FEE_RATE_LABEL[k] : `${SERVICE_FEE_RATE_LABEL[k]} bartenders`}, $ an hour
              <input className={input} inputMode="decimal" value={sf[k]} onChange={(e) => setSf({ ...sf, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <button type="button" className={btn} disabled={busy} onClick={() => save("sf_rates", sf)}>
          Save service fee rates
        </button>
        {msg?.which === "sf_rates" && <p className={`text-sm ${msg.error ? "text-[#A0412D]" : "text-[#55684A]"}`}>{msg.text}</p>}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#2C2420]">Mileage pay</h3>
        <div className="grid grid-cols-2 gap-2">
          {field("Threshold, one way miles", m.thresholdMiles, (v) => setM({ ...m, thresholdMiles: v }), "At or under: no mileage")}
          {field("Deduction, miles", m.deductionMiles, (v) => setM({ ...m, deductionMiles: v }), "Off the round trip, once")}
          {field("Rate, $ a mile", m.rate, (v) => setM({ ...m, rate: v }))}
          {field("California rate, $ a mile", m.caRate, (v) => setM({ ...m, caRate: v }), "Los Angeles market events")}
        </div>
        <button type="button" className={btn} disabled={busy} onClick={() => save("mileage", m)}>
          Save mileage
        </button>
        {msg?.which === "mileage" && <p className={`text-sm ${msg.error ? "text-[#A0412D]" : "text-[#55684A]"}`}>{msg.text}</p>}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#2C2420]">Costs</h3>
        <div className="grid grid-cols-2 gap-2">
          {field("Payroll burden, % of labor", c.burdenPct, (v) => setC({ ...c, burdenPct: v }))}
          {field("Card processing, %", c.cardPct, (v) => setC({ ...c, cardPct: v }), "Confirm your rate")}
          {field("Card fixed fee, $ a charge", c.cardFixed, (v) => setC({ ...c, cardFixed: v }), "Confirm your rate")}
        </div>
        <button type="button" className={btn} disabled={busy} onClick={() => save("costs", c)}>
          Save costs
        </button>
        {msg?.which === "costs" && <p className={`text-sm ${msg.error ? "text-[#A0412D]" : "text-[#55684A]"}`}>{msg.text}</p>}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#2C2420]">Supplies per guest, gratuity model events</h3>
        <p className="text-xs text-[#6B5D52]">Used when an event&apos;s Shopping list has no catalog costs, or for the share of items with no cost yet. Leave blank until you know the number.</p>
        <div className="grid grid-cols-2 gap-2">
          {SUPPLY_PACKAGES.map((k) => (
            <label key={k} className="text-sm text-[#2C2420]">
              {SUPPLY_PACKAGE_LABEL[k] === "legacy packages" ? "Legacy packages" : SUPPLY_PACKAGE_LABEL[k]}, $ a guest
              <input className={input} inputMode="decimal" value={g[k]} placeholder="not set" onChange={(e) => setG({ ...g, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <button type="button" className={btn} disabled={busy} onClick={() => save("supplies", g)}>
          Save supplies per guest
        </button>
        {msg?.which === "supplies" && <p className={`text-sm ${msg.error ? "text-[#A0412D]" : "text-[#55684A]"}`}>{msg.text}</p>}
      </div>
      <div className="space-y-2" id="sf-supplies">
        <h3 className="text-sm font-semibold text-[#2C2420]">Supplies per guest, service fee model events</h3>
        <p className="text-xs text-[#6B5D52]">Replaces only the per guest estimate on service fee events. Supply costs entered by hand, receipts and the Shopping list still win.</p>
        <div className="grid grid-cols-2 gap-2">
          {SF_SUPPLY_PACKAGES.map((k) => (
            <label key={k} className="text-sm text-[#2C2420]">
              {SF_SUPPLY_LABEL[k]}, $ a guest
              <input className={input} inputMode="decimal" value={sg[k]} onChange={(e) => setSg({ ...sg, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <button type="button" className={btn} disabled={busy} onClick={() => save("sf_supplies", sg)}>
          Save service fee supplies
        </button>
        {msg?.which === "sf_supplies" && <p className={`text-sm ${msg.error ? "text-[#A0412D]" : "text-[#55684A]"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
