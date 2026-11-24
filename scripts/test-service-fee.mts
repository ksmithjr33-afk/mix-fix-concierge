// The service fee model: the engine against the owner's fixtures (fee
// included, recommended staffing), promos and custom prices, the booking
// webhook's money split (the quote tool example, custom and owner prices,
// settings not sent, unknown keys, mismatches), and which model a booking is on.
// Run: npm run test:service-fee

import { check, done } from "./team-harness.mts";

const sf = await import("../lib/service-fee.ts");
const pm = await import("../lib/pricing-model.ts");
const old = await import("../lib/pricing.ts");

const dollars = (c: number | null | undefined) => (c === null || c === undefined ? "null" : `$${(c / 100).toFixed(2)}`);

// ---------- the owner's fixtures ----------

type Fixture = [label: string, pkg: string, guests: number, hours: number, wedding: boolean, total: number, extra?: { woodenBar?: boolean; barback?: boolean }];
const fixtures: Fixture[] = [
  ["100 guests 4h Bartender Only", "beerwine", 100, 4, false, 1296],
  ["100 guests 4h Dive Bar", "dive", 100, 4, false, 1596],
  ["100 guests 4h Full Bar", "full", 100, 4, false, 1986],
  ["100 guests 4h Premium", "premium", 100, 4, false, 3141],
  ["100 guests 4h Premium, no wooden bar", "premium", 100, 4, false, 2563, { woodenBar: false }],
  ["Wedding 100 guests 4h Dive Bar", "dive", 100, 4, true, 1764],
  ["Wedding 100 guests 4h The Big Day Bar", "wedding", 100, 4, true, 2094],
  ["Wedding 100 guests 4h Full Bar with the barback", "full", 100, 4, true, 2394],
  ["Wedding 100 guests 4h Full Bar without the barback", "full", 100, 4, true, 2154, { barback: false }],
  ["Wedding 100 guests 4h Premium", "premium", 100, 4, true, 3295],
  ["20 guests 2h Bartender Only", "beerwine", 20, 2, false, 540],
  ["20 guests 2h Dive Bar", "dive", 20, 2, false, 648],
  ["20 guests 2h Full Bar", "full", 20, 2, false, 798],
  ["20 guests 2h Premium", "premium", 20, 2, false, 1722],
];
for (const [label, pkg, guests, hours, isWedding, total, extra] of fixtures) {
  const q = sf.quoteServiceFee({ package: pkg, guests, hours, isWedding, ...extra });
  check(`${label}: $${total}`, q?.totalCents === total * 100, `got ${dollars(q?.totalCents)} (package ${dollars(q?.packageCents)} + fee ${dollars(q?.feeCents)})`);
}

// ---------- engine details ----------

{
  const q = sf.quoteServiceFee({ package: "full", guests: 100, hours: 4, isWedding: false })!;
  check("Full Bar 100/4: 2 bartenders × 7 paid hours", q.bartenders === 2 && q.paidHours === 7);
  check("Full Bar 100/4: package $1,655.00, fee $331.00", q.packageCents === 165500 && q.feeCents === 33100);
  const p = sf.quoteServiceFee({ package: "premium", guests: 100, hours: 4, isWedding: false })!;
  check("Premium: 10% fee, $200 barback (4 service hours × $50)", p.feeBp === 1000 && p.barbackCents === 20000);
  check("Premium $3,140.50 rounds up to $3,141", p.packageCents + p.feeCents === 314050 && p.totalCents === 314100);
  const w = sf.quoteServiceFee({ package: "premium", guests: 100, hours: 4, isWedding: true })!;
  check("Premium wedding: no Full Bar barback line on top", w.barbackCents === 20000);
  const bd = sf.quoteServiceFee({ package: "wedding", guests: 100, hours: 4, isWedding: true })!;
  check("The Big Day Bar: barback included, no line", bd.barbackCents === 0);
  const bdNotWedding = sf.quoteServiceFee({ package: "big_day", guests: 100, hours: 4, isWedding: false })!;
  check("The Big Day Bar always prices with wedding setup hours", bdNotWedding.paidHours === 8 && bdNotWedding.totalCents === 209400);
  const fullNotWedding = sf.quoteServiceFee({ package: "full", guests: 100, hours: 4, isWedding: false, barback: true })!;
  check("Full Bar barback line only at a wedding", fullNotWedding.barbackCents === 0);
}
{
  const r = (g: number) => sf.quoteServiceFee({ package: "dive", guests: g, hours: 3, isWedding: false })!.bartenders;
  check("Recommended bartenders: 75 → 1, 76 → 2, 200 → 2, 201 → 3, 300 → 3, 301 → 4", r(75) === 1 && r(76) === 2 && r(200) === 2 && r(201) === 3 && r(300) === 3 && r(301) === 4);
  check("Recommended bartenders never above 4", r(900) === 4);
  const pick = (n: number) => sf.quoteServiceFee({ package: "dive", guests: 40, hours: 3, isWedding: false, bartenders: n })!.bartenders;
  check("Client picks 1 to 4", pick(3) === 3 && pick(9) === 4);
  const h = (n: number) => sf.quoteServiceFee({ package: "beerwine", guests: 40, hours: n, isWedding: false })!.serviceHours;
  check("Service hours held to 1 to 7", h(0.5) === 1 && h(9) === 7);
  const bo = sf.quoteServiceFee({ package: "beerwine", guests: 300, hours: 4, isWedding: false })!;
  check("Bartender Only: $0 a guest, $100 event fee", bo.guestCents === 0 && bo.eventFeeCents === 10000);
  const twenty = sf.quoteServiceFee({ package: "dive", guests: 20, hours: 2, isWedding: false })!;
  check("No 30 guest minimum: 20 guests bill 20", twenty.guestCents === 4000);
}

// ---------- package keys ----------

{
  const k = sf.serviceFeePackage;
  check("Bartender Only keys: beerwine, bartender_only, bartenderonly", k("beerwine") === "beerwine" && k("bartender_only") === "beerwine" && k("bartenderonly") === "beerwine");
  check("The Big Day Bar keys: wedding, bigday, big_day", k("wedding") === "wedding" && k("bigday") === "wedding" && k("big_day") === "wedding");
  check("Names as sent: Full Bar, Premium Bar, Dive Bar, The Big Day Bar", k("Full Bar") === "full" && k("Premium Bar") === "premium" && k("Dive Bar") === "dive" && k("The Big Day Bar") === "wedding");
  check("Not service fee packages: Beer and Wine, Essentials, Tailored, blank", k("Beer and Wine") === null && k("essentials") === null && k("Tailored Bar") === null && k("") === null);
}

// ---------- promos and custom prices ----------

{
  const input = { package: "full", guests: 100, hours: 4, isWedding: false };
  const r5 = sf.bookedServiceFee(input, { promoCode: "return5", addonsCents: 15000 })!;
  check("RETURN5: $82.75 off the package, fee on $1,572.25", r5.discountCents === 8275 && r5.packageCents === 157225 && r5.feeCents === 31445);
  check("RETURN5 with $150 add ons: $2,036.70 → $2,037", r5.totalCents === 203700);
  const c49 = sf.bookedServiceFee(input, { promoCode: "CLASS49" })!;
  check("CLASS49: $49 off the package, fee on $1,606.00", c49.packageCents === 160600 && c49.feeCents === 32120 && c49.totalCents === 192700);
  const custom = sf.bookedServiceFee(input, { customPriceCents: 180000, addonsCents: 15000 })!;
  check("Custom $1,800: package $1,500.00, fee $300.00, add ons outside", custom.packageCents === 150000 && custom.feeCents === 30000 && custom.totalCents === 195000);
  check("Custom price discount = standard − custom ($186)", custom.discountCents === 18600);
  const prem = sf.bookedServiceFee({ ...input, package: "premium" }, { customPriceCents: 300000 })!;
  check("Custom on Premium carves 10%: $2,727.27 + $272.73", prem.packageCents === 272727 && prem.feeCents === 27273);
  const code = sf.bookedServiceFee(input, { promoCode: "MF1500ZZ" })!;
  check("A custom price code is never decoded on the service fee model", code.discountCents === 0 && code.totalCents === 198600);
}

// ---------- the booking webhook split ----------

const base = {
  packageKey: "full",
  guests: 100,
  hours: 4,
  isWedding: false,
  bartenders: 2,
  woodenBar: null,
  barback: null,
  grandTotalCents: 203700,
  standardPriceCents: 198600,
  discountCents: 8275,
  customPriceCents: null,
  ownerOverride: false,
  addonsCents: 15000,
};

{
  const s = sf.splitWebhookMoney(base)!;
  check("Quote tool example: engine method, no check", s.method === "engine" && s.check === null, JSON.stringify(s));
  check("Quote tool example: package $1,572.25, fee $314.45, add ons $150.00", s.packageCents === 157225 && s.feeCents === 31445 && s.addonsCents === 15000);
  check("Quote tool example: total stored as the grand total $2,037", s.totalCents === 203700);
  check("Quote tool example: rate 20%", s.feeBp === 2000);
}
{
  const s = sf.splitWebhookMoney({ ...base, customPriceCents: 180000, discountCents: 18600, grandTotalCents: 195000 })!;
  check("Custom price: package $1,500, fee $300, add ons $150", s.method === "custom" && s.packageCents === 150000 && s.feeCents === 30000 && s.addonsCents === 15000 && s.check === null);
  const o = sf.splitWebhookMoney({ ...base, ownerOverride: true, customPriceCents: 150000, grandTotalCents: 165000 })!;
  check("Owner override: carved from custom_price", o.method === "custom" && o.packageCents === 125000 && o.feeCents === 25000 && o.check === null);
  const noCustom = sf.splitWebhookMoney({ ...base, ownerOverride: true })!;
  check("Owner override with no custom price: carved and flagged", noCustom.method === "carved" && !!noCustom.check);
  const off = sf.splitWebhookMoney({ ...base, customPriceCents: 180000, grandTotalCents: 220000 })!;
  check("Custom + add ons far from the total: carved from the total and flagged", off.method === "carved" && !!off.check && off.packageCents + off.feeCents === 220000 - 15000);
}
{
  // Premium with the wooden bar not sent: exactly one setting matches standard_price.
  const on = sf.splitWebhookMoney({ ...base, packageKey: "premium", standardPriceCents: 314100, discountCents: 0, addonsCents: 0, grandTotalCents: 314100 })!;
  check("Premium, wooden bar not sent, $3,141: matched with the wooden bar on", on.method === "engine" && on.standard?.eventFeeCents === 97500 && on.check === null);
  const offBar = sf.splitWebhookMoney({ ...base, packageKey: "premium", standardPriceCents: 256300, discountCents: 0, addonsCents: 0, grandTotalCents: 256300 })!;
  check("Premium, wooden bar not sent, $2,563: matched with the wooden bar off", offBar.method === "engine" && offBar.standard?.eventFeeCents === 45000 && offBar.check === null);
  const sentOn = sf.splitWebhookMoney({ ...base, packageKey: "premium", woodenBar: true, standardPriceCents: 256300, discountCents: 0, addonsCents: 0, grandTotalCents: 256300 })!;
  check("Premium, wooden bar sent on but the price is the off price: flagged", sentOn.method === "carved" && !!sentOn.check);
  // Full Bar wedding with the barback not sent.
  const fw = sf.splitWebhookMoney({ ...base, isWedding: true, standardPriceCents: 215400, discountCents: 0, addonsCents: 0, grandTotalCents: 215400 })!;
  check("Full Bar wedding, barback not sent, $2,154: matched without the barback", fw.method === "engine" && fw.standard?.barbackCents === 0 && fw.check === null);
  const fwOn = sf.splitWebhookMoney({ ...base, isWedding: true, standardPriceCents: 239400, discountCents: 0, addonsCents: 0, grandTotalCents: 239400 })!;
  check("Full Bar wedding, barback not sent, $2,394: matched with the barback", fwOn.method === "engine" && fwOn.standard?.barbackCents === 20000);
}
{
  const unknown = sf.splitWebhookMoney({ ...base, packageKey: "essentials" })!;
  check("Unknown package key: saved, carved from the total less add ons, flagged", unknown.method === "carved" && unknown.packageCents + unknown.feeCents === 188700 && /Unknown package key/.test(unknown.check ?? ""));
  const mismatch = sf.splitWebhookMoney({ ...base, standardPriceCents: 199000 })!;
  check("Engine does not match standard_price: carved and flagged", mismatch.method === "carved" && /engine prices this at \$1,986/.test(mismatch.check ?? ""));
  const noStd = sf.splitWebhookMoney({ ...base, standardPriceCents: null })!;
  check("No standard_price and no custom price: carved and flagged", noStd.method === "carved" && !!noStd.check);
  const badTotal = sf.splitWebhookMoney({ ...base, grandTotalCents: 210000 })!;
  check("Pieces more than $1 from the grand total: carved and flagged", badTotal.method === "carved" && !!badTotal.check);
  const penny = sf.splitWebhookMoney({ ...base, grandTotalCents: 203600 })!;
  check("Within $1 of the grand total: accepted", penny.method === "engine" && penny.check === null);
  check("No grand total: nothing to split", sf.splitWebhookMoney({ ...base, grandTotalCents: null }) === null);
  const prem = sf.splitWebhookMoney({ ...base, packageKey: "premium", standardPriceCents: null, discountCents: 0, addonsCents: 0, grandTotalCents: 110000 })!;
  check("Fallback on Premium carves 10%", prem.feeBp === 1000 && prem.packageCents === 100000 && prem.feeCents === 10000);
}

// ---------- which model ----------

{
  const m = pm.bookingPricingModel;
  check("pricing_model \"service fee model\" → service fee", m({ pricingModel: "service fee model", hasStandardPrice: false, hasAddonsTotal: false }).model === "service_fee");
  check("pricing_model \"gratuity model\" → gratuity, no check", (() => { const r = m({ pricingModel: "gratuity model", hasStandardPrice: true, hasAddonsTotal: false }); return r.model === "gratuity" && r.check === null; })());
  check("No pricing_model but standard_price → service fee", m({ pricingModel: null, hasStandardPrice: true, hasAddonsTotal: false }).model === "service_fee");
  check("No pricing_model but addons_total → service fee", m({ pricingModel: "", hasStandardPrice: false, hasAddonsTotal: true }).model === "service_fee");
  const none = m({ pricingModel: "{{contact.pricing_model}}", hasStandardPrice: false, hasAddonsTotal: false });
  check("None of the three → gratuity, flagged for a check", none.model === "gratuity" && none.check === pm.NO_MODEL_CHECK);
  check("Booked on 2026-11-23 → gratuity, 2026-11-24 → service fee", pm.defaultModelForBookedOn("2026-11-23") === "gratuity" && pm.defaultModelForBookedOn("2026-11-24") === "service_fee");
  check("A session with no model is on the gratuity model", pm.sessionPricingModel({}) === "gratuity" && pm.sessionPricingModel({ pricing_model: "service_fee" }) === "service_fee");
}

// ---------- the wording and the old engine ----------

check(
  "Fee sentence is exactly the owner's wording",
  sf.SERVICE_FEE_TEXT === "Service fee covers staffing, setup, travel, and insurance. It is not a gratuity. Tips are optional and go entirely to your bar team."
);
check("Gratuity model engine unchanged: Full 100/4 tip jar $1,749", old.priceEvent({ package: "full", guests: 100, hours: 4, isWedding: false, bartenders: 2, tipJar: true })?.total === 1749);

done("service fee");
