// Price pending. When the pricing engine cannot price a client's change (a
// retired package like Essentials, Tailored Bar or Bartender Only has no
// engine row, or there is no booked total to start from), the change is still
// saved, the event is marked price pending, the admins get one text, and the
// client is told once that management will reach out with the new total.
// While pending: no new total is shown to the client, and the GHL update
// payload carries price_pending with every money field blank, so no change
// order agreement, auto charge, or balance reminder goes out with an old or
// made up total. An admin types the new total on the manager view, which
// clears it and runs the normal change order flow. Pure, no database.

import { changeBlocks, recapLines, type FieldChange } from "@/lib/event-diff";
import { money, type PriceChange } from "@/lib/price-change";

export interface PricePendingItem {
  changes: FieldChange[]; // what changed, old to new
  at: string;
}

export interface PricePendingInfo {
  items: PricePendingItem[];
  old_package: string | null;
  new_package: string | null;
  old_total: number | null;
  client_quoted: string | null; // what the client says they were quoted, "$115"
  reason: string;
}

/** The client's one message about the price. */
export const PRICE_PENDING_CLIENT_MESSAGE =
  "Your change is saved. Our management team will get the price for it and reach out to you with your new total.";

/** A priced change the engine could not put a total on. */
export function unpriced(price: PriceChange | null | undefined): boolean {
  return !!price && price.changes.length > 0 && price.new_total === null;
}

/** Why the engine could not price it, for the admins. */
export function unpricedReason(oldPackage: string | null, packageKnown: boolean, bookedTotal: number | null): string {
  if (!packageKnown) return `${oldPackage || "This package"} is a retired package with no price in the pricing engine.`;
  if (bookedTotal === null) return "There is no booked total on file to price the change from.";
  return "The pricing engine could not price this change.";
}

/** Add a newly saved unpriced change to what is already pending. */
export function addPending(
  prior: PricePendingInfo | null | undefined,
  next: { changes: FieldChange[]; oldPackage: string | null; newPackage: string | null; oldTotal: number | null; clientQuoted: string | null; reason: string; at: string }
): PricePendingInfo {
  return {
    items: [...(prior?.items ?? []), { changes: next.changes, at: next.at }],
    old_package: prior?.old_package ?? next.oldPackage,
    new_package: next.newPackage ?? prior?.new_package ?? null,
    old_total: prior ? prior.old_total : next.oldTotal,
    client_quoted: next.clientQuoted ?? prior?.client_quoted ?? null,
    reason: prior?.reason ?? next.reason,
  };
}

/** "Package: from Essentials Bar to Full Bar" lines, every pending item. */
export function pendingLines(info: PricePendingInfo | null | undefined): string[] {
  return (info?.items ?? []).flatMap((i) => recapLines(i.changes));
}

/** The summary the admins see, and GHL gets as price_pending_summary. */
export function pendingSummary(info: PricePendingInfo | null | undefined): string {
  if (!info) return "";
  const parts = [
    pendingLines(info).join("; "),
    info.old_package && info.new_package && info.old_package !== info.new_package ? `Old package ${info.old_package}, new package ${info.new_package}.` : "",
    info.old_total !== null ? `Old total ${money(info.old_total)}.` : "No total on file before the change.",
    info.client_quoted ? `Client says they were quoted ${info.client_quoted}.` : "",
    info.reason,
  ];
  return parts.filter(Boolean).join(" ");
}

/** The admin text: client, date, what changed, "price needed", and the manager view link. */
export function pendingAdminText(o: { client: string; date: string; info: PricePendingInfo; link: string }): string {
  const what = pendingLines(o.info).join("; ") || "a change";
  const quoted = o.info.client_quoted ? ` Client says they were quoted ${o.info.client_quoted}.` : "";
  return `Price needed: ${o.client || "A client"} on ${o.date || "date to be confirmed"} changed ${what}. The change is saved.${quoted} Set the new total: ${o.link}`;
}

/** The detail blocks for the manager view card. */
export function pendingBlocks(info: PricePendingInfo | null | undefined): string[] {
  return changeBlocks((info?.items ?? []).flatMap((i) => i.changes));
}

/** A dollar amount the client wrote, "$115" from "it was an extra $115". Null when there is none. */
export function quotedAmount(text: string): string | null {
  const m = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/.exec(text);
  if (!m) return null;
  return `$${m[1]}${m[2] && m[2] !== "00" ? `.${m[2]}` : ""}`;
}

/**
 * Sentences that promise a price that is not in the reply: "Let me get a price
 * on that", "Let me get that quoted", "One moment while I price it". Dropped
 * from what the client sees.
 */
const FILLER =
  /^\s*(?:(?:ok(?:ay)?|sure|great|perfect|absolutely|of course|got it)[,!.]?\s+)?(?:let me|i(?:'| wi)ll|one moment|give me a (?:moment|second)|hang on|bear with me)\b[^.!?]*\b(?:price|pric(?:e|ing)|quote|quoted|cost|total)\b[^.!?]*[.!?]?\s*$/i;

export function isPriceFiller(sentence: string): boolean {
  return FILLER.test(sentence);
}

/**
 * A text stream filter that passes text on a sentence at a time and drops
 * price filler sentences. finish() passes on whatever is left.
 */
export function createFillerFilter(push: (text: string) => void) {
  let buf = "";
  let dropped = 0;
  const emit = (sentence: string) => {
    if (isPriceFiller(sentence)) {
      dropped++;
      return;
    }
    push(sentence);
  };
  return {
    push(text: string) {
      buf += text;
      for (;;) {
        const m = /[.!?](?:["')\]]*)(\s+)/.exec(buf);
        if (!m) break;
        const end = m.index + m[0].length;
        emit(buf.slice(0, end));
        buf = buf.slice(end);
      }
    },
    finish() {
      if (buf) emit(buf);
      buf = "";
    },
    dropped: () => dropped,
  };
}
