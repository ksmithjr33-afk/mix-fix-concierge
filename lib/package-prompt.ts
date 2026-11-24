// How the concierge (the planning chat and update mode) describes packages and
// this booking's barback and cups. Pure, no database.
//
// Every package description comes from the short wording in
// lib/packages-info.ts (packageShortFor), the same wording the admin, staff,
// planner and client event pages show, so a package reads the same everywhere.
// The long PACKAGE_DESCRIPTIONS in lib/system-prompt.ts stay for detailed
// questions and the conversation rules, never for saying what is included.

import { PACKAGE_GUIDES, packageShortFor, BARBACK_AT_WEDDINGS, type BookingShort, type PackageShort } from "@/lib/packages-info";
import { barbackStatus, bookingShortOf } from "@/lib/package-extras";
import { isServiceFeeBartenderOnlyBooking } from "@/lib/bartender-only";

/** The one sentence the concierge says, once, when a client asks to remove the Full Bar wedding barback. */
export const BARBACK_KEEP_LINE = "We recommend keeping the barback so your bartenders never have to leave the bar.";

/**
 * The new Bartender Only (service fee model): the same conversation steps and
 * drink rules as the legacy Bartender Only, only what is included differs.
 * The prompt itself is rewritten too (serviceFeeBartenderOnlyPrompt in
 * lib/system-prompt.ts), so no legacy cooler or supplies line is left in it.
 */
export const SF_BARTENDER_ONLY_RULE =
  "BARTENDER ONLY ON OUR CURRENT PRICING: this booking is Bartender Only on our current pricing. Every Bartender Only rule in this prompt for the conversation steps and the drinks applies exactly as written (where a rule names the legacy Bartender Only or Tailored Bar, it applies to this booking too: the same phases, drink sourcing, signature drink count, mocktails and shopping list). Only what is included is different: the client buys everything on the shopping list, including alcohol, mixers, garnishes, ice, and cups, and we bring the bartenders and bar tools only. Never say we bring ice, a cooler, cups, mixers, or supplies on this booking, in any message, including the closing message. When ice comes up, say the ice is on their side and keep it on their shopping list. Never add an inclusion or a drink limit that is not stated here.";

/** "Line. Bullet one, bullet two, and bullet three. Client provides line." */
export function shortSentence(s: PackageShort): string {
  // Bullets written as sentences stay sentences. Short bullets become one list.
  if (s.bullets.length > 0 && s.bullets.every((b) => b.endsWith("."))) return [s.line, ...s.bullets, s.provides].filter(Boolean).join(" ");
  const lower = (b: string) => (/^[A-Z](?:[a-z]|\s)/.test(b) && !/^Moscow/.test(b) ? b[0].toLowerCase() + b.slice(1) : b);
  const items = s.bullets.map((b) => lower(b.replace(/\.$/, "")));
  const list = items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
  return [s.line, list ? `${list[0].toUpperCase()}${list.slice(1)}.` : "", s.provides].filter(Boolean).join(" ");
}

/** The package as one sentence, for a booking or in general. Empty for a package with no guide. */
export function packageSentence(name: unknown, booking?: BookingShort): string {
  const s = packageShortFor(name, booking);
  return s ? shortSentence(s) : "";
}

/** Every package's short wording, for the concierge to describe packages with. */
export function packageShortSection(): string {
  const lines = PACKAGE_GUIDES.map((g) => `${g.name}${g.legacy ? " (legacy)" : ""}: ${packageSentence(g.name)}`);
  return [
    "HOW TO DESCRIBE EACH PACKAGE: when you say what a package includes, use exactly this wording (you may shorten it, never add to it). Never add an inclusion that is not here, even if the longer PACKAGES section mentions it. For a detailed question (how service runs, what a guest can order), answer from PACKAGES.",
    ...lines,
  ].join("\n");
}

/**
 * This booking's package section: its own short wording, the barback rules
 * (on by default on a Full Bar wedding, removable through the price change
 * flow, with the recommendation said once), and cups promised on an older
 * Full Bar booking. mode picks the tool the removal is quoted with.
 */
export function bookingPackageSection(
  session: Parameters<typeof barbackStatus>[0],
  pkg: string,
  history: { role: string; content: unknown }[],
  mode: "intake" | "update" | "approval", // approval: a planner who does not hold the booking
  // Intake only: the engine's price for removing (or adding back) the barback, worked out on the server.
  intakeQuote: { amount: number; newTotal: number } | null = null
): string {
  if (!pkg) return "";
  const sfBartenderOnly = isServiceFeeBartenderOnlyBooking(pkg, session as { pricing_model?: unknown; booked_price?: unknown } | null);
  const booking = { ...bookingShortOf(session), serviceFee: sfBartenderOnly };
  const lines: string[] = [];
  const sentence = packageSentence(pkg, booking);
  if (sentence) lines.push(`THIS BOOKING'S PACKAGE (${pkg}): when you describe it, use exactly this: "${sentence}"`);
  if (sfBartenderOnly) lines.push(SF_BARTENDER_ONLY_RULE);
  const b = barbackStatus(session);
  if (b.applies && !b.removable) {
    lines.push("BARBACK: a barback is part of this package and cannot be removed. If the client asks to remove it, say it is part of the package.");
  } else if (b.removable) {
    const said = history.some((m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes(BARBACK_KEEP_LINE));
    const recommend = said
      ? "You already recommended keeping the barback in this chat. Do not say it again."
      : `First say once, in one sentence, exactly: "${BARBACK_KEEP_LINE}" Then do what they decide.`;
    const money = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
    const next = b.on ? "Removed" : "Included";
    const quote =
      mode === "approval"
        ? "say the person who holds the booking has to approve that change, and send nothing about the barback."
        : mode === "update"
        ? `call quote_price_change with barback "${next}", state the ${b.on ? "credit" : "difference"} and the new total from the result, and on a clear yes call update_event_data with barback "${next}" and quoted_new_total.`
        : intakeQuote
          ? `say in one yes or no question that it is a ${intakeQuote.amount < 0 ? "credit" : "charge"} of ${money(intakeQuote.amount)} and their new total is ${money(intakeQuote.newTotal)}. On a clear yes, send barback "${next}" in submit_event_data. On a no, send nothing about the barback. Never state any other amount for it.`
          : `say our management team will confirm the price, and send barback "${next}" in submit_event_data. Never state an amount for it.`;
    if (b.on) {
      lines.push(
        `BARBACK: this is a Full Bar wedding, so a barback is included by default and is in the booked price. Describe it as "${BARBACK_AT_WEDDINGS.replace(/\.$/, "")}". Do not bring up removing it yourself.`,
        `If the client asks to remove the barback: ${recommend} If they still want it removed, ${quote} If they keep it, send nothing about the barback.`,
        "Removing it is a credit toward the remaining balance, and adding it back later costs the same amount."
      );
    } else if (b.notBooked) {
      lines.push(
        "BARBACK: a barback is not part of this booking. Never say a barback is included, booked, or removed. Do not bring it up yourself.",
        `If the client asks to add a barback: ${quote}`
      );
    } else {
      lines.push(
        "BARBACK: the barback was removed from this booking. Never say a barback is included or booked.",
        `If the client wants the barback back, it is the same price as before: ${quote}`
      );
    }
  }
  if (booking.cups) {
    lines.push("CUSTOM CUPS: this booking was made when Full Bar included custom cups for events over 100 guests, so custom cups are included at no charge. Never quote a price for them.");
  }
  return lines.join("\n");
}
