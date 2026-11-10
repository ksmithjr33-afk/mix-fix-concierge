import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/team/auth";
import { activeAdmins, openEvent, recordMissing } from "@/lib/team/events";
import { allShopItems, buildStaffShopping } from "@/lib/team/shopping";
import { firstName, scrub } from "@/lib/team/event-view";
import { eventDay, shortDate } from "@/lib/team/time";
import { sendStaffText } from "@/lib/team/sms";

// "Something is missing": texts every admin the event date and the items.
export async function POST(request: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  try {
    const { sessionId, keys, note } = await request.json();
    if (typeof sessionId !== "string" || !Array.isArray(keys)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const noteText = typeof note === "string" ? note.trim().slice(0, 500) : "";
    if (keys.length === 0 && !noteText) return NextResponse.json({ error: "Pick an item or add a note." }, { status: 400 });

    const access = await openEvent(sessionId, staff);
    if (!access.ok) return NextResponse.json({ error: "You are not assigned to this event." }, { status: 403 });

    const ed = access.session.event_data ?? {};
    const items = allShopItems(buildStaffShopping(ed)).filter((i) => keys.includes(i.key));
    const date = shortDate(eventDay(ed.event_date ?? access.session.event_date));
    const name = scrub(ed.event_name) || scrub(ed.event_type) || "event";
    const lines = [
      `Missing items for the ${date} ${name}, reported by ${firstName(staff.name) || "a bartender"}:`,
      ...items.map((i) => `${i.item} (${i.quantity})`),
      noteText ? `Note: ${noteText}` : "",
      `${new URL(`/team/e/${sessionId}`, request.url).toString()}`,
    ].filter(Boolean);

    await recordMissing(sessionId, staff.id, items.map((i) => i.item), noteText);
    const admins = await activeAdmins();
    const sent = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, lines.join("\n"))));
    console.log(`[team] missing items for ${sessionId} from ${staff.id}: ${items.length} items, ${sent.filter(Boolean).length}/${admins.length} texts sent`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[team] missing error:", err);
    return NextResponse.json({ error: "Could not send. Text us at 469 754 8512." }, { status: 500 });
  }
}
