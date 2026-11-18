import { NextResponse } from "next/server";
import { PARTNER_CODE_SENT_MESSAGE, requestPartnerCode } from "@/lib/partners/auth";

// Always the same answer, so the form never reveals who has an account.
export async function POST(request: Request) {
  try {
    const { phone } = await request.json().catch(() => ({}));
    await requestPartnerCode(phone);
  } catch (err) {
    console.error("[partner-auth] request-code error:", err);
  }
  return NextResponse.json({ message: PARTNER_CODE_SENT_MESSAGE });
}
