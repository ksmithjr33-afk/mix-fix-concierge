// The service fee model: the engine against the owner's fixtures (fee
// included, recommended staffing), promos and custom prices, the booking
// webhook's money split (the quote tool example, custom and owner prices,
// settings not sent, unknown keys, mismatches), and which model a booking is on.
// Run: npm run test:service-fee

import { check, done, src } from "./team-harness.mts";

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

// ---------- staff pay on service fee events ----------

{
  const pay = await import("../lib/team/pay.ts");
  const payout = await import("../lib/team/payout.ts");
  const bs = await import("../lib/team/business-settings.ts");
  const rates = { ...pay.PACKAGE_RATE_DEFAULTS, serviceFee: pay.SERVICE_FEE_RATE_DEFAULTS };
  const sfCtx = (role: string) => ({ model: "service_fee", role });
  const r = (own: number | null, pkg: string, role: string) => pay.lineRate(own, pkg, rates, sfCtx(role));
  check("Service fee bartender with no standing (the Business estimate): the Top rate, $45, on every package", ["Bartender Only", "Dive Bar", "The Big Day Bar", "Full Bar", "Premium Bar"].every((p) => r(null, p, "bartender").cents === 4500 && r(null, p, "bartender").source === "service_fee"));
  check("Service fee bar back, server, event helper: $30", ["bar_back", "server", "event_helper"].every((role) => r(null, "Full Bar", role).cents === 3000 && r(null, "Full Bar", role).source === "support"));
  check("Personal rate only when higher: $50 wins, $35 does not", r(5000, "Full Bar", "bartender").cents === 5000 && r(5000, "Full Bar", "bartender").source === "own" && r(3500, "Full Bar", "bartender").cents === 4500);
  check("Support role with a $35 personal rate gets $35 (higher than $30)", r(3500, "Full Bar", "bar_back").cents === 3500);
  check("Top rate from settings", pay.lineRate(null, "Premium Bar", { ...rates, serviceFee: { ...pay.SERVICE_FEE_RATE_DEFAULTS, top: 5200 } }, sfCtx("bartender")).cents === 5200);
  check("Gratuity events unchanged: $25 Beer and Wine bar back, own rate always wins", pay.lineRate(null, "Beer and Wine", rates, { model: "gratuity", role: "bar_back" }).cents === 2500 && pay.lineRate(2000, "Full Bar", rates, { model: "gratuity", role: "bartender" }).cents === 2000);
  check("No context means the gratuity rules (older callers)", pay.lineRate(null, "Full Bar", rates).cents === 3000);
  check("A session with no model is a gratuity event", pay.lineRate(null, "Full Bar", rates, { model: null, role: "bartender" }).cents === 3000);
  check("Rate text on a service fee event: only \"your rate\"", pay.rateSourceText({ source: "service_fee", pkg: "full" }) === "your rate" && pay.rateSourceText({ source: "support", pkg: "full" }) === "your rate" && pay.rateSourceText({ source: "own", pkg: "full", serviceFee: true }) === "your rate");
  const tips = pay.tipsShare(164, 2, true, "service_fee");
  check("No gratuity split on a service fee event, even with a gratuity stored", tips.state === "service_fee" && !pay.tipsText(tips).includes("$"));
  check("Gratuity events still split the gratuity", pay.tipsShare(164, 2, true, "gratuity").state === "on_file");
  const est = pay.staffEstimate({ rate: r(null, "Full Bar", "bartender"), minutes: 7 * 60, mileage: { state: "no_address" }, tips });
  check("Estimate: 7 h × $45 = $315, no tips", est.hourlyCents === 31500 && est.totalCents === 31500 && est.serviceFee === true);
  const row = payout.payoutRow({ staffId: "s", assignmentId: "a", name: "A", role: "bartender", estimate: est, sheet: null });
  check("Payout row: tips $0, flagged service fee, total $315", row.tipsCents === 0 && row.serviceFee === true && row.totalCents === 31500);
  check("Payout copy says no gratuity share", payout.payoutText("T", [row], payout.payoutTotals([row])).includes("no gratuity share"));
  check("Service fee rate settings: defaults and validation", bs.readServiceFeeRates(null).top === 4500 && bs.readServiceFeeRates({ support: 3200 }).support === 3200 && !bs.validateServiceFeeRates({ beerwine: "45" }).ok);
}

// ---------- price changes on service fee events ----------

{
  const pc = await import("../lib/price-change.ts");
  const ae = await import("../lib/team/admin-edit.ts");
  const eu = await import("../lib/event-updates.ts");
  const basis = { package: "full", guests: 100, hours: 4, isWedding: false, bartenders: 2, tipJar: true, woodenBar: true };
  const booked = {
    pricing_model: "service_fee" as const, total: 2037, package_price: 1572.25, service_fee: 314.45, service_fee_rate: 0.2, addons_total: 150,
    gratuity: null, bartenders: 2, promo_code: "RETURN5", custom_price: null, discount_amount: 82.75, tip_jar: true, deposit_paid: 0, source: "create-session" as const, basis,
  };
  const stored = { package: "Full Bar", guest_count: 100, hours_booked: 4, bartenders: 2, event_type: "Birthday" };
  const session = { package_type: "Full Bar", guest_count: "100", hours_booked: "4", pricing_model: "service_fee" };
  const change = (next: Record<string, unknown>, changes: { field: string; old: unknown; new: unknown }[], b: Record<string, unknown> = booked) =>
    pc.buildPriceChange({ booked: b as never, original: basis, stored: stored as never, nextEvent: { ...stored, ...next } as never, session, changes: changes as never });

  const up = change({ guest_count: 150 }, [{ field: "guest_count", old: 100, new: 150 }]);
  check("100 → 150 guests with RETURN5: package $1,786.00 (+$213.75), fee $357.20, add ons $150", up.package_price === 1786 && up.service_fee === 357.2 && up.addons_total === 150 && up.service_fee_rate === 0.2, JSON.stringify(up));
  check("100 → 150 guests: new total $2,293 (rounded), difference $256", up.new_total === 2293 && up.amount === 256);
  check("No gratuity on a service fee change", up.gratuity === null);
  check("Price text: the difference, the fee on its own line, and the fee sentence", up.price_text.includes("brings your new total to $2,293") && up.price_text.includes("Service fee (20%) $357.20") && up.price_text.includes("It is not a gratuity.") && !/gratuity is included|gratuity of/i.test(up.price_text));
  const down = change({ guest_count: 80 }, [{ field: "guest_count", old: 100, new: 80 }]);
  check("Fewer guests: the fee goes down with the package", down.package_price! < 1572.25 && down.service_fee! < 314.45 && down.amount! < 0);
  const prem = change({ package: "Premium Bar" }, [{ field: "package", old: "Full Bar", new: "Premium Bar" }]);
  check("Full Bar → Premium: the fee rate drops to 10%", prem.service_fee_rate === 0.1 && Math.abs(prem.service_fee! - Math.round(prem.package_price! * 10) / 100) < 0.01);
  const custom = change({ guest_count: 150 }, [{ field: "guest_count", old: 100, new: 150 }], { ...booked, promo_code: null, custom_price: 1800, package_price: 1500, service_fee: 300, total: 1950 });
  check("Custom price keeps its deal: the standard difference only ($1,500 + $225)", custom.package_price === 1725 && custom.service_fee === 345 && custom.new_total === 2220);
  const after = pc.bookedAfter(booked as never, up, 2, "t");
  check("Booked price after the change: total, package, fee and add ons move together", after.total === 2293 && after.package_price === 1786 && after.service_fee === 357.2 && after.addons_total === 150 && after.gratuity === null);
  const manual = ae.adminPrice(up, "manual", 2400, "Kim");
  check("Edit price by hand: the fee is carved out of $2,400 less $150 add ons ($1,875 + $375)", manual.new_total === 2400 && manual.package_price === 1875 && manual.service_fee === 375);
  const kept = ae.adminPrice(up, "keep", null, "Kim");
  check("Keep the booked total: package and fee stay as booked", kept.new_total === 2037 && pc.bookedAfter(booked as never, kept, 2, "t").service_fee === 314.45);
  const drinks = eu.extraDrinksPrice([{ name: "Paloma" }], null, booked as never, { pending: false });
  check("Extra drink on a service fee event: an add on, no fee, package untouched", drinks.new_total === 2087 && drinks.addons_total === 200 && drinks.package_price === 1572.25 && drinks.service_fee === 314.45);
  check("Breakdown line", pc.serviceFeeBreakdown(booked) === "Package $1,572.25 · Service fee (20%) $314.45 · Add ons $150");
  const grat = pc.buildPriceChange({ booked: { ...booked, pricing_model: undefined, package_price: 1585, gratuity: 164, total: 1749, promo_code: null } as never, original: basis, stored: stored as never, nextEvent: { ...stored, guest_count: 150 } as never, session: { ...session, pricing_model: "gratuity" }, changes: [{ field: "guest_count", old: 100, new: 150 }] as never });
  check("Gratuity events still price with the old engine (no fee fields)", grat.service_fee === undefined && grat.gratuity !== null && grat.new_total !== null);
  const baseline = pc.computeBaseline(stored as never, session, { promoCode: "CLASS49" });
  check("A service fee event with no booked price gets a service fee baseline ($1,927)", baseline?.pricing_model === "service_fee" && baseline.total === 1927 && baseline.gratuity === null);
}

// ---------- Business tab on service fee events ----------

{
  const biz = await import("../lib/team/business.ts");
  const bset = await import("../lib/team/business-settings.ts");
  const { staffingFor } = await import("../lib/pricing.ts");
  // Full Bar, 100 guests, 2 bartenders at $45 for 7 hours, $2,037 with a $314.45 fee, $150 add ons.
  const base = {
    today: "2026-11-24", eventDay: "2027-03-20", done: false, totalCents: 203700, gratuityCents: null,
    serviceFee: { feeCents: 31445, rate: 0.2 }, pricePending: false, defaultDepositCents: 15000, finance: null, payments: [],
    crew: [] as { rateCents: number; estPayCents: number | null; actualPayCents: number | null; mileageCents: number; mileageRecorded?: boolean }[],
    bookedBartenders: 2, guests: 100, scheduledMinutes: 420, bookedMinutes: 420, defaultRateCents: 4500, staffingFor,
    supplyLines: null, perGuestCents: bset.SF_SUPPLY_DEFAULTS.full, packageLabel: "Full Bar (service fee events)", other: [], settings: bset.COST_DEFAULTS,
  };
  const cost = (b: ReturnType<typeof biz.eventBusiness>, k: string) => b.costs.find((c) => c.key === k)!;
  const b = biz.eventBusiness(base);
  check("Revenue: service fee $314.45 (20%) inside the total, no gratuity", b.revenue.serviceFee && b.revenue.serviceFeeCents === 31445 && b.revenue.serviceFeeRate === 0.2 && b.revenue.gratuityCents === null && !b.revenue.noGratuity);
  check("Tips paid out: $0 on a service fee event", cost(b, "tips").cents === 0);
  check("Supplies: $3.50 a guest × 100 = $350", cost(b, "supplies").cents === 35000);
  check("Per guest defaults: $0.25, $1.25, $2.50, $3.50, $6.00", JSON.stringify(bset.SF_SUPPLY_DEFAULTS) === JSON.stringify({ beerwine: 25, dive: 125, wedding: 250, full: 350, premium: 600 }));
  check("Hand entered supplies still win over the per guest figure", cost(biz.eventBusiness({ ...base, finance: { session_id: "e", deposit_paid_cents: null, deposit_paid_on: null, balance_paid_cents: null, balance_paid_on: null, supplies_cents: 12345 } }), "supplies").cents === 12345);
  check("No mileage recorded: the $30 gas estimate", cost(b, "mileage").cents === 3000);
  const withMiles = biz.eventBusiness({ ...base, crew: [{ rateCents: 4500, estPayCents: 31500, actualPayCents: null, mileageCents: 2400, mileageRecorded: true }, { rateCents: 4500, estPayCents: 31500, actualPayCents: null, mileageCents: 0, mileageRecorded: true }] });
  check("Recorded mileage replaces the gas estimate, never both ($24)", cost(withMiles, "mileage").cents === 2400);
  check("Labor before anyone accepts: 2 × 7 h × $45 = $630; burden 15% kept", cost(b, "labor").cents === 63000 && cost(b, "burden").cents === 9450);
  check("Card fees kept", cost(b, "card").cents === biz.cardFee(203700, bset.COST_DEFAULTS));
  const grat = biz.eventBusiness({ ...base, serviceFee: null, gratuityCents: 16400 });
  check("Gratuity events unchanged: tips = gratuity, mileage only after the event", cost(grat, "tips").cents === 16400 && cost(grat, "mileage").cents === null && !grat.revenue.serviceFee);
  check("Service fee per guest settings validate", bset.readSfSupplies({ full: 400 }).full === 400 && bset.readSfSupplies(null).premium === 600 && !bset.validateSfSupplies({ full: "x" }).ok);
}

// ---------- wording on service fee events ----------

{
  const home = await import("../lib/event-home.ts");
  const up = await import("../lib/update-prompt.ts");
  const ae = await import("../lib/team/admin-edit.ts");
  const ed = await import("../lib/event-diff.ts");
  const pv = (serviceFee: boolean) => home.paymentView({ money: home.ALL_MONEY, total: 2037, pricePending: false, eventDay: "2027-03-20", recorded: null, preference: "", serviceFee });
  check("Client page: the fee sentence under the total on a service fee event", pv(true)?.feeNote === sf.SERVICE_FEE_TEXT && pv(true)?.total === "$2,037");
  check("Client page: no fee sentence on a gratuity event", pv(false)?.feeNote === "");
  check("Client page: no sentence while a new price is being confirmed", home.paymentView({ money: home.ALL_MONEY, total: 2037, pricePending: true, eventDay: "2027-03-20", recorded: null, preference: "", serviceFee: true })?.feeNote === "");
  check("Client card labels it Total and renders the note", src("app/_event-home/sections.tsx").includes('payment.feeNote ? "Total" : "Package total"') && src("app/_event-home/sections.tsx").includes("data-fee-note"));
  const deadlines = ed.computeDeadlines("2027-03-20", new Date("2026-11-24T12:00:00Z"));
  const withRule = up.buildUpdatePrompt({ package: "Full Bar" } as never, 3, deadlines, { serviceFee: true });
  const without = up.buildUpdatePrompt({ package: "Full Bar" } as never, 3, deadlines, {});
  check("Concierge quotes: the service fee rule and exact sentence on service fee events only", withRule.includes("SERVICE FEE EVENT") && withRule.includes(sf.SERVICE_FEE_TEXT) && !without.includes("SERVICE FEE EVENT"));
  check("The chat route turns the rule on from the event's model", src("app/api/chat/route.ts").includes("serviceFee: isServiceFeeEvent(session.booked_price, session)"));
  const engine = { changes: [], requested_at: "t", amount: 256, new_total: 2293, package_price: 1786, gratuity: null, service_fee: 357.2, service_fee_rate: 0.2, addons_total: 150, price_text: "x", summary: "", basis: null, class49_applied: false, booked_total: 2037, deposit_paid: 0 };
  const manual = ae.adminPrice(engine as never, "manual", 2400, "Kim");
  check("Change order text set by hand: the fee line and the exact sentence, no gratuity", manual.price_text.includes("Service fee (20%) $375") && manual.price_text.includes(sf.SERVICE_FEE_TEXT) && !/gratuity is|gratuity of|\bgratuity:/i.test(manual.price_text));
  const gratManual = ae.adminPrice({ ...engine, service_fee: undefined, service_fee_rate: undefined, addons_total: undefined } as never, "manual", 2400, "Kim");
  check("Gratuity events: hand set text unchanged", gratManual.price_text === "Kim set the new total to $2,400, a difference of $363." && !gratManual.price_text.includes("Service fee"));
}

// ---------- GHL change notice ----------

{
  const pc = await import("../lib/price-change.ts");
  const sfChange = { changes: [], requested_at: "t", amount: 256, new_total: 2293, package_price: 1786, gratuity: null, service_fee: 357.2, service_fee_rate: 0.2, addons_total: 150, price_text: "x", summary: "", basis: null, class49_applied: false, booked_total: 2037, deposit_paid: 0 };
  const f = pc.pendingChangeFields(sfChange as never, [{ field: "guest_count", old: 100, new: 150 }] as never, { event_data: { guest_count: 150 } } as never);
  check("pending_change_service_fee carries the new fee ($357.20), package price is the package alone", f.pending_change_service_fee === 357.2 && f.pending_change_package_price === 1786 && f.pending_change_gratuity === null);
  const g = pc.pendingChangeFields({ ...sfChange, service_fee: undefined, gratuity: 180 } as never, [], { event_data: {} } as never);
  check("Gratuity events: pending_change_service_fee is empty, gratuity as before", g.pending_change_service_fee === null && g.pending_change_gratuity === 180);
  check("No price change: pending_change_service_fee is empty", pc.pendingChangeFields(null, [], { event_data: {} } as never).pending_change_service_fee === null);
  check("Price pending blanks pending_change_service_fee too", src("lib/update-notes.ts").includes('"pending_change_service_fee"'));
}

// ----- The new Bartender Only shopping list -----
{
  const sl = await import("../lib/shopping-list.ts");
  const os = await import("../lib/order-sheet.ts");
  const bo = await import("../lib/bartender-only.ts");
  const base = {
    package: "Bartender Only",
    guest_count: 80,
    bar_service_start: "6:00 PM",
    bar_service_end: "10:00 PM",
    event_date: "January 10, 2027",
    event_type: "Birthday",
    beer: true,
    signature_drinks: [
      { name: "Spicy Margarita", ingredients: ["2 oz tequila", "1 oz lime juice", "0.75 oz agave", "jalapeno"], garnish: "lime wheel" },
      { name: "Nojito", is_mocktail: true, ingredients: ["mint", "lime juice", "simple syrup", "club soda"], garnish: "mint sprig" },
    ],
  };
  const sfEd = { ...base, pricing_model: "service_fee" };
  const oldEd = { ...base, pricing_model: "gratuity" };
  const email = (ed: Record<string, unknown>) => sl.generateClientShoppingListEmail(sl.generateShoppingList(ed as never), ed as never, "Sam");
  const sfMail = email(sfEd);
  const oldMail = email(oldEd);
  const noModelMail = email(base);

  check("New Bartender Only: service fee model with the Bartender Only key", bo.isServiceFeeBartenderOnly(sfEd) && !bo.isServiceFeeBartenderOnly(oldEd) && !bo.isServiceFeeBartenderOnly(base));
  check("Only the Bartender Only name counts, not Beer and Wine or Tailored", !bo.isServiceFeeBartenderOnly({ package: "Tailored Bar", pricing_model: "service_fee" }) && !bo.isServiceFeeBartenderOnly({ package: "Full Bar", pricing_model: "service_fee" }));
  check("New Bartender Only list: alcohol for the drinks chosen", /LIQUOR[\s\S]*Tequila — 8 bottles/.test(sfMail) && /BEER & WINE[\s\S]*Beer/.test(sfMail));
  check("New Bartender Only list: mixers and garnishes for the drinks chosen", /MIXERS AND JUICES[\s\S]*Lime juice[\s\S]*Agave[\s\S]*Club soda/.test(sfMail) && /PRODUCE AND GARNISHES[\s\S]*Limes[\s\S]*Fresh mint/.test(sfMail));
  check("New Bartender Only list: ice and cups", /- Ice — 8 x 16 lb bags\n/.test(sfMail) && sfMail.includes("- 12 oz Cups — 240 count"));
  check("New Bartender Only list: says the client buys all of it and we bring bartenders and bar tools only", sfMail.includes(sl.BARTENDER_ONLY_NOTE) && sl.BARTENDER_ONLY_NOTE.includes("alcohol, mixers, garnishes, ice, and cups") && sl.BARTENDER_ONLY_NOTE.includes("We bring your bartenders and our bar tools."));
  check("New Bartender Only list: promises nothing else (no cooler, no ice from us)", !/cooler/i.test(sfMail) && !/we bring all of it/i.test(sfMail) && !/mixing only/.test(sfMail));
  check("New Bartender Only: nothing for us to buy (no supply list, no order team email)", sl.generateNatalieSupplyList(sfEd as never) === "" && sl.generateOrderTeamEmail([], sfEd as never) === "");
  const lines = os.calculatedLines(sfEd);
  check("Shopping list: every line is marked bought by the client", lines.length > 10 && lines.every((l) => l.clientBuys) && ["liquor", "mixers", "produce", "ice"].every((sec) => lines.some((l) => l.section === sec)));
  check("Shopping list header names Bartender Only", os.sheetHeader(sfEd).line.includes("(Bartender Only)"));

  check("Legacy Bartender Only (gratuity model) is unchanged: Tailored Bar", os.sheetHeader(oldEd).line.includes("(Tailored Bar)") && os.sheetHeader(base).line.includes("(Tailored Bar)"));
  check("Legacy Bartender Only list is word for word the same as before", oldMail === noModelMail && oldMail.includes("(estimated for mixing only)") && oldMail.includes("We bring 1 cooler per bartender") && !oldMail.includes(sl.BARTENDER_ONLY_NOTE));
  check("The same lines on both: only the wording differs", JSON.stringify(sl.generateShoppingList(sfEd as never)) === JSON.stringify(sl.generateShoppingList(oldEd as never)));
  check("Other service fee packages are untouched by the marker", email({ ...base, package: "Full Bar", pricing_model: "service_fee" }) === email({ ...base, package: "Full Bar" }));

  check("withPricingModel copies the session's model onto event_data", bo.withPricingModel({ a: 1 }, { pricing_model: "service_fee" }).pricing_model === "service_fee" && !("pricing_model" in bo.withPricingModel({ a: 1 }, null)));
  check("The model reaches event_data on submission, on a model change, and on Price needs a check", src("lib/event-updates.ts").includes("withPricingModel(withHoursBooked(") && src("lib/booking-model-db.ts").includes("withPricingModel(session.event_data, { pricing_model: model })") && src("lib/price-check-db.ts").includes("event_data: withPricingModel(") && src("app/api/webhook/route.ts").includes("withPricingModel(teamEventData(body.eventData), sessionRow)"));
}

// ----- Tip jar on the staff event page -----
{
  const ev = await import("../lib/team/event-view.ts");
  const ed = { client_name: "Dana Whitfield", event_date: "January 10, 2027", package: "Full Bar", guest_count: 80 };
  const view = (extra: Record<string, unknown>) => ev.buildStaffEventView({ id: "s1", event_data: ed, ...extra } as never);
  check("Tip jar yes: the exact line", view({ pricing_model: "service_fee", tip_jar: true }).tipJar === "Tip jar allowed. Tips are optional and go entirely to the bar team.");
  check("Tip jar no: the exact line", view({ pricing_model: "service_fee", tip_jar: false }).tipJar === "No tip jar at this event. Do not set one out.");
  check("Tip jar from the booked price when the booking column is empty", view({ pricing_model: "service_fee", tip_jar: null, booked_price: { tip_jar: false, total: 1500 } }).tipJar === ev.TIP_JAR_NO);
  check("The booking's own tip_jar wins over the booked price", view({ pricing_model: "service_fee", tip_jar: true, booked_price: { tip_jar: false } }).tipJar === ev.TIP_JAR_YES);
  check("No tip jar line on gratuity events", view({ pricing_model: "gratuity", tip_jar: false }).tipJar === "" && view({ tip_jar: true }).tipJar === "");
  check("No tip jar line when the booking never said", view({ pricing_model: "service_fee" }).tipJar === "");
  const v = view({ pricing_model: "service_fee", tip_jar: true, booked_price: { total: 1500, service_fee: 250, package_price: 1250, tip_jar: true } });
  check("Staff view carries no price or fee", !/1500|1250|250|service_fee|total/i.test(JSON.stringify(v).replace(/"tipJar":"[^"]*"/, "")));
  const details = src("app/team/e/[id]/event-details.tsx");
  check("Details shows the line as one row", details.includes('<Row label="Tip jar" value={v.tipJar} />'));
}

// ----- The new Bartender Only in the concierge and on the client page -----
{
  const info = await import("../lib/packages-info.ts");
  const pp = await import("../lib/package-prompt.ts");
  const sp = await import("../lib/system-prompt.ts");
  const up = await import("../lib/update-prompt.ts");
  const bo = await import("../lib/bartender-only.ts");
  const NEW = "We bring the bartenders and bar tools only. The client buys everything on the shopping list, including alcohol, mixers, garnishes, ice, and cups.";
  const LEGACY = "Just the bartender. The client provides everything else.";
  check("New Bartender Only: the package sentence", pp.packageSentence("Bartender Only", { serviceFee: true }) === NEW);
  check("Legacy Bartender Only: the package sentence is unchanged", pp.packageSentence("Bartender Only") === LEGACY && pp.packageSentence("Bartender Only", { serviceFee: false }) === LEGACY);
  const client = info.packageShortFor("Bartender Only", { serviceFee: true }, "client")!;
  check("Client page: the new wording in the client's voice", client.line === "We bring the bartenders and bar tools only." && client.provides === "You buy everything on the shopping list, including alcohol, mixers, garnishes, ice, and cups.");
  check("Client page: legacy Bartender Only is unchanged", info.packageShortFor("Bartender Only", {}, "client")!.provides === "You provide everything else.");
  check("Other packages are untouched by the flag", ["Full Bar", "Dive Bar", "Premium Bar", "The Big Day Bar", "Tailored Bar"].every((n) => JSON.stringify(info.packageShortFor(n, { serviceFee: true })) === JSON.stringify(info.packageShortFor(n, {}))));

  const sfSession = { pricing_model: "service_fee", package_type: "Bartender Only", event_data: { package: "Bartender Only" } };
  const oldSession = { pricing_model: "gratuity", package_type: "Bartender Only", event_data: { package: "Bartender Only" } };
  check("Booking check: service fee session or booked price, Bartender Only only", bo.isServiceFeeBartenderOnlyBooking("Bartender Only", sfSession) && bo.isServiceFeeBartenderOnlyBooking("Bartender Only", { booked_price: { pricing_model: "service_fee" } }) && !bo.isServiceFeeBartenderOnlyBooking("Bartender Only", oldSession) && !bo.isServiceFeeBartenderOnlyBooking("Full Bar", sfSession) && !bo.isServiceFeeBartenderOnlyBooking("Tailored Bar", sfSession));
  for (const mode of ["intake", "update"] as const) {
    const sec = pp.bookingPackageSection(sfSession as never, "Bartender Only", [], mode);
    check(`${mode}: this booking's package uses the new wording and the rule`, sec.includes(`"${NEW}"`) && sec.includes(pp.SF_BARTENDER_ONLY_RULE));
    const legacySec = pp.bookingPackageSection(oldSession as never, "Bartender Only", [], mode);
    check(`${mode}: legacy booking's package section is unchanged`, legacySec === `THIS BOOKING'S PACKAGE (Bartender Only): when you describe it, use exactly this: "${LEGACY}"`);
  }

  const bannedNear = (p: string) => p.split("\n").filter((l) => /bartender only/i.test(l) && /cooler/i.test(l) && !/no cooler|never mention a cooler|or a cooler on this|ice, a cooler, cups/i.test(l));
  const intakeOld = sp.buildIntakePrompt(null);
  const intakeNew = sp.buildIntakePrompt(null, new Date(), { serviceFeeBartenderOnly: true });
  check("Intake prompt: no line says Bartender Only comes with a cooler", bannedNear(intakeNew).length === 0 && bannedNear(intakeOld).length > 0);
  check("Intake prompt: every legacy line about what we bring is rewritten", !intakeNew.includes("1 cooler per bartender on EVERY package, including Bartender Only") && !intakeNew.includes("we bring 1 cooler per bartender but the ice is on their side") && !/^Bartender Only \(legacy\):/m.test(intakeNew) && !intakeNew.includes("We provide the bartender, bar setup and tools, 1 cooler per bartender") && !intakeNew.includes("Neither is a current package"));
  check("Intake prompt: the new package line and the same flow steps", intakeNew.includes(`Bartender Only: ${NEW}`) && intakeNew.includes("Bartender Only Package (this booking, on our current pricing): Full conversation. Phase 1 then Phase 2 then Phase 3 (guided selection from the CLASSICS section only, see DRINK SOURCING BY PACKAGE) then Phase 3B (menu design statement, no questions) then Phase 4 then Phase 5 then the PAYMENT STEP then Phase 6."));
  check("Intake prompt: legacy drink rules are whole without the flag", [sp.DRINK_SOURCING_RULES, sp.DRINK_MENU_RULES, sp.MOCKTAIL_RULES].every((r) => intakeOld.includes(r)) && intakeNew.includes("1 to 1.5 pounds of ice per guest"));
  check("Intake prompt: only the Bartender Only lines change", intakeOld.split("\n").length === intakeNew.split("\n").length && intakeOld.split("\n").map((l, i) => [l, intakeNew.split("\n")[i]]).filter(([a, b]) => a !== b).every(([a, b]) => /Bartender Only|Tailored|cooler/i.test(a) || /this booking's Bartender Only/.test(b)));
  check("Intake prompt: unchanged without the flag", sp.buildIntakePrompt(null, new Date(), { serviceFeeBartenderOnly: false }) === intakeOld);

  const dl = { eventDay: null, withinSixDays: false, daysUntil: null, lastDrinkChangeDay: null } as never;
  const ed = { package: "Bartender Only", client_name: "Dana" };
  const updOld = up.buildUpdatePrompt(ed, 1, dl, {});
  const updNew = up.buildUpdatePrompt(ed, 1, dl, { serviceFeeBartenderOnly: true });
  check("Update prompt: no line says Bartender Only comes with a cooler", bannedNear(updNew).length === 0 && bannedNear(updOld).length > 0);
  check("Update prompt: the new package line, legacy one gone", updNew.includes(`Bartender Only: ${NEW}`) && !/^Bartender Only \(legacy\):/m.test(updNew) && !updNew.includes("We provide the bartender, bar setup and tools, 1 cooler per bartender"));
  check("Update prompt: unchanged without the flag", up.buildUpdatePrompt(ed, 1, dl, { serviceFeeBartenderOnly: false }) === updOld);

  const route = src("app/api/chat/route.ts");
  check("Chat route passes the flag to both prompts", route.includes("serviceFeeBartenderOnly: isServiceFeeBartenderOnlyBooking(eventData.package, session)") && route.includes("serviceFeeBartenderOnly: isServiceFeeBartenderOnlyBooking(session?.package_type, session)"));
  check("Client page passes the model to the package summary", src("app/s/page.tsx").includes("serviceFee={isServiceFeeEvent(data.booked_price, data)}") && src("app/s/event-summary.tsx").includes('serviceFee: serviceFee || data.pricing_model === "service_fee"'));
  console.log("\nBEFORE (legacy, unchanged):", LEGACY, "\nAFTER (service fee):", NEW, "\nCLIENT PAGE AFTER:", client.line, client.provides);
}

// ----- The new Bartender Only: classics only -----
{
  const cat = await import("../lib/menu-catalog.ts");
  const me = await import("../lib/manual-event.ts");
  const mm = await import("../lib/menu-markers.ts");
  const bod = await import("../lib/bartender-only-drinks.ts");
  const bo = await import("../lib/bartender-only.ts");
  const plan = await import("../lib/intake-plan.ts");
  const diff = await import("../lib/event-diff.ts");
  const sp = await import("../lib/system-prompt.ts");
  const up = await import("../lib/update-prompt.ts");
  const pp = await import("../lib/package-prompt.ts");
  const SF = { pricingModel: "service_fee" };

  // The catalog the Add event picker and its server check read.
  check("Catalog: new Bartender Only is the classics pool", cat.menuPool("Bartender Only", SF) === "classics");
  check("Catalog: legacy Bartender Only keeps the craft menu and classics", cat.menuPool("Bartender Only") === "craft_classics" && cat.menuPool("Bartender Only", { pricingModel: "gratuity" }) === "craft_classics");
  const picks = cat.drinksFor("Bartender Only", SF);
  check("Catalog: new Bartender Only lists every classic and no craft drink", picks.length === cat.classicDrinks().length && picks.every((d) => d.key.startsWith("classic:")) && !picks.some((d) => d.name === "French Martini"));
  check("Catalog: no mocktails or custom drinks on the new Bartender Only", !cat.allowsMocktails("Bartender Only", SF) && !cat.allowsCustom("Bartender Only", SF) && cat.allowsMocktails("Bartender Only") && cat.allowsCustom("Bartender Only"));
  check("Catalog: the drink count is unchanged (3 included, up to 6)", JSON.stringify(cat.drinkLimits("Bartender Only", SF)) === JSON.stringify({ included: 3, max: 6 }) && JSON.stringify(cat.drinkLimits("Bartender Only")) === JSON.stringify({ included: 3, max: 6 }));
  check("Catalog: other service fee packages are untouched", ["Dive Bar", "Full Bar", "Premium Bar", "The Big Day Bar"].every((p) => cat.menuPool(p, SF) === cat.menuPool(p) && cat.drinksFor(p, SF).length === cat.drinksFor(p).length));

  // Add event: the server check.
  const clean = (drinks: unknown[], model?: "gratuity" | "service_fee") => me.cleanDrinks(drinks, "Bartender Only", model);
  check("Add event: a classic saves on the new Bartender Only", clean([{ key: "classic:Margarita" }], "service_fee").ok);
  const craft = clean([{ key: "craft:French Martini" }], "service_fee");
  check("Add event: a craft drink is refused on the new Bartender Only", !craft.ok && /not on the Bartender Only menu/.test((craft as { error: string }).error));
  check("Add event: a custom drink or mocktail is refused on the new Bartender Only", !clean([{ name: "House Punch", ingredients: "2 oz rum" }], "service_fee").ok && !clean([{ name: "Virgin Mule", ingredients: "4 oz ginger beer", is_mocktail: true }], "service_fee").ok);
  check("Add event: legacy Bartender Only still takes craft and custom drinks", clean([{ key: "craft:French Martini" }, { name: "House Punch", ingredients: "2 oz rum" }], "gratuity").ok);
  check("Add event page: service fee menus are built with the model", src("app/team/admin/events/new/page.tsx").includes('menusFor(SF_MANUAL_PACKAGES, "service_fee")') && src("app/team/admin/events/new/add-event-form.tsx").includes('(model === "service_fee" ? sfMenus : menus)[v.package]'));

  // Menu pictures in the chat.
  check("Menu pictures: the new Bartender Only shows the classics only", JSON.stringify(mm.allowedMenus("Bartender Only", undefined, true)) === JSON.stringify(["classics"]) && JSON.stringify(mm.allowedMenus("Bartender Only")) === JSON.stringify(["specialty", "classics"]));
  {
    const shown: string[] = [];
    const f = mm.createMenuFilter(mm.allowedMenus("Bartender Only", undefined, true), () => {}, (m) => shown.push(m));
    f.push("Here is our actual menu so you can see what we make. Pick anything on it, or tell me a spirit and I will suggest from it.\n[MENU:specialty]\n[MENU:classics]");
    f.finish();
    check("Menu pictures: a specialty marker is dropped on the new Bartender Only", JSON.stringify(shown) === JSON.stringify(["classics"]));
  }
  check("Chat route: both menu filters and the submit check get the flag", src("app/api/chat/route.ts").includes("eventData.dive_menu_requested === true, isServiceFeeBartenderOnlyBooking(") && src("app/api/chat/route.ts").includes("packageFromContext(messages), undefined, isServiceFeeBartenderOnlyBooking(") && src("app/api/chat/route.ts").includes("classicsOnly: isServiceFeeBartenderOnlyBooking("));

  // The guard every saved drink goes through.
  const craftDrink = { name: "Berry Bliss", menu_name: "French Martini", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.5 oz raspberry liqueur", "1.5 oz pineapple juice"], is_mocktail: false, is_custom: false };
  const classic = { name: "Golden Hour", menu_name: "Margarita", base_spirit: "tequila", ingredients: ["2 oz tequila", "1 oz mango puree"], is_mocktail: false, is_custom: false };
  const mock = { name: "Sunset Fizz", ingredients: ["4 oz orange juice"], is_mocktail: true };
  const custom = { name: "Grandpa's Punch", ingredients: ["2 oz rum", "2 oz punch"], is_custom: true };
  const g = bod.guardClassicsOnly([craftDrink, classic, mock, custom, { name: "gin & tonic" }]);
  const kept = g.drinks as Record<string, unknown>[];
  check("Guard: craft, mocktail and custom drinks are left off", JSON.stringify(g.refused) === JSON.stringify(["Berry Bliss", "Sunset Fizz", "Grandpa's Punch"]));
  check("Guard: a classic keeps its approved name and gets the CLASSICS recipe", kept[0].name === "Golden Hour" && kept[0].menu_name === "Margarita" && JSON.stringify(kept[0].ingredients) === JSON.stringify(["2 oz tequila blanco", "1 oz lime juice", "0.75 oz triple sec", "0.5 oz simple syrup"]) && kept[0].is_custom === false);
  check("Guard: a classic by name alone matches (Gin & Tonic)", kept[1].menu_name === "Gin and Tonic" && (kept[1].ingredients as string[])[0] === "2 oz gin");
  check("Guard: a craft drink named like a classic is matched by its menu name, not its creative name", JSON.stringify(bod.guardClassicsOnly([{ name: "Margarita", menu_name: "French Martini" }]).refused) === JSON.stringify(["Margarita"]));

  // Intake submit.
  const payload = { package: "Bartender Only", signature_drinks: [classic, craftDrink, mock], drinks_finalized: true };
  const on = plan.checkDrinks(payload, "Bartender Only", { classicsOnly: true });
  const names = (on.data.signature_drinks as { name: string }[]).map((d) => d.name);
  check("Intake submit: only the classic is saved on the new Bartender Only", JSON.stringify(names) === JSON.stringify(["Golden Hour"]));
  check("Intake submit: a team note names what was left off, never special_requests", String(on.data.team_notes).includes(bod.boClassicsNote(["Berry Bliss", "Sunset Fizz"])) && !String(on.data.special_requests ?? "").includes("Berry Bliss"));
  const off = plan.checkDrinks(payload, "Bartender Only");
  check("Intake submit: legacy Bartender Only keeps craft drinks and mocktails as before", (off.data.signature_drinks as unknown[]).length === 3 && !String(off.data.team_notes ?? "").includes("classics only"));

  // Update mode, admin edits and accepted extras (all go through planUpdate).
  const deadlines = { withinSixDays: false } as never;
  const saved = { package: "Bartender Only", signature_drinks: [kept[0]] };
  const add = diff.planUpdate(saved, { signature_drinks: [kept[0], craftDrink] }, { deadlines, classicsOnly: true, wasClassicsOnly: true });
  check("Update: a craft drink sent on the new Bartender Only is not saved", JSON.stringify(add.classicsRefused) === JSON.stringify(["Berry Bliss"]) && (add.next.signature_drinks as unknown[]).length === 1 && !add.applied);
  const addLegacy = diff.planUpdate(saved, { signature_drinks: [kept[0], craftDrink] }, { deadlines });
  check("Update: legacy Bartender Only still saves it", (addLegacy.next.signature_drinks as unknown[]).length === 2 && addLegacy.classicsRefused.length === 0);
  const swapClassic = diff.planUpdate(saved, { signature_drinks: [kept[0], { name: "Old Fashioned", menu_name: "Old Fashioned" }] }, { deadlines, classicsOnly: true, wasClassicsOnly: true });
  check("Update: a classic added on the new Bartender Only saves", (swapClassic.next.signature_drinks as unknown[]).length === 2 && swapClassic.classicsRefused.length === 0);
  const fullEvent = { package: "Full Bar", signature_drinks: [craftDrink, kept[0]] };
  const sw = diff.planUpdate(fullEvent, { package: "Bartender Only" }, { deadlines, classicsOnly: true, wasClassicsOnly: false });
  check("Package switch to the new Bartender Only: drinks that are not classics come off, with a team note", sw.next.package === "Bartender Only" && JSON.stringify((sw.next.signature_drinks as { name: string }[]).map((d) => d.name)) === JSON.stringify(["Golden Hour"]) && String(sw.next.team_notes).includes(bod.boClassicsNote(["Berry Bliss"])));
  const within = diff.planUpdate(fullEvent, { package: "Bartender Only" }, { deadlines: { withinSixDays: true } as never, classicsOnly: true, wasClassicsOnly: false });
  check("Package switch inside six days: the craft drink still comes off with the package", (within.next.signature_drinks as unknown[]).length === 1 && within.cutoffChanges.length === 0);
  check("Updates read the flag from the session, before and after a package change", src("lib/event-updates.ts").includes("classicsOnly: isServiceFeeBartenderOnlyBooking(nextPkg, session)") && src("lib/event-updates.ts").includes("wasClassicsOnly: isServiceFeeBartenderOnlyBooking("));
  check("Update tool result tells the bot to say the line", src("app/api/chat/route.ts").includes("NOT SAVED, NOT A CLASSIC") && src("app/api/chat/route.ts").includes("lastApply.classicsRefused.length > 0"));
  check("Model change to the service fee model on a legacy Bartender Only takes off the drinks that are not classics", src("lib/booking-model-db.ts").includes("guardClassicsOnly(next.signature_drinks"));

  // The concierge prompts.
  const LEGACY_LINE = "(Legacy Bartender Only and Tailored Bar follow the Full Bar sourcing.)";
  const intakeOld = sp.buildIntakePrompt(null);
  const intakeNew = sp.buildIntakePrompt(null, new Date(), { serviceFeeBartenderOnly: true });
  check("Intake prompt: the classics only rule replaces the Full Bar sourcing line", intakeNew.includes(sp.SF_BO_SOURCING) && !intakeNew.includes(LEGACY_LINE) && intakeOld.includes(LEGACY_LINE) && !intakeOld.includes("CLASSICS ONLY"));
  check("Intake prompt: the client is told the line once and shown the classics again", sp.SF_BO_SOURCING.includes(`say once, exactly, "${bo.BO_CLASSICS_LINE}"`) && sp.SF_BO_SOURCING.includes("[MENU:classics]"));
  check("Intake prompt: no mocktails, no custom recipe, no specialty menu picture on this booking", intakeNew.includes("never this booking's Bartender Only)") && intakeNew.includes("On this booking's Bartender Only, never take a custom recipe") && intakeNew.includes("This booking's Bartender Only: [MENU:classics] only, never [MENU:specialty]."));
  check("Intake prompt: the package rule no longer says the drink rules are the legacy ones", pp.SF_BARTENDER_ONLY_RULE.includes("CLASSICS ONLY") && !pp.SF_BARTENDER_ONLY_RULE.includes("drink sourcing, signature drink count, mocktails"));
  const ued = { package: "Bartender Only", event_date: "March 20, 2027" } as never;
  const dl = diff.computeDeadlines("2027-03-20", new Date("2026-11-24T12:00:00Z"));
  const updNew = up.buildUpdatePrompt(ued, 1, dl, { serviceFeeBartenderOnly: true });
  const updOld = up.buildUpdatePrompt(ued, 1, dl, {});
  check("Update prompt: the classics only rule on this booking, legacy untouched", updNew.includes(sp.SF_BO_SOURCING) && !updNew.includes(LEGACY_LINE) && updOld.includes(LEGACY_LINE) && updNew.includes("follow its CLASSICS ONLY rule instead"));

  // Beer and wine only on the new Bartender Only.
  check("Beer and wine only: the rule follows the classics rule in both prompts, legacy untouched", intakeNew.includes(`${sp.SF_BO_SOURCING} ${sp.SF_BO_BEER_WINE_ONLY}`) && updNew.includes(sp.SF_BO_BEER_WINE_ONLY) && !intakeOld.includes("BEER AND WINE ONLY") && !updOld.includes("BEER AND WINE ONLY"));
  check("Beer and wine only: skip the menu, confirm with the exact line, classics only on request", sp.SF_BO_BEER_WINE_ONLY.includes("skip the cocktail menu entirely") && sp.SF_BO_BEER_WINE_ONLY.includes(`starts exactly: "${bo.BO_BEER_WINE_LINE}"`) && sp.SF_BO_BEER_WINE_ONLY.includes("Offer classics only if the client says they want cocktails"));
  const bw = plan.checkDrinks({ package: "Bartender Only", signature_drinks: [], beer: true, wine: true, beer_wine_only: true }, "Bartender Only", { classicsOnly: true });
  check("Beer and wine only submit: saved with no drinks, not marked unfinished", !bw.notFinalized && bw.data.beer_wine_only === true && (bw.data.signature_drinks as unknown[]).length === 0 && bw.data.drinks_not_finalized === undefined && !String(bw.data.team_notes ?? "").includes("not finalized"));
  const bwWithClassic = plan.checkDrinks({ package: "Bartender Only", signature_drinks: [classic], beer_wine_only: true, drinks_finalized: true }, "Bartender Only", { classicsOnly: true });
  check("Beer and wine only submit: a classic means cocktails after all, the flag is dropped", bwWithClassic.data.beer_wine_only === undefined && (bwWithClassic.data.signature_drinks as unknown[]).length === 1 && !bwWithClassic.notFinalized);
  const noFlagEmpty = plan.checkDrinks({ package: "Bartender Only", signature_drinks: [] }, "Bartender Only", { classicsOnly: true });
  check("No drinks without beer and wine only: still marked unfinished as before", noFlagEmpty.notFinalized);
  const legacyBw = plan.checkDrinks({ package: "Bartender Only", signature_drinks: [], beer_wine_only: true }, "Bartender Only");
  check("Legacy Bartender Only ignores the flag: unfinished as before, flag not saved", legacyBw.notFinalized && legacyBw.data.beer_wine_only === undefined);
  const ctx = (classicsOnly: boolean) => ({ packageType: "Bartender Only", booking: {} as never, classicsOnly });
  const chat = (line: string) => [{ role: "user", content: "hi" }, { role: "assistant", content: line }, { role: "user", content: "ok" }] as never;
  const steps = (c: ReturnType<typeof ctx>, m: never) => { const seen: string[] = []; let msgs = m as { role: string; content: string }[]; for (let i = 0; i < 40; i++) { const n = plan.nextPlanStep(c as never, msgs as never); if (!n) break; seen.push(n.id); msgs = [...msgs, { role: "assistant", content: n.question }, { role: "user", content: "yes" }]; } return seen; };
  const bwSteps = steps(ctx(true), chat(`${bo.BO_BEER_WINE_LINE} Would you like us to work out the quantities?`));
  const normalSteps = steps(ctx(true), chat("Great!"));
  check("Step planner: after the beer and wine only line it never asks for drinks or menu colors", !bwSteps.includes("drinks") && !bwSteps.includes("colors") && bwSteps.includes("allergies"), bwSteps.join(","));
  check("Step planner: without it the drinks are still asked, with the classics question", normalSteps.includes("drinks") && plan.nextPlanStep(ctx(true) as never, [{ role: "user", content: "hi" }] as never) !== null);
  check("Step planner: the drinks question on the new Bartender Only offers no mocktail", !plan.CLASSICS_FIRST_DRINK.includes("mocktail") && steps(ctx(false), chat(`${bo.BO_BEER_WINE_LINE}`)).includes("drinks"));
  const bwEvent = { package: "Bartender Only", signature_drinks: [], beer_wine_only: true };
  const wantsCocktails = diff.planUpdate(bwEvent, { signature_drinks: [{ name: "Old Fashioned", menu_name: "Old Fashioned" }] }, { deadlines, classicsOnly: true, wasClassicsOnly: true });
  check("Update: adding a classic to a beer and wine only event saves it and clears the flag", wantsCocktails.next.beer_wine_only === false && (wantsCocktails.next.signature_drinks as unknown[]).length === 1);
  const wantsCraft = diff.planUpdate(bwEvent, { signature_drinks: [craftDrink] }, { deadlines, classicsOnly: true, wasClassicsOnly: true });
  check("Update: a craft drink on a beer and wine only event is still refused, flag kept", wantsCraft.next.beer_wine_only === true && wantsCraft.classicsRefused.length === 1);
  const leaves = diff.planUpdate(bwEvent, { package: "Full Bar" }, { deadlines, classicsOnly: false, wasClassicsOnly: true });
  check("Update: switching off the new Bartender Only clears the flag", leaves.next.beer_wine_only === false);
  check("Chat route gives the step planner the flag, and the submit tool has the field", src("app/api/chat/route.ts").includes("classicsOnly: isServiceFeeBartenderOnlyBooking(session?.package_type, session),") && src("lib/intake-tools.ts").includes("beer_wine_only: {"));
  console.log("\nDRINK SOURCING BEFORE (this package):", LEGACY_LINE, "\nDRINK SOURCING AFTER (this package):", sp.SF_BO_SOURCING);
}

done("service fee");
