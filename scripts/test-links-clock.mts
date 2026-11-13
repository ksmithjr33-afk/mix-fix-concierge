// The manager view's Details tab: the Client links card (admins only) with the
// client's concierge link and event page link, whether they finished the
// concierge and when they last opened or updated it; and who is clocked in,
// at the top of the tab, in the event's time zone.
// Run: node --no-warnings scripts/test-links-clock.mts

import { check, done, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const links = await import("../lib/client-links.ts");
const label = await import("../lib/team/clock-label.ts");

const admin = { id: "admin-1", role: "admin" };
const bartender = { id: "bart-1", role: "bartender" };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    { id: "s1", status: "submitted", version: 3, submitted_at: "2026-11-03T22:12:00Z", event_data: { event_date: "November 20, 2026" }, client_opened_at: "2026-11-10T15:00:00Z" },
    { id: "s2", status: "submitted", version: 1, submitted_at: "2026-11-11T16:00:00Z", event_data: { event_date: "November 21, 2026" }, created_by: "admin", created_by_name: "Kenneth" },
  ];
  db.event_updates = [
    { id: "u1", session_id: "s1", version: 1, source: "concierge", created_at: "2026-11-03T22:12:00Z" },
    { id: "u2", session_id: "s1", version: 2, source: "concierge", created_at: "2026-11-09T20:00:00Z" },
    { id: "u3", session_id: "s1", version: 3, source: "manager", created_at: "2026-11-11T20:00:00Z" },
  ];
}
const s1 = () => db.sessions[0] as never;
const s2 = () => db.sessions[1] as never;

// ----- Client links: admins only -----
reset();
check("A bartender gets no client links", (await links.clientLinks(s1(), bartender)) === null);
const l = (await links.clientLinks(s1(), admin))!;
check("The concierge link is the client's /s link", l.conciergeUrl === "https://plan.test/s?id=s1");
check("The event page link opens their event details", l.eventUrl === "https://plan.test/s?id=s1#event-details");
check("The Open buttons never count as the client opening it", l.openConcierge === "https://plan.test/s?id=s1&admin=1" && l.openEvent === "https://plan.test/s?id=s1&admin=1#event-details");
check("It says they finished the concierge", l.finished && l.finishedAt === "2026-11-03T22:12:00Z");
check("Last updated is the client's own last update, not an admin edit", l.lastUpdatedAt === "2026-11-09T20:00:00Z");
check("Last opened is when they last opened their link", l.lastOpenedAt === "2026-11-10T15:00:00Z");
const line = links.clientStatusLine(l, "America/Chicago");
check("The status line in plain words", line === "Finished the concierge Nov 3, 2026, 4:12 PM. Last opened Nov 10, 2026, 9:00 AM. Last updated Nov 9, 2026, 2:00 PM.", line);
const hand = (await links.clientLinks(s2(), admin))!;
check("A hand added event says the client has not done the concierge", !hand.finished && links.clientStatusLine(hand).startsWith("Added by hand, the client has not done the concierge.") && links.clientStatusLine(hand).includes("Has not opened their link yet.") && links.clientStatusLine(hand).includes("No updates from the client."));
db.conversation_logs = [{ session_id: "s2", status: "completed" }];
const linked = (await links.clientLinks(s2(), admin))!;
check("Added by hand with the concierge link: once the client completes the chat it says finished", linked.finished && links.clientStatusLine(linked).startsWith("Finished the concierge"));
await links.recordClientOpen("s2", new Date("2026-11-12T18:30:00Z"));
check("Opening the link records the time", (db.sessions[1] as Record<string, unknown>).client_opened_at === "2026-11-12T18:30:00.000Z");
const sPage = src("app/s/page.tsx");
check("The client page records an open unless an admin opened it from the manager view", sPage.includes('if (params.admin !== "1") await recordClientOpen(sessionId)'));
check("The event page has the event details anchor", src("app/s/update-mode.tsx").includes('id="event-details"'));

const page = src("app/team/admin/e/[id]/page.tsx");
const card = src("app/team/admin/e/[id]/client-links-card.tsx");
check("The Details tab shows the Client links card with Copy and Open", page.includes("<ClientLinksCard") && card.includes("Client links") && card.includes("<CopyButton") && card.includes(">\n          Open\n"));
check("The card is fed only by clientLinks with the signed in admin", page.includes("clientLinks(session, me)") && page.includes("{links && ("));
check("The manager view checks admin before anything", page.indexOf("await requireAdmin(") > 0 && page.indexOf("await requireAdmin(") < page.indexOf("clientLinks(session, me)"));
const importsOf = (p: string) => [...src(p).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
const bartenderFiles = ["app/team/e/[id]/page.tsx", "app/team/e/[id]/event-tabs.tsx", "lib/team/event-view.ts", "lib/team/events.ts"];
check("Bartenders never see these links: the bartender view never imports them", bartenderFiles.every((p) => !importsOf(p).some((i) => i.includes("client-links") || i.includes("/admin/"))));
check("Bartender view text has no concierge or event page link", bartenderFiles.every((p) => !/Client links|Concierge link|\/s\?id=/.test(src(p))));

// ----- Who is clocked in, at the top -----
const now = new Date("2026-11-14T23:00:00Z");
check("Clocked in shows since when, Central", label.clockStatus({ clockIn: "2026-11-14T22:32:00Z", clockOut: null }, "America/Chicago", now) === "Clocked in since 4:32 PM");
check("Clocked out shows when", label.clockStatus({ clockIn: "2026-11-14T22:32:00Z", clockOut: "2026-11-15T04:05:00Z" }, "America/Chicago", new Date("2026-11-15T05:00:00Z")) === "Clocked out 10:05 PM");
check("Nobody punched: Not clocked in", label.clockStatus({ clockIn: null, clockOut: null }, "America/Chicago", now) === "Not clocked in");
check("Los Angeles events use Pacific time", label.clockStatus({ clockIn: "2026-11-14T22:32:00Z", clockOut: null }, "America/Los_Angeles", now) === "Clocked in since 2:32 PM");
const details = page.slice(page.indexOf("    details: "), page.indexOf("    team: "));
check("The clock status is the first thing on the Details tab", details.indexOf("<ClockStatus people={people} timeZone={v.timeZone} />") > 0 && details.indexOf("<ClockStatus") < details.indexOf("<MenuPickupPanel") && details.indexOf("<ClockStatus") < details.indexOf("<Details v={v} />") && details.indexOf("<ClockStatus") < details.indexOf("<ClientLinksCard"));
const dayof = page.slice(page.indexOf("    dayof: "), page.indexOf("    chat: "));
check("The full punch list stays on Day of", dayof.includes("<TimePunches people={people} timeZone={v.timeZone} />") && !details.includes("<TimePunches"));
const dayOfSrc = src("app/team/admin/e/[id]/day-of.tsx");
check("Each person on the event gets a line, declined people left off", dayOfSrc.includes("export function ClockStatus") && dayOfSrc.includes('people.filter((p) => p.status !== "declined")') && dayOfSrc.includes("clockStatus(p, timeZone)"));

done("client links and clock status");
