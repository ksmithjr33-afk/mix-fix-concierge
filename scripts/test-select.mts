// Part 1: picking shifts to post from the staffing page ("Select" mode).
// Run: node --no-warnings scripts/test-select.mts

import { addDays, check, done, event, src, texts, textsTo } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const shifts = await import("../lib/team/shifts.ts");
const shiftsDb = await import("../lib/team/shifts-db.ts");
const { calendarGrid, shownEvents } = await import("../lib/team/calendar.ts");
const { eventListItem } = await import("../lib/team/event-list.ts");
const { matchesSearch } = await import("../lib/team/search.ts");

const CT = "America/Chicago";
const today = time.todayIn(CT);
const day10 = addDays(today, 10);
const NOON = time.zonedInstant(today, 12 * 60, CT);
const TEN_PM = time.zonedInstant(today, 22 * 60, CT);
const OPEN_LINK = "https://plan.test/team/events?tab=open";

const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true, alerts: true, markets: ["dallas"] };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true, markets: ["austin"] };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true, markets: ["dallas", "austin"] };
const b3 = { id: "b3", name: "Riley Park", phone: "+12145550113", role: "bartender" as const, active: true, markets: ["dallas"] };

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    event("au1", day10, "500 Congress Ave, Austin, TX", { event_name: "Austin One" }, { team_market: "austin", team_market_source: "auto" }),
    event("au2", addDays(today, 12), "1 Main St, Austin, TX", { event_name: "Austin Two" }, { team_market: "austin", team_market_source: "auto" }),
    event("da1", day10, "1 Elm St, Dallas, TX", { event_name: "Dallas One" }, { team_market: "dallas", team_market_source: "auto" }),
    event("full", day10, "2 Elm St, Dallas, TX", { event_name: "Full One" }, { team_market: "dallas", team_market_source: "auto" }),
    event("posted", day10, "3 Elm St, Dallas, TX", { event_name: "Posted One" }, { team_market: "dallas", team_market_source: "auto" }),
    event("hid", day10, "4 Elm St, Dallas, TX", { event_name: "Hidden One" }, { team_market: "dallas", team_market_source: "auto" }),
    event("nomk", day10, "9 Far Rd, Oklahoma City, OK", { event_name: "Far One" }, { team_market: null, team_market_source: "none", team_market_address: "9 Far Rd, Oklahoma City, OK" }),
    event("past", addDays(today, -2), "5 Elm St, Dallas, TX", { event_name: "Past One" }, { team_market: "dallas", team_market_source: "auto" }),
  ];
  db.staff = [admin, b1, b2, b3].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "f1", session_id: "full", staff_id: "b3", status: "accepted" },
    { id: "f2", session_id: "full", staff_id: "b2", status: "offered" },
  ];
  db.shift_posts = [{ id: "p0", session_id: "posted", market: "dallas", kind: "open", status: "posted", posted_by: "a1", posted_at: NOON.toISOString() }];
  db.shift_requests = [];
  db.shift_handoffs = [];
  db.shift_notices = [];
  db.team_notices = [];
  db.team_hidden_events = [{ session_id: "hid" }];
  texts.length = 0;
}
const posts = () => db.shift_posts.filter((p) => p.status === "posted").map((p) => p.session_id).sort().join();

// ----- The rule: which events get a checkbox -----
const base = { hidden: false, past: false, day: day10, market: "dallas" as const, needed: 2, spotsOpen: 1, alreadyPosted: false };
check("An unstaffed upcoming event with a market can be selected", shifts.selectBlock(base) === null);
check("Already posted: no checkbox", shifts.selectBlock({ ...base, alreadyPosted: true }) === "already posted");
check("Fully staffed: no checkbox", shifts.selectBlock({ ...base, spotsOpen: 0 }) === "fully staffed");
check("Hidden: no checkbox", shifts.selectBlock({ ...base, hidden: true }) === "hidden");
check("No market: no checkbox", shifts.selectBlock({ ...base, market: null }) === "no market");
check("Past: no checkbox", shifts.selectBlock({ ...base, past: true }) === "past");
check("No date: no checkbox", shifts.selectBlock({ ...base, day: null }) === "no date");
check("Unknown staff count: no checkbox", shifts.selectBlock({ ...base, needed: null, spotsOpen: 0 }) === "staff count unknown");
check("Fully staffed wins over no market", shifts.selectBlock({ ...base, market: null, spotsOpen: 0 }) === "fully staffed");

// ----- Select all shown respects the market filter and the search -----
reset();
const items = db.sessions.map((s) => eventListItem(s as never));
const reasons: Record<string, string> = { full: "fully staffed", posted: "already posted", nomk: "no market", past: "past" };
const austinOnly = items.filter((i) => i.market === "austin");
const shownIds = (list: typeof items, q: string) => list.filter((e) => matchesSearch(e, q) && !reasons[e.id]).map((e) => e.id);
check("Select all shown with the Austin filter picks only Austin events", shownIds(austinOnly, "").join() === "au1,au2");
check("Select all shown with a search picks only matching events", shownIds(items.filter((i) => i.id !== "hid"), "two").join() === "au2");
check("Select all shown skips events with a reason", !shownIds(items, "").some((id) => reasons[id]));
const grid = calendarGrid("month", day10, today, items.filter((i) => i.id !== "hid"));
check("Calendar select all covers the days shown", shownEvents(grid).some((e) => e.id === "au1") && !shownEvents(grid).some((e) => e.id === "hid"));
const board = src("app/team/admin/events/staffing-board.tsx");
const list = src("app/team/events/event-list.tsx");
check("The list's select all uses the searched list, not every event", /const ids = shown\.flatMap[\s\S]{0,120}!select\.reasons\[e\.id\]/.test(list));
check("The calendar's select all uses the shown days and skips reasons", board.includes("shownEvents(grid).filter((e) => !reasons[e.id])"));
check("The bottom bar says Post <n> shifts and Cancel", board.includes("`Post ${selected.size} ${selected.size === 1 ? \"shift\" : \"shifts\"}`") && board.includes(">\n              Cancel"));
check("Select mode works in list and calendar", board.includes("<CalendarView grid={grid} links={links} empty={empty} select={select} />") && board.includes("<EventList sections={sections} empty={empty} select={select} />"));
const page = src("app/team/admin/events/page.tsx");
check("Post all unstaffed is kept", page.includes("<PostAll count={unstaffed} market={marketFilter} />"));
check("The per event Post shift button is kept", src("app/team/admin/e/[id]/shift-panel.tsx").includes('action: "post"'));
check("Reasons come from the same rule", page.includes("selectBlock({"));

// ----- Posting a selection -----
reset();
const r = await shiftsDb.postSelected(admin, ["au1", "au2", "da1", "full", "posted", "hid", "nomk", "past", "ghost", "au1"], NOON);
check("Only the postable picks are posted", r.ok && r.posted === 3 && posts() === "au1,au2,da1,posted", JSON.stringify(r) + posts());
const skipped = r.ok ? Object.fromEntries(r.skipped.map((s) => [s.id, s.reason])) : {};
check(
  "Every unpostable pick is skipped with why",
  skipped.full === "fully staffed" && skipped.posted === "already posted" && skipped.hid === "hidden" && skipped.nomk === "no market" && skipped.past === "past" && skipped.ghost === "not found",
  JSON.stringify(skipped)
);
check("A duplicate pick is posted once", db.shift_posts.filter((p) => p.session_id === "au1").length === 1);
check("One batched text per bartender per market, right away", textsTo(b1).length === 1 && textsTo(b2).length === 2 && textsTo(b3).length === 1, JSON.stringify(texts));
check("Two Austin shifts batch into one text", textsTo(b1)[0]?.message === `2 new Mix Fix shifts posted in Austin. See them and request: ${OPEN_LINK}`, textsTo(b1)[0]?.message);
check("A single Dallas shift keeps the detailed text", /^New Mix Fix shift: /.test(textsTo(b3)[0]?.message ?? ""));
check("The admin is not texted", textsTo(admin).length === 0);
check("Result counts texts", r.ok && r.texted === 4 && r.held === 0, JSON.stringify(r));
const msg = r.ok ? shifts.selectedMessage(r) : "";
check("Result line: posted, texts, skipped with why", msg.startsWith("Posted 3 shifts. 4 texts sent, one per bartender per market. Skipped 6:") && msg.includes("Full One (fully staffed)") && msg.includes("Far One (no market)"), msg);
check("Result line never names the client", !/Reyes|justin@example/.test(msg));
check("Posting the same selection again posts nothing", await (async () => { const again = await shiftsDb.postSelected(admin, ["au1", "da1"], NOON); return again.ok && again.posted === 0 && again.skipped.every((s) => s.reason === "already posted") && texts.length === 4; })());

// ----- Quiet hours -----
reset();
const late = await shiftsDb.postSelected(admin, ["au1", "da1"], TEN_PM);
check("At 10:00 PM nothing is sent and the texts are held", late.ok && late.posted === 2 && texts.length === 0 && late.texted === 0 && late.held === 4, JSON.stringify(late));
check("The result line says held for quiet hours", late.ok && shifts.selectedMessage(late).includes("4 held for quiet hours, sent at 8:00 AM."));
await shiftsDb.deliverShiftNotices(time.zonedInstant(addDays(today, 1), 8 * 60, CT));
check("Held texts go out at 8:00 AM, one per bartender per market", textsTo(b1).length === 1 && textsTo(b2).length === 2 && textsTo(b3).length === 1);

// ----- Guard rails -----
reset();
const bart = await shiftsDb.postSelected(b1 as never, ["au1"], NOON);
check("A bartender cannot post a selection", !bart.ok && bart.status === 403 && db.shift_posts.length === 1);
check("An empty selection is refused", !(await shiftsDb.postSelected(admin, [], NOON)).ok);
check("A selection over the limit is refused", !(await shiftsDb.postSelected(admin, Array.from({ length: shifts.SELECT_MAX + 1 }, (_, i) => `x${i}`), NOON)).ok);
check("A non-list selection is refused", !(await shiftsDb.postSelected(admin, "au1", NOON)).ok);
const route = src("app/api/team/admin/shifts/route.ts");
check("The route is admin only and has post_selected", route.includes('body.action === "post_selected"') && route.includes('role !== "admin"'));
check("Post all unstaffed still works", (await shiftsDb.postAllUnstaffed(admin, null, NOON)).posted === 3);

done("select");
