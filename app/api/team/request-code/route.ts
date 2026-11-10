import { NextResponse } from "next/server";
import { requestLoginCode } from "@/lib/team/auth";
import { CODE_SENT_MESSAGE } from "@/lib/team/codes";

// Always the same answer, so the form never reveals who is on the team.
export async function POST(request: Request) {
  try {
    const { phone } = await request.json().catch(() => ({}));
    await requestLoginCode(phone);
  } catch (err) {
    console.error("[team-auth] request-code error:", err);
  }
  return NextResponse.json({ message: CODE_SENT_MESSAGE });
}
