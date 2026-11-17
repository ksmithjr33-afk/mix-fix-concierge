// Event titles on admin and staff views: "Client name · Event type", with the
// client's own event name as a smaller second line, never the title. Admins
// and managers see the full name; everyone else, and every text to staff,
// sees the first name. Nothing the client sees changes.
// Run: node --no-warnings scripts/test-titles.mts

import { check, done, src } from "./team-harness.mts";

const list = await import("../lib/team/event-list.ts");
const search = await import("../lib/team/search.ts");

const named = { client_name: "Justin Reyes", event_type: "Birthday", event_name: "Justin's 30th", event_date: "2026-12-05", bar_service_start: "6:00pm", bar_service_end: "10:00pm", package: "Full Bar" };
const plain = { client_name: "Maria Lopez", event_type: "Wedding", event_date: "2026-12-06" };
const nameOnly = { event_name: "Hand added party" };

check("Staff title: first name and event type", list.eventTitle(named) === "Justin · Birthday");
check("Admin title: full name and event type", list.adminEventTitle(named) === "Justin Reyes · Birthday");
check("By role: admins and managers get the full name, everyone else the first", list.titleFor(named, "admin") === "Justin Reyes · Birthday" && list.titleFor(named, "manager") === "Justin Reyes · Birthday" && ["bartender", "bar_back", "server", "event_helper"].every((r) => list.titleFor(named, r) === "Justin · Birthday"));
check("The client's event name is the second line, never the title", list.eventSubtitle(named) === "Justin's 30th" && list.eventSubtitle(plain) === "");
check("With no name or type at all, the event name is the title and there is no second line", list.eventTitle(nameOnly) === "Hand added party" && list.eventSubtitle(nameOnly) === "");
check("Anything that can reach the client keeps the old title", list.clientEventTitle(named) === "Justin's 30th" && src("lib/team/closeout-db.ts").includes("eventTitle: clientEventTitle(ed)"));

const row = (id: string, ed: Record<string, unknown>) => ({ id, event_data: ed });
const adminItem = list.eventListItem(row("s1", named), undefined, { admin: true });
const staffItem = list.eventListItem(row("s1", named));
check("Admin list rows: full name title, event name second line", adminItem.title === "Justin Reyes · Birthday" && adminItem.subtitle === "Justin's 30th");
check("Staff list rows: first name title, event name second line", staffItem.title === "Justin · Birthday" && staffItem.subtitle === "Justin's 30th");
check("The detail line no longer repeats the name", !adminItem.detail.includes("Justin"));
check("Admin search matches the client's full name, the event type and the event name", ["reyes", "justin reyes", "birthday", "30th"].every((q) => search.matchesSearch(adminItem, q)));
check("Staff search matches first name, type and event name, never the last name", ["justin", "birthday", "30th"].every((q) => search.matchesSearch(staffItem, q)) && !search.matchesSearch(staffItem, "reyes"));

check("The list and calendar show the second line", src("app/team/events/event-list.tsx").includes("{e.subtitle && <span") && src("app/team/calendar-view.tsx").includes("{e.subtitle && <span"));
check("The admin lists and calendar use the admin title", src("lib/team/my-events.ts").includes("eventListItem(r, own.get(r.id), { admin: true })") && src("app/team/admin/events/page.tsx").includes("eventListItem(s, undefined, { showMarket: true, admin: true })"));
const mgr = src("app/team/admin/e/[id]/page.tsx");
check("The manager view header: full name title, event name below", mgr.includes("{adminEventTitle(ed)}</h1>") && mgr.includes("{eventSubtitle(ed) && <p"));
const tabs = src("app/team/e/[id]/event-tabs.tsx");
check("The staff event page header: first name title, event name below", tabs.includes('[view.clientFirstName, view.eventType].filter(Boolean).join(" · ")') && tabs.includes("{view.eventName && (view.clientFirstName || view.eventType) && <p"));
check("Chat texts and the chat list title by the reader's role", src("lib/team/chat-db.ts").includes("title: titleFor(ed, m.role)") && src("lib/team/chat-db.ts").includes("title: titleFor(eventData(access.session), person.role)") && src("lib/team/chat-db.ts").includes("title: titleFor(eventData(s), staff.role)"));
check("Admin alerts use the full name", ["lib/change-requests.ts", "lib/team/clock-db.ts", "lib/team/menu-pickup-db.ts", "lib/team/bar-ready-db.ts", "lib/team/missing-db.ts"].every((p) => src(p).includes("adminEventTitle(")));
check("Staff texts keep the first name (ice, assignments, clock out, closeout reminder)", src("lib/team/ice-pickup-db.ts").includes("title: eventTitle(ed), date:") && src("lib/team/assignments-db.ts").includes("title: eventTitle(ed),") && src("lib/team/clock-db.ts").includes("clockOutReminderText({ firstName: firstName(staff.name), title: eventTitle(ed)"));
check("Payroll rows keep the first name", src("lib/team/timesheet-db.ts").includes("eventTitle: eventTitle(ed), // first name only"));
check("Client pages are untouched", !src("app/s/event-summary.tsx").includes("event-list") && src("app/s/event-summary.tsx").includes('<Row label="Event" value={text(data.event_name) || text(data.event_type)} />'));

done("event title");
