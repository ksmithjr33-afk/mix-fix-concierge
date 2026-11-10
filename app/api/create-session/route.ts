import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";
import { DEFAULT_DEPOSIT, toBool, toMoney, type BookedPrice } from "@/lib/price-change";

function generateId(): string {
  return crypto.randomBytes(4).toString("hex"); // 8 hex chars
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { name, email, event_date, package_type, guest_count, event_name, hours_booked } = body;

    // What the client booked, from the quote tool through GHL. Price changes in
    // update mode are priced against this. Values may arrive as "$1,749" or "Yes", so parse loosely.
    const total = toMoney(body.total);
    const promo = typeof body.promo_code === "string" && body.promo_code.trim() ? body.promo_code.trim().toUpperCase() : null;
    const priceKeys = ["package_price", "gratuity", "total", "bartenders", "promo_code", "custom_price", "discount_amount", "tip_jar", "deposit_paid"];
    const hasPrice = priceKeys.some((k) => body[k] !== undefined && body[k] !== null && body[k] !== "");
    const bookedPrice: BookedPrice | null = hasPrice
      ? {
          package_price: toMoney(body.package_price),
          gratuity: toMoney(body.gratuity),
          total,
          bartenders: toMoney(body.bartenders),
          promo_code: promo,
          custom_price: toMoney(body.custom_price),
          discount_amount: toMoney(body.discount_amount),
          tip_jar: toBool(body.tip_jar, true),
          deposit_paid: toMoney(body.deposit_paid) ?? DEFAULT_DEPOSIT,
          source: "create-session",
          updated_at: new Date().toISOString(),
        }
      : null;

    if (!name && !email) {
      return NextResponse.json({ error: "At least name or email is required" }, { status: 400 });
    }

    const id = generateId();

    const { error } = await supabase.from("sessions").insert({
      id,
      name: name ?? null,
      email: email ?? null,
      event_date: event_date ?? null,
      package_type: package_type ?? null,
      guest_count: guest_count ?? null,
      event_name: event_name ?? null,
      hours_booked: hours_booked ?? null,
      ...(bookedPrice ? { booked_price: bookedPrice } : {}),
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }

    const host = req.headers.get("host") ?? "plan.themixfix.com";
    const protocol = host.includes("localhost") ? "http" : "https";
    const shortUrl = `${protocol}://${host}/s?id=${id}`;

    return NextResponse.json({ id, url: shortUrl });
  } catch (err) {
    console.error("Create session error:", err);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
