import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const webhookUrl = process.env.GHL_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "GHL_WEBHOOK_URL is not configured" },
        { status: 500 }
      );
    }

    const payload = await request.json();

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("GHL refire error:", res.status, text);
      return NextResponse.json(
        { error: "Webhook request failed", status: res.status, details: text },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Refire error:", err);
    return NextResponse.json(
      { error: "Failed to send webhook" },
      { status: 500 }
    );
  }
}
