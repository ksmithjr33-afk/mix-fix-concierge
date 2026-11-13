import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { importGiphy, removeAttachment, startMediaUpload } from "@/lib/team/media-db";

// Pictures and GIFs for event chat and announcements. POST { action }:
//   "start"  { scope: "chat" | "announcement", sessionId?, type, size }: a one time upload link
//   "giphy"  { scope, sessionId?, giphyId }: copies a rated G GIPHY GIF into our storage
//   "remove" { id }: admins remove any attachment
// The attachment is sent with the message (chat) or announcement after this.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (b.action === "start") {
      const r = await startMediaUpload(staff, { scope: b.scope, sessionId: b.sessionId, type: b.type, size: b.size });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, id: r.id, uploadUrl: r.uploadUrl, kind: r.kind });
    }
    if (b.action === "giphy") {
      const r = await importGiphy(staff, { scope: b.scope, sessionId: b.sessionId, giphyId: b.giphyId });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, id: r.id, kind: r.kind });
    }
    if (b.action === "remove" && typeof b.id === "string") {
      const r = await removeAttachment(staff, b.id);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err) {
    console.error("[media] error:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
