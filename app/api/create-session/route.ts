import { NextRequest, NextResponse } from "next/server";
import { missingBookingFields, parseBookingBody, priceCheckAlertText, readBooking } from "@/lib/booking-webhook";
import { insertBooking, payloadHash, recentDuplicate } from "@/lib/booking-webhook-db";
import { textAdmins } from "@/lib/intake-alerts-db";
import { siteOrigin } from "@/lib/team/clock-db";
import { managerHref } from "@/lib/team/manager-tabs";

// The GHL booking webhook. Every booking creates a new session: it is never
// matched to an earlier event by contact, email or date (a repeat client has
// one contact and many events). The only lookup is the duplicate guard, which
// returns the session an identical payload made in the last 10 minutes.
// Field rules are in lib/booking-webhook.ts. A booking whose price needs a
// check (the service fee split did not line up, or no pricing model at all) is
// still saved, flagged on the admin event page, and texted to the admins.

export async function POST(req: NextRequest) {
  let raw = "";
  try {
    raw = await req.text();
  } catch (err) {
    console.error("[create-session] could not read the body:", err);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = parseBookingBody(raw, req.headers.get("content-type"));
  if (!parsed.ok) {
    console.error("[create-session] body could not be parsed as JSON, repaired JSON, or form data. Raw body follows.");
    console.error(raw);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (parsed.how !== "json") console.log(`[create-session] body read as ${parsed.how}`);

  const booking = readBooking(parsed.body);
  if (!booking.name && !booking.email) {
    return NextResponse.json({ error: "At least name or email is required" }, { status: 400 });
  }

  const host = req.headers.get("host") ?? "plan.themixfix.com";
  const protocol = host.includes("localhost") ? "http" : "https";
  const link = (id: string) => `${protocol}://${host}/s?id=${id}`;

  const hash = payloadHash(parsed.body);
  const existing = await recentDuplicate(hash);
  if (existing) {
    console.log(`[create-session] identical payload within 10 minutes, returning session ${existing}`);
    return NextResponse.json({ id: existing, url: link(existing), duplicate: true });
  }

  const made = await insertBooking(booking, hash);
  if (!made.ok) return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  // Every expected field that arrived missing (blank, "null", or a merge tag), so a gap on the booking side shows in the logs.
  const gaps = missingBookingFields(booking);
  if (gaps.length > 0) console.warn(`[create-session] session=${made.id}: booking arrived without ${gaps.join(", ")}`);
  if (made.check) {
    console.warn(`[create-session] session=${made.id}: price needs a check (${booking.pricingModel}): ${made.check}`);
    await textAdmins(priceCheckAlertText(booking, made.id, made.check, `${siteOrigin()}${managerHref(made.id)}`), "create-session");
  }
  return NextResponse.json({ id: made.id, url: link(made.id), pricing_model: booking.pricingModel, price_check: made.check });
}
