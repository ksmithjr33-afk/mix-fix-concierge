// The Past events tab on /team/events: newest first, grouped by month, 30 at a
// time with Show more, server side search, and who sees what (admins and
// managers every past event with the admin title; everyone else only their own,
// not declined, with the staff title and their own paid status). Hidden events
// never show. Real code against the in-memory database.
// Run: node --no-warnings scripts/test-past-events.mts

import { addDays, check, done, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const past = await import("../lib/team/past-events-db.ts");
const months = await import("../lib/team/past-months.ts");

const today = time.chicagoToday();
const ev = (id: string, day: string, client: string, extra: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
  id,
  status: "submitted",
  version: 1,
  event_date: day,
  team_market: "dallas",
  team_market_source: "admin",
  event_data: { client_name: client, event_type: "Wedding", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", arrival_time: "4:30pm", event_address: "1 Main St, Austin, TX", guest_count: 120, package: "Full Bar", ...extra },
  ...top,
});
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true };
const manager = { id: "m1", name: "Alex Rivera", phone: "+12145550102", role: "manager" as const, active: true, alerts: true };
const sam = { id: "b1", name: "Sam Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const jo = { id: "b2", name: "Jo Park", phone: "+12145550112", role: "server" as const, active: true };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    ev("p1", addDays(today, -1), "Justin Reyes"),
    ev("p2", addDays(today, -40), "Maria Gomez"),
    ev("p3", addDays(today, -10), "Dana Whitfield"),
    ev("p4", addDays(today, -5), "Chris Long"), // Sam declined
    ev("p5", addDays(today, -3), "Hidden Person"), // hidden
    ev("p6", addDays(today, -2), "Draft Person", {}, { status: "draft" }),
    ev("p7", addDays(today, -7), "Cal Only", {}, { calendar_only: true }),
    ev("u1", addDays(today, 3), "Future Person"),
    ev("t0", today, "Today Person"),
  ];
  db.staff = [admin, manager, sam, jo].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "x1", session_id: "p1", staff_id: "b1", status: "accepted" },
    { id: "x2", session_id: "p2", staff_id: "b1", status: "accepted" },
    { id: "x3", session_id: "p3", staff_id: "b2", status: "accepted" },
    { id: "x4", session_id: "p4", staff_id: "b1", status: "declined" },
    { id: "x5", session_id: "p5", staff_id: "b1", status: "accepted" },
    { id: "x6", session_id: "p6", staff_id: "b1", status: "accepted" },
    { id: "x7", session_id: "p7", staff_id: "b1", status: "offered" },
    { id: "x8", session_id: "u1", staff_id: "b1", status: "accepted" },
  ];
  db.team_hidden_events = [{ session_id: "p5" }];
  db.payroll_paid = [
    { id: "pp1", assignment_id: "x1", session_id: "p1", staff_id: "b1", paid_on: addDays(today, 2), undone_at: null },
    { id: "pp2", assignment_id: "x3", session_id: "p3", staff_id: "b2", paid_on: addDays(today, -3), undone_at: null },
  ];
  for (const t of ["event_messages", "event_message_reads"]) db[t] = [];
}

// ----- 1. Newest first, past only -----
reset();
const adm = await past.pastEventsFor({ ...admin }, { today });
const ids = adm.items.map((e) => e.id).join();
check("Admins see every past submitted event, newest first", ids === "p1,p4,p7,p3,p2", ids);
check("Today and upcoming events are not on the Past events tab", !/u1|t0/.test(ids));
check("Hidden events and drafts never show", !/p5|p6/.test(ids));
check("Admins get the admin title (client full name)", adm.items[0].title === "Justin Reyes · Wedding");
check("Admin rows open the manager view and the admin chat", adm.items.every((e) => e.href === `/team/admin/e/${e.id}` && e.chat?.href === `/team/admin/e/${e.id}?tab=chat`));
check("Calendar only events carry the badge for admins, as on the upcoming list", adm.items.find((e) => e.id === "p7")!.calendarOnly === true);
check("Admins get no paid status here (Payroll covers it)", adm.items.every((e) => e.paid === undefined));
check("Rows keep the upcoming layout: times, guests, package, city", adm.items[0].detail === "6:00 PM to 10:00 PM · 120 guests · Full Bar · Austin" && adm.items[0].arrival === "4:30 PM", adm.items[0].detail);
const mgr = await past.pastEventsFor({ ...manager }, { today });
check("Managers see the same as admins", mgr.items.map((e) => e.id).join() === ids && mgr.items[0].title === "Justin Reyes · Wedding");

// ----- 2. Staff see only their own, never a declined one -----
const mine = await past.pastEventsFor({ ...sam }, { today });
const mineIds = mine.items.map((e) => e.id).join();
check("A bartender sees only past events they were on, newest first", mineIds === "p1,p7,p2", mineIds);
check("A declined event does not show", !mineIds.includes("p4"));
check("Someone else's event does not show", !mineIds.includes("p3"));
check("Staff get the staff title, client first name only", mine.items[0].title === "Justin · Wedding" && !JSON.stringify(mine.items).includes("Reyes"));
check("Staff rows open their own event page and chat", mine.items.every((e) => (e.href ?? `/team/e/${e.id}`) === `/team/e/${e.id}` && e.chat?.href === `/team/e/${e.id}?tab=chat`));
check("Staff see their own pay status", mine.items[0].paid === `Paid ${time.shortDate(addDays(today, 2))}` && mine.items.find((e) => e.id === "p2")!.paid === "Not paid yet");
const joPage = await past.pastEventsFor({ ...jo }, { today });
check("Another role sees only their own, with their own paid date", joPage.items.map((e) => e.id).join() === "p3" && joPage.items[0].paid === `Paid ${time.shortDate(addDays(today, -3))}`);
check("An admin in Bartender view is treated as staff", (await past.pastEventsFor({ ...admin, role: "bartender" }, { today })).items.length === 0);

// ----- 3. Search -----
const byName = await past.pastEventsFor({ ...admin }, { today, q: "maria" });
check("Search finds past events by name", byName.items.map((e) => e.id).join() === "p2");
check("Search matches every word", (await past.pastEventsFor({ ...admin }, { today, q: "dana wedding" })).items.map((e) => e.id).join() === "p3");
check("Staff cannot find someone else's event by searching", (await past.pastEventsFor({ ...sam }, { today, q: "dana" })).items.length === 0);
check("Staff search uses the first name only", (await past.pastEventsFor({ ...sam }, { today, q: "reyes" })).items.length === 0 && (await past.pastEventsFor({ ...sam }, { today, q: "justin" })).items.length === 1);
check("No match comes back empty", (await past.pastEventsFor({ ...admin }, { today, q: "nobody" })).items.length === 0);

// ----- 4. Show more, 30 at a time -----
reset();
for (let i = 1; i <= 70; i++) db.sessions.push(ev(`m${i}`, addDays(today, -i), `Client ${i}`));
const p1 = await past.pastEventsFor({ ...admin }, { today });
check("The first page holds 30 rows and says there is more", p1.items.length === past.PAST_PAGE && past.PAST_PAGE === 30 && p1.more);
const p2 = await past.pastEventsFor({ ...admin }, { today, offset: 30 });
const all = (await past.pastEventsFor({ ...admin }, { today, limit: 1000 })).items;
check("Show more continues where the last page stopped, no repeats", p2.items[0].id === all[30].id && !p2.items.some((e) => p1.items.some((f) => f.id === e.id)));
const p3 = await past.pastEventsFor({ ...admin }, { today, offset: 60 });
check("The last page says there is no more", p3.items.length === all.length - 60 && !p3.more, `${p3.items.length} ${all.length}`);
check("Pages stay newest first across Show more", [...p1.items, ...p2.items, ...p3.items].every((e, i, a) => i === 0 || (a[i - 1].day ?? "") >= (e.day ?? "")));
db.sessions.push(ev("z1", addDays(today, -3), "Maria Gomez"));
const sp1 = await past.pastEventsFor({ ...admin }, { today, q: "client" });
const sp2 = await past.pastEventsFor({ ...admin }, { today, q: "client", offset: 30 });
check("Show more works with a search too", sp1.items.length === 30 && sp1.more && sp2.items.length === 30 && sp2.items.every((e) => e.title.startsWith("Client ") && !sp1.items.some((f) => f.id === e.id)));
check("A bad offset is read as the start", (await past.pastEventsFor({ ...admin }, { today, offset: "nope" })).items[0].id === p1.items[0].id);

// ----- 5. Months -----
const grouped = months.pastMonths([
  { id: "a", day: "2026-11-14" },
  { id: "b", day: "2026-11-14" },
  { id: "c", day: "2026-11-02" },
  { id: "d", day: "2026-10-30" },
]);
check("Grouped by month with a heading like November 2026", grouped.map((m) => m.label).join("|") === "November 2026|October 2026");
check("Days inside a month, in order", grouped[0].days.map((d) => d.label).join("|") === "Saturday, November 14|Monday, November 2" && grouped[0].days[0].events.length === 2);

// ----- 6. The page -----
const page = src("app/team/events/page.tsx");
const list = src("app/team/events/past-events.tsx");
const route = src("app/api/team/events/past/route.ts");
check("Three tabs: Events, Open shifts, Past events", page.includes('href="/team/events?tab=past"') && page.includes("grid-cols-3") && page.includes("Open shifts"));
check("The Events tab still shows upcoming only", page.includes("const sections = upcomingSections(events, today);") && !page.includes("pastSection"));
check("The old past link opens the Past events tab", page.includes('params.past === "1" ? "past"'));
check("The first 30 come from the server for the signed in person", page.includes('tab === "past" ? pastEventsFor(staff, { today }) : null'));
check("Search and Show more ask the server, which checks who is signed in", list.includes("/api/team/events/past?q=") && route.includes("getCurrentStaff()") && route.includes("status: 401"));
check("Rows use the same row as the upcoming list", list.includes('import { EventRow } from "./event-list";'));
check("Show more button", list.includes('"Show more"'));
const shown = [list, page, src("lib/team/past-events-db.ts")].join("\n").match(/"[^"\n]*"/g)?.filter((t) => /Show more|Not paid|No past|No events match|Past events|past events|Loading/.test(t)) ?? [];
check("No hyphens in on screen wording", shown.length > 0 && shown.every((t) => !t.includes("-")), shown.join(" "));

done("past events");
