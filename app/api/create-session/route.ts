import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";

function generateId(): string {
  return crypto.randomBytes(4).toString("hex"); // 8 hex chars
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { name, email, event_date, package_type, guest_count, event_name, hours_booked } = body;

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
