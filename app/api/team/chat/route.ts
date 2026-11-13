import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { markThreadRead, postMessage, threadAccess, threadMessages } from "@/lib/team/chat-db";

// The event team chat. GET ?sessionId= returns the thread (and marks it read);
// POST { sessionId, body, attachmentId? } posts a message, with one picture or GIF. Admins and staff on the event only.
export async function GET(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const access = await threadAccess(sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not on this event." }, { status: access.reason === "not_found" ? 404 : 403 });
    const messages = await threadMessages(sessionId, staff);
    await markThreadRead(sessionId, staff.id);
    return NextResponse.json({ ok: true, messages });
  } catch (err) {
    console.error("[team-chat] load error:", err);
    return NextResponse.json({ error: "Could not load messages." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { sessionId, body, attachmentId } = await request.json().catch(() => ({}));
    if (typeof sessionId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = await postMessage(sessionId, staff, body, new Date(), attachmentId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, message: r.message });
  } catch (err) {
    console.error("[team-chat] post error:", err);
    return NextResponse.json({ error: "Could not send. Try again." }, { status: 500 });
  }
}
