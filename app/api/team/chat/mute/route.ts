import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { setChatMuted } from "@/lib/team/chat-db";

// "Mute this chat" for admins: POST { sessionId, muted }. Muted chats leave
// the admin's chat icon, pop ups and texts. Admins only, checked on the server.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "Only admins can mute a chat." }, { status: 403 });
  try {
    const { sessionId, muted } = await request.json().catch(() => ({}));
    if (typeof sessionId !== "string" || typeof muted !== "boolean") return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = await setChatMuted(sessionId, staff, muted);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, muted: r.muted });
  } catch (err) {
    console.error("[team-chat] mute error:", err);
    return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
  }
}
