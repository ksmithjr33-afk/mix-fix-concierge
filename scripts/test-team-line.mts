// Three team portal changes: who is on each event card (list, calendar, Past
// events), Home first in the menu, and Resend invite on the Staff page and a
// staff profile. Real code against the in-memory database.
// Run: node --no-warnings scripts/test-team-line.mts

import { registerHooks } from "node:module";
import { addDays, check, done, src, texts, textsTo } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db, queryLog, missingTables } = await import("./fake-supabase.mts");
const stub = await import("./stub-next.mts");
const codes = await import("../lib/team/codes.ts");
const time = await import("../lib/team/time.ts");
const line = await import("../lib/team/team-line.ts");
const myEvents = await import("../lib/team/my-events.ts");
const past = await import("../lib/team/past-events-db.ts");
const nav = await import("../lib/team/header-nav.ts");
const inv = await import("../lib/team/invites.ts");
const invDb = await import("../lib/team/invites-db.ts");
const inviteRoute = await import("../app/api/team/admin/staff/invite/route.ts");

const today = time.chicagoToday();
const SOON = addDays(today, 5);
const ev = (id: string, day: string, extra: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
  id,
  status: "submitted",
  version: 1,
  event_date: day,
  team_market: "dallas",
  event_data: { client_name: "Justin Reyes", event_type: "Birthday", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", arrival_time: "4:30pm", event_address: "1 Main St, Dallas, TX", guest_count: 80, package: "Full Bar", bartenders: 2, ...extra },
  ...top,
});
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin", active: true, alerts: true };
const manager = { id: "m1", name: "Alex Rivera", phone: "+12145550102", role: "manager", active: true, alerts: true };
const jayde = { id: "b1", name: "Jayde Moore", phone: "+12145550111", role: "bartender", active: true };
const shontae = { id: "b2", name: "Shontae Wills", phone: "+12145550112", role: "bartender", active: true };
const marcus = { id: "b3", name: "Marcus Hill", phone: "+12145550113", role: "bar_back", active: true };
const sam = { id: "b4", name: "Sam Lee", phone: "+12145550114", role: "bartender", active: true };
const dee = { id: "b5", name: "Dee Grant", phone: "+12145550115", role: "bartender", active: true };
const gone = { id: "b6", name: "Old Timer", phone: "+12145550116", role: "bartender", active: false };
const at = (min: number) => new Date(Date.UTC(2026, 10, 1, 12, min)).toISOString();

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    // Full: two bartenders and a bar back, all accepted.
    ev("full", SOON, { package: "Big Day Bar", event_type: "Wedding", bartenders: 2 }),
    // One accepted, one not answered, one declined: 3 needed.
    ev("open", SOON, { bartenders: 3 }),
    // Nobody on it.
    ev("none", SOON),
    // Premium has a barback on; two bartenders, no bar back.
    ev("nobb", SOON, { package: "Premium", bartenders: 2 }),
    // Past, one bartender short: names only.
    ev("old", addDays(today, -4)),
  ];
  db.staff = [admin, manager, jayde, shontae, marcus, sam, dee, gone].map((s) => ({ ...s }));
  db.event_assignments = [
    // Marcus offered first, but bartenders come before other roles.
    { id: "x0", session_id: "full", staff_id: "b3", status: "accepted", assigned_at: at(0) },
    { id: "x1", session_id: "full", staff_id: "b1", status: "accepted", assigned_at: at(1) },
    { id: "x2", session_id: "full", staff_id: "b2", status: "accepted", assigned_at: at(2) },
    { id: "x3", session_id: "open", staff_id: "b1", status: "accepted", assigned_at: at(1) },
    { id: "x4", session_id: "open", staff_id: "b4", status: "offered", assigned_at: at(2) },
    { id: "x5", session_id: "open", staff_id: "b5", status: "declined", assigned_at: at(0) },
    { id: "x6", session_id: "nobb", staff_id: "b1", status: "accepted", assigned_at: at(1) },
    { id: "x7", session_id: "nobb", staff_id: "b2", status: "accepted", assigned_at: at(2) },
    { id: "x8", session_id: "old", staff_id: "b1", status: "accepted", assigned_at: at(1) },
  ];
  db.team_hidden_events = [];
  for (const t of ["event_messages", "event_message_reads", "event_menu_pickups", "event_ice_pickups", "event_ice_pickup_people", "payroll_paid", "staff_login_codes", "staff_invites", "staff_sessions"]) db[t] = [];
  texts.length = 0;
}

const byId = <T extends { id: string }>(list: T[], id: string) => list.find((e) => e.id === id)!;
const text = (e: { team?: Parameters<typeof line.teamLineText>[0] }) => line.teamLineText(e.team);

// ----- 1. Event cards: admins and managers -----
reset();
queryLog.length = 0;
const adm = await myEvents.eventsForViewer({ ...admin } as never);
const assignmentQueries = queryLog.filter((q) => q === "event_assignments select").length;
check("Accepted names in order, bartenders first, with the role when it is not bartender", text(byId(adm, "full")) === "Jayde, Shontae, Marcus (bar back)", text(byId(adm, "full")));
check("Names are first names only", byId(adm, "full").team!.accepted.every((n) => !/Moore|Wills|Hill/.test(n)));
check("Someone offered and not answered shows after the accepted, marked not answered", JSON.stringify(byId(adm, "open").team!.pending) === '["Sam (not answered)"]' && byId(adm, "open").team!.accepted.join() === "Jayde");
check("A declined person is never shown", !text(byId(adm, "open")).includes("Dee"), text(byId(adm, "open")));
check("Open spots end the line: 1 bartender still needed (offered counts as on it)", byId(adm, "open").team!.needed === "1 bartender still needed" && text(byId(adm, "open")) === "Jayde, Sam (not answered) · 1 bartender still needed", text(byId(adm, "open")));
check("Nobody on it: No one assigned yet", byId(adm, "none").team!.needed === "No one assigned yet" && byId(adm, "none").team!.accepted.length === 0);
check("Barback on and no bar back assigned: bar back needed", byId(adm, "nobb").team!.needed === "bar back needed", byId(adm, "nobb").team?.needed);
check("A fully staffed event has no needed part", byId(adm, "full").team!.needed === "");
check("Past events show names but never still needed", byId(adm, "old").team!.needed === "" && text(byId(adm, "old")) === "Jayde");
// Two assignment reads in all: the viewer's own (as before) and everyone on every event, which replaced the staffing count read.
check("One query reads everyone on every event in the list (and it also gives the staffing color)", assignmentQueries === 2, `${assignmentQueries} event_assignments queries: ${queryLog.join(", ")}`);
check("The staffing color still works from the same query", byId(adm, "full").staffing === "full" && byId(adm, "open").staffing === "open" && byId(adm, "none").staffing === "none");
const mgr = await myEvents.eventsForViewer({ ...manager } as never);
check("Managers see the line on every event, as admins do", mgr.every((e) => text(e) === text(byId(adm, e.id))));

// More events never means more queries.
for (let i = 0; i < 25; i++) {
  db.sessions.push(ev(`more${i}`, SOON));
  db.event_assignments.push({ id: `y${i}`, session_id: `more${i}`, staff_id: "b2", status: "accepted", assigned_at: at(3) });
}
queryLog.length = 0;
await myEvents.eventsForViewer({ ...admin } as never);
check("30 events still take the same number of queries (no query per card)", queryLog.filter((q) => q === "event_assignments select").length === assignmentQueries, queryLog.join(", "));

// ----- 2. Event cards: staff -----
reset();
const jaydeList = await myEvents.eventsForViewer({ ...jayde } as never);
check("A bartender sees teammates on their own events, never their own name", text(byId(jaydeList, "full")) === "Shontae, Marcus (bar back)", text(byId(jaydeList, "full")));
check("A bartender sees only events they are on", jaydeList.every((e) => ["full", "open", "nobb", "old"].includes(e.id)) && !jaydeList.some((e) => e.id === "none"));
check("A bartender never sees a last name", jaydeList.every((e) => !/Moore|Wills|Hill|Lee|Grant/.test(text(e))));
check("A bartender sees who has not answered, and the open spot", text(byId(jaydeList, "open")) === "Sam (not answered) · 1 bartender still needed", text(byId(jaydeList, "open")));
const samList = await myEvents.eventsForViewer({ ...sam } as never);
check("Someone offered sees the team on that event", samList.length === 1 && text(samList[0]) === "Jayde · 1 bartender still needed", text(samList[0] ?? {}));
const deeList = await myEvents.eventsForViewer({ ...dee } as never);
check("Someone who declined sees nothing about that event", deeList.length === 0);
queryLog.length = 0;
await myEvents.eventsForViewer({ ...jayde } as never);
check("Staff: one query for their teammates on the whole list", queryLog.filter((q) => q === "event_assignments select").length === 2, queryLog.join(", "));

// Past events tab
const pastAdm = await past.pastEventsFor({ ...admin } as never, { today });
check("Past events tab: admins see who was on it", text(byId(pastAdm.items, "old")) === "Jayde");
const pastJ = await past.pastEventsFor({ ...jayde } as never, { today });
check("Past events tab: staff alone on it get no line", !byId(pastJ.items, "old").team);

// The card
const rowSrc = src("app/team/events/event-list.tsx");
check("The list card shows the line under the details, lighter for not answered, red for needed", rowSrc.includes("{e.team && <TeamLineView team={e.team} />}") && rowSrc.includes('pending ? "text-[#A39585]"') && rowSrc.includes("text-[#A0412D]") && rowSrc.includes("break-words"));
check("The Chat link stays in the card's bottom padding, so a wrapped line never pushes it off", rowSrc.includes('absolute right-3 bottom-2') && rowSrc.includes('e.chat ? "pb-6" : ""'));
check("The calendar shows the line on the larger chips and in the chip title", src("app/team/calendar-view.tsx").includes("{big && e.team && <TeamLineView team={e.team} />}") && src("app/team/calendar-view.tsx").includes("teamLineText(e.team)"));
check("The calendar, a client component, never pulls the event view in", !/from "@\/lib\/team\/event-view"/.test(src("lib/team/team-line.ts")));
check("No hyphens in the card wording", !/[-–—]/.test([line.neededText([], { bartenders: 2, barback: true }), "bar back needed", "1 bartender still needed", " (not answered)"].join(" ")));

// ----- 3. Home first in the menu -----
const logoHref = src("app/team/header-nav.tsx").match(/<Link href=\{(\w+)\} className="shrink-0" aria-label="The Mix Fix, home">/)?.[1];
const adminLinks = nav.headerLinks(true, { unreadNews: 0 }, true);
const managerLinks = nav.headerLinks(true, { unreadNews: 0 }, false);
const barLinks = nav.headerLinks(false, { unreadNews: 0 });
check("The logo still goes home, through the same HOME_HREF as Home", logoHref === "HOME_HREF" && nav.HOME_HREF === "/team/events");
for (const [who, links] of [["an admin", adminLinks], ["a manager", managerLinks], ["a bartender", barLinks]] as const) {
  check(`Home is first for ${who} and goes where the logo goes`, links[0].label === "Home" && links[0].href === nav.HOME_HREF && links[0].inline);
}
check("Home is the current page on the home screen (Events is not, for staff)", nav.currentLabel(barLinks, "/team/events") === "Home" && nav.currentLabel(adminLinks, "/team/events") === "Home");
check("Events stays current on an event page for staff", nav.currentLabel(barLinks, "/team/e/s1") === "Events");
const headerSrc = src("app/team/header-nav.tsx");
check("Both the phone panel and the desktop links mark the current page by label (Home and Events share an address)", (headerSrc.match(/current === l\.label/g) ?? []).length === 4 && !headerSrc.includes("current === l.href"));
check("Links are keyed by label so Home and Events never collide", !headerSrc.includes("key={l.href}") && (headerSrc.match(/key=\{l\.label\}/g) ?? []).length === 2);

// ----- 4. Resend invite -----
reset();
const origin = "https://plan.test";
async function signIn(staffId: string) {
  const token = `tok-${staffId}-${Math.random()}`;
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
}
const post = (id: string) => inviteRoute.POST(new Request(`${origin}/api/team/admin/staff/invite`, { method: "POST", body: JSON.stringify({ id }) }));

check("Nothing like it existed: adding a staff member sends no text", !src("lib/team/assignments-db.ts").match(/createStaff[\s\S]{0,900}sendStaffText/));

db.staff_login_codes = [
  { id: "c1", phone: jayde.phone, used_at: "2026-11-03T22:12:00.000Z", created_at: "2026-11-03T22:10:00.000Z" },
  { id: "c2", phone: jayde.phone, used_at: "2026-10-01T15:00:00.000Z", created_at: "2026-10-01T14:59:00.000Z" },
  { id: "c3", phone: sam.phone, used_at: null, created_at: "2026-11-05T10:00:00.000Z" },
];
const statuses = await invDb.inviteStatuses([jayde, sam]);
check("Last sign in is the newest used code", statuses.b1.signIn === `Last sign in ${time.chicagoStamp("2026-11-03T22:12:00.000Z")}`, statuses.b1.signIn);
check("A code never used is Never signed in", statuses.b4.signIn === "Never signed in");

await signIn(admin.id);
let res = await post(sam.id);
let body = await res.json();
check("An admin sends the welcome text with the sign in link", res.status === 200 && textsTo(sam).length === 1 && textsTo(sam)[0].message === inv.welcomeText({ firstName: "Sam", link: `${origin}/team` }), JSON.stringify({ status: res.status, body, texts }));
check("The welcome text has no hyphens", !/[-–—]/.test(textsTo(sam)[0].message.replace(`${origin}/team`, "")));
check("It shows Invite sent to with the last four digits and the time", typeof body.line === "string" && body.line.startsWith("Invite sent to ••• 0114 at ") && body.line.length > "Invite sent to ••• 0114 at ".length, body.line);
check("It is logged with who sent it and when", db.staff_invites.length === 1 && db.staff_invites[0].sent_by === admin.id && db.staff_invites[0].staff_id === sam.id && db.staff_invites[0].ok === true && !!db.staff_invites[0].created_at);
const after = await invDb.inviteStatuses([sam]);
check("The Staff page shows the last invite and who sent it", after.b4.lastInvite.startsWith("Last invite ") && after.b4.lastInvite.endsWith("by Kenneth"), after.b4.lastInvite);

res = await post(sam.id);
body = await res.json();
check("A second send inside two minutes is blocked, and says when", res.status === 429 && /send another in \d+ seconds?/.test(body.error) && textsTo(sam).length === 1, JSON.stringify(body));
const later = new Date(Date.now() + inv.INVITE_GAP_MS + 1000);
const third = await invDb.resendInvite(admin, sam.id, origin, later);
check("After two minutes it can go again", third.ok && textsTo(sam).length === 2);

// A failed text
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("down", { status: 500 })) as typeof fetch;
res = await post(jayde.id);
body = await res.json();
globalThis.fetch = realFetch;
check("A failed text says so on screen instead of success", res.status === 502 && body.error === "The text did not go out to ••• 0111. Check the number and try again." && !body.line, JSON.stringify(body));
check("The failed send is logged as failed and does not hold the two minutes", db.staff_invites.some((r) => r.staff_id === jayde.id && r.ok === false));
res = await post(jayde.id);
check("So it can be tried again right away", res.status === 200 && textsTo(jayde).length === 1);

// Quiet hours never hold it
check("Quiet hours never hold it: it goes straight to the text path", !src("lib/team/invites-db.ts").includes("inQuietHours") && src("lib/team/invites-db.ts").includes("await sendStaffText("));

// Who can use it
await signIn(manager.id);
res = await post(shontae.id);
check("A manager can use it", res.status === 200 && textsTo(shontae).length === 1);
await signIn(jayde.id);
res = await post(shontae.id);
check("A bartender cannot use it", res.status === 403 && textsTo(shontae).length === 1);
await signIn(admin.id);
stub.stubCookies.set("mf_team_view", "bartender");
res = await post(marcus.id);
check("An admin in Bartender view cannot either", res.status === 403 && textsTo(marcus).length === 0);
stub.stubCookies.delete("mf_team_view");
res = await post(gone.id);
check("An inactive person gets no invite", res.status === 400 && textsTo(gone).length === 0);
missingTables.add("staff_invites");
res = await post(marcus.id);
check("Before the migration it refuses rather than send without the limit", res.status === 500 && textsTo(marcus).length === 0);
missingTables.delete("staff_invites");

// Where it shows
const mgrSrc = src("app/team/admin/staff/staff-manager.tsx");
check("Staff page: the button on every active row but your own", mgrSrc.includes("{s.active && !me && <ResendInvite"));
check("Staff profile: the button for an active person", src("app/team/admin/staff/[id]/page.tsx").includes("<ResendInvite staffId={id}") && src("app/team/admin/staff/[id]/page.tsx").includes("person.active && person.id !== me.id"));
check("The button shows the last sign in next to it", src("app/team/admin/staff/resend-invite.tsx").includes("{signIn}"));

done("team line, Home link, and resend invite");
