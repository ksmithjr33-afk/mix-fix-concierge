// A service fee booking from the webhook, as the money stored on the session:
// the split (package, fee, add ons) in booked_price, and why the price needs a
// check when it does. Pure, no database. The split rules are in
// lib/service-fee.ts (splitWebhookMoney).

import { bookedGuestCount } from "@/lib/booked-facts";
import type { Booking } from "@/lib/booking-webhook";
import { DEFAULT_DEPOSIT, type BookedPrice, type PriceBasis } from "@/lib/price-change";
import { SERVICE_FEE_PACKAGES, splitWebhookMoney, type ServiceFeeQuote, type WebhookMoney } from "@/lib/service-fee";

const dollars = (cents: number | null): number | null => (cents === null ? null : cents / 100);

export const NO_GRAND_TOTAL_CHECK =
  "No grand total on the booking (build_a_bar_price, official_total_price, total_price or package_price). Set the price.";

/** The webhook money of a service fee booking, as the split reads it. */
export function webhookMoney(b: Booking): WebhookMoney {
  return {
    packageKey: b.packageKey,
    guests: bookedGuestCount(b.guestCount),
    hours: Number(b.hoursBooked) > 0 ? Number(b.hoursBooked) : null,
    isWedding: b.isWedding,
    bartenders: b.bartenderCount,
    woodenBar: b.woodenBar,
    barback: b.barback,
    grandTotalCents: b.totalCents,
    standardPriceCents: b.standardPriceCents,
    discountCents: b.discountCents,
    customPriceCents: b.customPriceCents,
    ownerOverride: b.ownerOverride,
    addonsCents: b.addonsTotalCents,
  };
}

/** What the matched engine price was figured for, for later price changes. */
function basisOf(q: ServiceFeeQuote, b: Booking, guests: number): PriceBasis {
  const wedding = b.isWedding || q.key === "wedding";
  return {
    package: q.key,
    guests,
    hours: q.serviceHours,
    isWedding: wedding,
    bartenders: q.bartenders,
    tipJar: b.tipJar ?? true,
    // Premium: on when the full event fee matched. Other packages have no wooden bar setting.
    woodenBar: q.key === "premium" ? q.eventFeeCents === SERVICE_FEE_PACKAGES.premium.eventFeeCents : true,
    ...(q.key === "full" && wedding ? { barback: q.barbackCents > 0 } : {}),
  };
}

export interface ServiceFeeBooked {
  booked: BookedPrice;
  check: string | null; // every reason the price needs a check, in one line, or null
}

/** booked_price for a service fee booking, and the check reason. Never null: a booking is always saved. */
export function serviceFeeBooked(b: Booking, nowIso: string): ServiceFeeBooked {
  const split = splitWebhookMoney(webhookMoney(b));
  const reasons = [b.totalCheck, split ? split.check : NO_GRAND_TOTAL_CHECK].filter((r): r is string => !!r);
  const check = reasons.length ? reasons.join(" ") : null;
  const guests = bookedGuestCount(b.guestCount);
  const basis = split?.standard && guests ? basisOf(split.standard, b, guests) : null;
  const booked: BookedPrice = {
    pricing_model: "service_fee",
    total: dollars(b.totalCents),
    package_price: split ? dollars(split.packageCents) : null, // the package alone, after any discount
    service_fee: split ? dollars(split.feeCents) : null,
    service_fee_rate: split ? split.feeBp / 10000 : null,
    addons_total: dollars(b.addonsTotalCents ?? (split ? split.addonsCents : null)),
    standard_price: dollars(b.standardPriceCents),
    discount_amount: dollars(b.discountCents),
    custom_price: dollars(b.customPriceCents),
    owner_override: b.ownerOverride,
    gratuity: null,
    bartenders: b.bartenderCount ?? split?.standard?.bartenders ?? null,
    promo_code: b.promoCode,
    tip_jar: b.tipJar ?? true,
    deposit_paid: dollars(b.depositPaidCents) ?? DEFAULT_DEPOSIT,
    balance_due: dollars(b.balanceDueCents),
    second_bar: b.secondBar,
    addon_lines: b.addonLines.map((l) => ({ label: l.label, amount: l.cents / 100 })),
    split_method: split?.method ?? null,
    price_check: check,
    basis,
    source: "create-session",
    updated_at: nowIso,
  };
  return { booked, check };
}
