// Client history for admins: other events matched by email (any case or
// spaces) and by phone (marked), the Repeat client tag and its count, the
// "Possibly stale booking details" alert (a repeat client's new booking that
// arrives with the earlier event's date, package or guest count), the Clients
// page and its search, a new booking always getting its own session, and
// bartenders refused everywhere (the real auth, cookies stubbed).
// Run: node --no-warnings scripts/test-client-history.mts

import { registerHooks } from "node:module";
import { addDays, check, done, src } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db } = await import("./fake-supabase.mts");
const stub = await import("./stub-next.mts");
const auth = await import("../lib/team/auth.ts");
const codes = await import("../lib/team/codes.ts");
const ch = await import("../lib/client-history.ts");
const chdb = await import("../lib/client-history-db.ts");
const alertsDb = await import("../lib/unsaved-sessions-db.ts");
const time = await import("../lib/team/time.ts");
const createSession = await import("../app/api/create-session/route.ts");

const today = time.chicagoToday();
const admin = { id: "admin-1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true };
const bartender = { id: "bart-1", name: "Sam Lee", phone: "+12145550101", role: "bartender", active: true };
const ADMIN = { role: "admin" };
const BARTENDER = { role: "bartender" };

const byIdOf = <T extends { id: string }>(rows: T[], id: string) => rows.find((r) => r.id === id)!;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
function session(id: string, created: string, top: Record<string, unknown>, ed: Record<string, unknown> | null = null) {
  return { id, created_at: created, status: ed ? "submitted" : "in_progress", version: ed ? 1 : 0, event_data: ed, ...top };
}

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [admin, bartender];
  db.staff_sessions = [];
  db.team_hidden_events = [];
  db.conversation_logs = [];
  db.sessions = [
    // Dulari: booked in March (never finished), then again this week with the same date copied over.
    session("d-old", daysAgo(230), { name: "Dulari Gandhi", email: "Dulari.G@Example.com", event_date: "April 11", guest_count: "50", package_type: null, hours_booked: "4 hours", event_name: "Social Gathering" }),
    session(
      "d-new",
      daysAgo(1),
      { name: "Dulari Gandhi", email: " dulari.g@example.com ", event_date: "April 11", guest_count: "18", package_type: "Full Bar", hours_booked: "4 hours", event_name: "Social Gathering", booked_price: { total: 1749 } },
      { client_name: "Dulari Gandhi", event_type: "Diwali", event_date: addDays(today, 150), package: "Full Bar", guest_count: 18, day_of_contact_phone: "(972) 555-0101" }
    ),
    // Same client, a past event two years running.
    session(
      "d-past",
      daysAgo(400),
      { name: "Dulari Gandhi", email: "DULARI.G@EXAMPLE.COM", event_date: "2025-12-01", guest_count: "40", package_type: "Essentials Bar" },
      { client_name: "Dulari Gandhi", event_name: "Holiday Party", event_date: addDays(today, -300), package: "Essentials Bar", guest_count: 40 }
    ),
    // A different email, same phone: matched by phone.
    session(
      "d-phone",
      daysAgo(100),
      { name: "Raj Gandhi", email: "raj@example.com", event_date: "June 1", guest_count: "30", package_type: "Beer and Wine" },
      { client_name: "Raj Gandhi", event_type: "Birthday", event_date: addDays(today, -100), package: "Beer and Wine", guest_count: 30, day_of_contact_phone: "+1 972 555 0101" }
    ),
    // Someone who gave our own line as the day of contact: never a phone match.
    session(
      "biz",
      daysAgo(50),
      { name: "Other Person", email: "other@example.com", event_date: "May 5", guest_count: "60", package_type: "Full Bar" },
      { client_name: "Other Person", event_type: "Wedding", event_date: addDays(today, 60), package: "Full Bar", guest_count: 60, day_of_contact_phone: "469 754 8512" }
    ),
    session(
      "biz2",
      daysAgo(40),
      { name: "Third Person", email: "third_p@example.com", event_date: "May 6", guest_count: "70", package_type: "Premium Bar" },
      { client_name: "Third Person", event_type: "Wedding", event_date: addDays(today, 70), package: "Premium Bar", guest_count: 70, day_of_contact_phone: "(469) 754-8512", client_phone: "214 555 0199" }
    ),
    // An email with an underscore: "_" must not match any character.
    session("lookalike", daysAgo(30), { name: "Look Alike", email: "thirdxp@example.com", event_date: "May 7", guest_count: "10", package_type: "Dive Bar" }),
  ];
}

const signIn = (staffId: string, token: string) => {
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
};
const redirectOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof stub.RedirectError ? e.to : String(e);
  }
};

// ---- Keys ----
check("Emails match ignoring capital letters and spaces", ch.emailKey("  Dulari.G@Example.com ") === "dulari.g@example.com" && ch.emailKey("DULARI.G @EXAMPLE.COM") === "dulari.g@example.com");
check("Phones match on the last 10 digits, any formatting", ch.phoneKey("+1 (972) 555-0101") === "9725550101" && ch.phoneKey("972.555.0101") === "9725550101" && ch.phoneKey("555-0101") === null);

// ---- History by email and by phone ----
reset();
const history = await chdb.historyFor({ id: "d-new" }, ADMIN, today);
const ids = history!.rows.map((r) => r.id);
check("History lists the client's other events matched by email, any case or spaces", ids.includes("d-old") && ids.includes("d-past") && history!.rows.find((r) => r.id === "d-past")!.matchedBy === "email");
check("History never lists the event itself", !ids.includes("d-new"));
check("A different email with the same phone is listed and marked matched by phone", history!.rows.find((r) => r.id === "d-phone")?.matchedBy === "phone");
check("Our own phone number never matches two clients", !(await chdb.historyFor({ id: "biz" }, ADMIN, today))!.rows.some((r) => r.id === "biz2"));
const days = history!.rows.map((r) => r.day ?? "");
check("Newest first", days.every((d, i) => i === 0 || days[i - 1] >= d) && ids.indexOf("d-past") === ids.length - 1, ids.join(","));
check("A date with no year reads as this year, not 2001", byIdOf(history!.rows, "d-old").day?.slice(0, 4) === today.slice(0, 4));
const byId = (id: string) => history!.rows.find((r) => r.id === id)!;
check("Statuses: past, details pending", byId("d-past").status === "past" && byId("d-old").status === "details pending");
db.team_hidden_events.push({ session_id: "d-past" });
db.sessions.push(
  session("d-up", daysAgo(5), { name: "Dulari Gandhi", email: "dulari.g@example.com", event_date: "Jan 2", guest_count: "25", package_type: "Full Bar", booked_price: { total: 2100 } }, { client_name: "Dulari Gandhi", event_name: "New Year", event_date: addDays(today, 50), package: "Full Bar", guest_count: 25 })
);
const h2 = await chdb.historyFor({ id: "d-new" }, ADMIN, today);
check("Statuses: hidden and upcoming", h2!.rows.find((r) => r.id === "d-past")!.status === "hidden" && h2!.rows.find((r) => r.id === "d-up")!.status === "upcoming");
const up = h2!.rows.find((r) => r.id === "d-up")!;
check("Each row has the event name, date, package, guests and booked total", up.title === "New Year" && up.day === addDays(today, 50) && up.pkg === "Full Bar" && up.guests === "25" && up.total === 2100);
check("Each row opens the manager view and has both client links", up.managerHref === "/team/admin/e/d-up" && up.conciergeUrl.endsWith("/s?id=d-up") && up.eventUrl.endsWith("/s?id=d-up#event-details"));
check("An event with details pending has no manager view to open, but still has its links", byId("d-old").managerHref === null && byId("d-old").conciergeUrl.endsWith("/s?id=d-old"));
check("A booking with no details yet shows the event name it was booked with", byId("d-old").title === "Social Gathering");

// ---- Repeat tag and count ----
reset();
check("The first event is not a repeat", ch.repeatLabel(await chdb.eventNumberFor({ id: "d-past", email: "DULARI.G@EXAMPLE.COM" }, ADMIN)) === null);
check("The third booking reads Repeat client, 3rd event", ch.repeatLabel(await chdb.eventNumberFor({ id: "d-new", email: " dulari.g@example.com " }, ADMIN)) === "Repeat client, 3rd event");
check("Ordinals", ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "103rd"].join() === [1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ch.ordinal).join());
check("An underscore in an email only matches an underscore", (await chdb.eventNumberFor({ id: "lookalike", email: "thirdxp@example.com" }, ADMIN)) === 1 && (await chdb.eventNumberFor({ id: "biz2", email: "third_p@example.com" }, ADMIN)) === 1);
check("A phone match alone never makes a repeat client", (await chdb.eventNumberFor({ id: "d-phone", email: "raj@example.com" }, ADMIN)) === 1);
const numbers = await chdb.eventNumbersFor(ADMIN);
check("The events list and calendar get the same counts", numbers!.get("d-new") === 3 && numbers!.get("d-old") === 2 && numbers!.get("d-past") === 1);
const listSrc = src("app/team/admin/events/page.tsx");
check("The admin events list and calendar show the tag", listSrc.includes("repeat: repeatLabel(") && src("app/team/events/event-list.tsx").includes("{e.repeat}") && src("app/team/calendar-view.tsx").includes("{e.repeat}"));
check("The manager view header shows the tag", src("app/team/admin/e/[id]/page.tsx").includes("{repeat && <p"));

// ---- Stale booking details ----
reset();
let alerts = await alertsDb.saveAlerts();
const dulari = alerts.stale.find((s) => s.sessionId === "d-new");
check("A repeat client's new booking with the earlier event's date is flagged", !!dulari && dulari.fields.includes("date") && dulari.earlierId === "d-old", JSON.stringify(alerts.stale));
check("The flag names the fields that match, and only those", dulari?.fields.join() === "date");
check("A first booking is never flagged", !alerts.stale.some((s) => ["d-past", "biz", "biz2", "lookalike"].includes(s.sessionId)));
check("A different client with the same phone is not flagged", !alerts.stale.some((s) => s.sessionId === "d-phone"));
db.sessions.find((s) => s.id === "d-new")!.event_date = "May 30";
db.sessions.find((s) => s.id === "d-new")!.guest_count = "40";
alerts = await alertsDb.saveAlerts();
check("Same guest count as an older event is flagged too", alerts.stale.find((s) => s.sessionId === "d-new")?.fields.join() === "guest count");
db.sessions.find((s) => s.id === "d-new")!.guest_count = "19";
alerts = await alertsDb.saveAlerts();
check("A new booking with all new details is not flagged", !alerts.stale.some((s) => s.sessionId === "d-new"));
db.sessions.find((s) => s.id === "d-new")!.created_at = daysAgo(45);
db.sessions.find((s) => s.id === "d-new")!.event_date = "April 11";
alerts = await alertsDb.saveAlerts();
check("Only bookings from the last 30 days are checked", !alerts.stale.some((s) => s.sessionId === "d-new"));
check("The Staffing page shows the stale booking alert", src("app/team/admin/events/save-alerts.tsx").includes("Possibly stale booking details, check with the client"));

// ---- Clients page ----
reset();
const clients = (await chdb.clientsList(ADMIN, today))!;
const d = clients.find((c) => c.key === "dulari.g@example.com")!;
check("One row per client email", clients.filter((c) => c.key === "dulari.g@example.com").length === 1 && clients.length === 5, String(clients.length));
check("The row has name, email, phone, count, last and next event", d.name === "Dulari Gandhi" && d.email.trim() === "dulari.g@example.com" && d.phone === "(972) 555-0101" && d.events === 3 && d.lastEvent === [addDays(today, -300), time.eventDay("April 11")!].filter((x) => x < today).sort().at(-1) && d.nextEvent === addDays(today, 150), JSON.stringify(d));
check("Our own number is never shown as a client's phone", clients.find((c) => c.key === "other@example.com")!.phone === "" && clients.find((c) => c.key === "third_p@example.com")!.phone === "214 555 0199");
check("Search by name", ch.searchClients(clients, "dulari").map((c) => c.key).join() === "dulari.g@example.com");
check("Search by email, any case", ch.searchClients(clients, "RAJ@EXAMPLE").map((c) => c.key).join() === "raj@example.com");
check("Search by phone, any formatting", ch.searchClients(clients, "972-555-0101").map((c) => c.key).sort().join() === "dulari.g@example.com,raj@example.com" && ch.searchClients(clients, "(214) 555 0199").map((c) => c.key).join() === "third_p@example.com");
check("Empty search lists everyone; no match lists no one", ch.searchClients(clients, "  ").length === clients.length && ch.searchClients(clients, "zzz").length === 0);
const page = await chdb.clientPage("dulari.g@example.com", ADMIN, today);
const pageRows = page !== null && page !== "none" ? page.rows : [];
const pageDays = pageRows.map((r) => r.day ?? "");
check("Opening a client lists all their events, newest first", pageRows.map((r) => r.id).sort().join() === "d-new,d-old,d-past" && pageRows[0]?.id === "d-new" && pageDays.every((x, i) => i === 0 || pageDays[i - 1] >= x));
check("An unknown client is not found", (await chdb.clientPage("nobody@example.com", ADMIN, today)) === "none");

// ---- A new booking always gets its own session ----
reset();
const before = db.sessions.length;
const res = await createSession.POST(
  new Request("http://plan.test/api/create-session", { method: "POST", headers: { host: "plan.test" }, body: JSON.stringify({ name: "Dulari Gandhi", email: "dulari.g@example.com", event_date: "April 11", package_type: "Full Bar", guest_count: "18" }) }) as never
);
const made = (await res.json()) as { id: string };
check("Same email and same date as an earlier booking still creates a new session", res.status === 200 && db.sessions.length === before + 1 && !["d-old", "d-new", "d-past"].includes(made.id));
check("The earlier sessions are untouched", db.sessions.find((s) => s.id === "d-old")!.status === "in_progress" && db.sessions.find((s) => s.id === "d-new")!.status === "submitted");
const createSrc = src("app/api/create-session/route.ts");
check("Session create never looks a session up", !/\.eq\(|\.ilike\(|\.match\(|upsert|\.update\(/.test(createSrc) && createSrc.includes('.from("sessions").insert('));

// ---- Bartenders refused everywhere ----
reset();
check("History is refused to a bartender", (await chdb.historyFor({ id: "d-new" }, BARTENDER, today)) === null);
check("The repeat count is refused to a bartender", (await chdb.eventNumberFor({ id: "d-new", email: "dulari.g@example.com" }, BARTENDER)) === null && (await chdb.eventNumbersFor(BARTENDER)) === null);
check("The Clients list and a client page are refused to a bartender", (await chdb.clientsList(BARTENDER)) === null && (await chdb.clientPage("dulari.g@example.com", BARTENDER)) === null);
signIn("bart-1", "bart-token");
check("A bartender opening the Clients page is sent to their events", (await redirectOf(() => auth.requireAdmin("/team/admin/clients"))) === "/team/events");
signIn("admin-1", "admin-token");
stub.stubCookies.set("mf_team_view", "bartender");
const inBartenderView = await auth.getCurrentStaff();
check("An admin in Bartender view is refused too", inBartenderView!.role === "bartender" && (await chdb.historyFor({ id: "d-new" }, inBartenderView!, today)) === null && (await redirectOf(() => auth.requireAdmin("/team/admin/clients"))) === "/team/events");
for (const p of ["app/team/admin/clients/page.tsx", "app/team/admin/clients/[key]/page.tsx"]) {
  const s = src(p);
  check(`${p} checks admin on the server before reading anything`, s.indexOf("await requireAdmin(") > 0 && s.indexOf("await requireAdmin(") < Math.min(...["clientsList(", "clientPage("].map((f) => s.indexOf(f)).filter((i) => i > 0)));
}
const manager = src("app/team/admin/e/[id]/page.tsx");
check("The manager view loads history only with Details open, after the admin check", manager.includes('on("details")\n      ? historyFor(session, me)') && manager.indexOf("await requireAdmin(") < manager.indexOf("historyFor(session, me)"));
const bartenderFiles = ["app/team/e/[id]/page.tsx", "app/team/e/[id]/event-tabs.tsx", "app/team/e/[id]/event-details.tsx", "app/team/events/page.tsx", "lib/team/my-events.ts", "lib/team/events.ts"];
check("No bartender page or loader reads client history", bartenderFiles.every((f) => !/client-history/.test(src(f))));
check("The Clients link is in the admin menu only", src("app/team/team-header.tsx").indexOf('href="/team/admin/clients"') > src("app/team/team-header.tsx").indexOf("{showAdmin && ("));

done("client history");
