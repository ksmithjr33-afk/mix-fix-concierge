// Staffing corrections with no price change: "Bartenders needed" on the Team
// tab, and "A barback was not part of this booking" on the Booking card, with
// the package wording following. Real code against the in-memory database.
// Run: node --no-warnings scripts/test-staffing-fix.mts

import { registerHooks } from "node:module";
import { addDays, check, done, hooks, src, texts } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db } = await import("./fake-supabase.mts");
const stub = await import("./stub-next.mts");
const codes = await import("../lib/team/codes.ts");
const time = await import("../lib/team/time.ts");
const fix = await import("../lib/team/staffing-fix.ts");
const extras = await import("../lib/package-extras.ts");
const info = await import("../lib/packages-info.ts");
const pp = await import("../lib/package-prompt.ts");
const pc = await import("../lib/price-change.ts");
const view = await import("../lib/team/event-view.ts");
const myEvents = await import("../lib/team/my-events.ts");
const assignDb = await import("../lib/team/assignments-db.ts");
const shifts = await import("../lib/team/shifts-db.ts");
const updates = await import("../lib/event-updates.ts");
const editDb = await import("../lib/team/admin-edit-db.ts");
const route = await import("../app/api/team/admin/staffing/route.ts");

const today = time.chicagoToday();
const SOON = addDays(today, 30);
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin", active: true, alerts: true };
const manager = { id: "m1", name: "Alex Rivera", phone: "+12145550102", role: "manager", active: true, alerts: true };
const jayde = { id: "b1", name: "Jayde Moore", phone: "+12145550111", role: "bartender", active: true, markets: ["dallas"] };
const sam = { id: "b2", name: "Sam Lee", phone: "+12145550112", role: "bartender", active: true, markets: ["dallas"] };
const marcus = { id: "b3", name: "Marcus Hill", phone: "+12145550113", role: "bar_back", active: true, markets: ["dallas"] };

function ev(id: string, pkg: string, eventType: string, guests: number, ed: Record<string, unknown> = {}, top: Record<string, unknown> = {}) {
  return {
    id,
    name: "Justin Reyes",
    email: "justin@example.com",
    status: "submitted",
    version: 1,
    event_date: SOON,
    package_type: pkg,
    guest_count: String(guests),
    hours_booked: "5",
    event_type: eventType,
    team_market: "dallas",
    submitted_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    booked_price: null as unknown,
    package_extras: {} as Record<string, unknown>,
    event_data: {
      client_name: "Justin Reyes",
      event_type: eventType,
      event_date: SOON,
      bar_service_start: "5:00pm",
      bar_service_end: "10:00pm",
      arrival_time: "3:30pm",
      hours_booked: 5,
      guest_count: guests,
      package: pkg,
      event_address: "1 Main St, Dallas, TX",
      signature_drinks: [],
      ...ed,
    } as Record<string, unknown>,
    ...top,
  };
}

/** A booked price as create-session stores it: the engine's price for the event, with its basis. */
function booked(row: ReturnType<typeof ev>, overrides: Record<string, unknown> = {}) {
  const b = pc.computeBaseline(pc.withHoursBooked(row.event_data as never, row as never), row as never, {})!;
  return { ...b, source: "create-session", ...overrides };
}

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  // Came in with no bartender count: 90 guests estimates 2, but 1 was sold.
  const est = ev("est", "Full Bar", "Birthday", 90);
  // The booking says 2 bartenders.
  const two = ev("two", "Full Bar", "Birthday", 90, { bartenders: 2 });
  // A Full Bar wedding priced with the barback in.
  const fw = ev("fw", "Full Bar", "Wedding", 100, { bartenders: 2 });
  fw.booked_price = booked(fw);
  const bd = ev("bd", "The Big Day Bar", "Wedding", 100, { bartenders: 2 });
  bd.booked_price = booked(bd);
  const pr = ev("pr", "Premium Bar", "Wedding", 100, { bartenders: 2 });
  pr.booked_price = booked(pr);
  db.sessions = [est, two, fw, bd, pr];
  db.staff = [admin, manager, jayde, sam, marcus].map((s) => ({ ...s }));
  db.event_assignments = [
    { id: "x1", session_id: "est", staff_id: "b1", status: "accepted", assigned_at: "2026-11-01T12:00:00Z" },
    { id: "x2", session_id: "fw", staff_id: "b1", status: "accepted", assigned_at: "2026-11-01T12:00:00Z" },
    { id: "x3", session_id: "fw", staff_id: "b2", status: "accepted", assigned_at: "2026-11-01T12:01:00Z" },
  ];
  db.event_updates = [];
  db.shift_posts = [];
  db.shift_requests = [];
  db.team_hidden_events = [];
  for (const t of ["event_messages", "event_message_reads", "event_menu_pickups", "event_ice_pickups", "event_ice_pickup_people", "staff_sessions", "staff_login_codes"]) db[t] = [];
  texts.length = 0;
  hooks.length = 0;
}

type Row = ReturnType<typeof ev> & { booked_price: { total: number; basis: Record<string, unknown> | null } | null };
const row = (id: string) => db.sessions.find((s) => s.id === id) as unknown as Row;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const origin = "https://plan.test";
async function signIn(staffId: string) {
  const token = `tok-${staffId}-${Math.random()}`;
  db.staff_sessions.push({ token_hash: codes.hashToken(token), staff_id: staffId, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  stub.stubCookies.clear();
  stub.stubCookies.set(codes.SESSION_COOKIE, token);
}
const call = (body: Record<string, unknown>) => route.POST(new Request(`${origin}/api/team/admin/staffing`, { method: "POST", body: JSON.stringify(body) }));
const cards = async () => new Map((await myEvents.eventsForViewer({ ...admin } as never)).map((e) => [e.id, e]));

// ===== 1. Bartenders needed =====
reset();
check("The booking had no count: the estimate is 2 from 90 guests", view.bartendersNeeded(row("est") as never) === 2 && fix.bookedBartenders(row("est")).estimated);
check("The estimated note shows when the booking had no count", fix.estimateNote(row("est")) === "Estimated from 90 guests. Set the right number.", fix.estimateNote(row("est")));
check("...and never when the booking had one", fix.estimateNote(row("two")) === "" && !fix.bookedBartenders(row("two")).estimated);
check("...nor when the booked price came with a count", fix.estimateNote({ ...row("est"), booked_price: { bartenders: 1, source: "create-session" } }) === "");

let c = await cards();
check("Before: the card says 1 bartender still needed and the color is open", c.get("est")!.team?.needed === "1 bartender still needed" && c.get("est")!.staffing === "open", JSON.stringify(c.get("est")!.team));
const badgeBefore = (await assignDb.staffingByEvent([row("est")] as never)).get("est")!.stillNeeded;
check("Before: the Team badge counts 1 open spot", badgeBefore === 1);
// An open shift post for the spot the estimate made up.
db.shift_posts.push({ id: "p1", session_id: "est", kind: "open", status: "posted", posted_at: "2026-11-01T12:00:00Z", market: "dallas" });

const beforeBooked = clone(row("est").booked_price);
const beforeEd = clone(row("est").event_data);
const beforeVersion = row("est").version;
const quoteBefore = await updates.quoteEventUpdate("est", { guest_count: 120 });

await signIn(admin.id);
let res = await call({ sessionId: "est", action: "bartenders", value: 1 });
check("An admin sets Bartenders needed to 1", res.status === 200, String(res.status));
c = await cards();
check("The card follows: nothing still needed", !c.get("est")!.team?.needed, JSON.stringify(c.get("est")!.team));
check("The staffing color follows: full", c.get("est")!.staffing === "full", c.get("est")!.staffing);
check("The Team badge follows: 0 open", (await assignDb.staffingByEvent([row("est")] as never)).get("est")!.stillNeeded === 0);
check("The open shift post follows: covered, so it closes", db.shift_posts[0].status === "filled", String(db.shift_posts[0].status));
check("The booked price is untouched (total and price basis)", JSON.stringify(row("est").booked_price) === JSON.stringify(beforeBooked));
check("The event data and version are untouched", JSON.stringify(row("est").event_data) === JSON.stringify(beforeEd) && row("est").version === beforeVersion);
check("No update history row", db.event_updates.length === 0);
check("Nothing sent: no GHL webhook, no texts", hooks.length === 0 && texts.length === 0, JSON.stringify({ hooks: hooks.map((h) => h.url), texts }));
const quoteAfter = await updates.quoteEventUpdate("est", { guest_count: 120 });
check("A later priced change is priced exactly as before", JSON.stringify({ ...quoteAfter?.price, requested_at: 0 }) === JSON.stringify({ ...quoteBefore?.price, requested_at: 0 }));
check("Who and when are logged", row("est").package_extras.bartenders_needed_by === "Kenneth" && !!row("est").package_extras.bartenders_needed_at && fix.staffingLog(row("est"))[0]?.text === "Bartenders needed set to 1" && fix.staffingLog(row("est"))[0]?.by === "Kenneth");
check("The estimated note goes away once it is set", fix.estimateNote(row("est")) === "");
check("Values outside 1 to 4 are refused", (await call({ sessionId: "est", action: "bartenders", value: 5 })).status === 400 && (await call({ sessionId: "est", action: "bartenders", value: 0 })).status === 400 && row("est").package_extras.bartenders_needed === 1);

await signIn(manager.id);
res = await call({ sessionId: "two", action: "bartenders", value: 3 });
check("A manager can set it too", res.status === 200 && view.bartendersNeeded(row("two") as never) === 3 && row("two").package_extras.bartenders_needed_by === "Alex");
c = await cards();
check("Raised to 3: the badge counts 3 open and the color is none (nobody on it yet)", (await assignDb.staffingByEvent([row("two")] as never)).get("two")!.stillNeeded === 3 && c.get("two")!.staffing === "none");
res = await call({ sessionId: "two", action: "bartenders", value: null });
check("Use the booking's number goes back to 2, and is logged", res.status === 200 && view.bartendersNeeded(row("two") as never) === 2 && fix.staffingLog(row("two"))[0]?.text === "Bartenders needed back to the booking's number (2)");

// A later priced change to the booking's count wins over the correction.
reset();
await signIn(admin.id);
await call({ sessionId: "two", action: "bartenders", value: 1 });
row("two").event_data.bartenders = 3;
check("If the booking's count changes later (a priced change), the booking's new count is used", view.bartendersNeeded(row("two") as never) === 3);

// ===== 2. Barback not part of this booking =====
reset();
await signIn(admin.id);
const fwTotal = row("fw").booked_price!.total;
c = await cards();
check("Before: the Full Bar wedding card says bar back needed", c.get("fw")!.team?.needed === "bar back needed", c.get("fw")!.team?.needed);
res = await call({ sessionId: "fw", action: "barback_not_booked" });
check("A barback was not part of this booking: saved", res.status === 200, String(res.status));
check("The booked total stays exactly the same", row("fw").booked_price!.total === fwTotal);
check("No change order or update row", db.event_updates.length === 0);
check("Nothing sent: no client text, no GHL update", hooks.length === 0 && texts.length === 0);
check("The barback is off for staffing", !extras.barbackStatus(row("fw")).on && extras.barbackStatus(row("fw")).notBooked);
c = await cards();
check("The card no longer says bar back needed", !c.get("fw")!.team?.needed, JSON.stringify(c.get("fw")!.team));
check("The Team tab says not part of this booking, set by Kenneth", extras.barbackStatus(row("fw")).line === "Barback: not part of this booking, set by Kenneth");
check("It is logged", fix.staffingLog(row("fw"))[0]?.text === "Barback marked not part of this booking (no price change)" && fix.staffingLog(row("fw"))[0]?.by === "Kenneth");
const pkg = info.packageShortFor("Full Bar", extras.bookingShortOf(row("fw")))!;
check("The Package card lists no barback and does not say removed", !pkg.bullets.some((b) => /barback|removed/i.test(b)), pkg.bullets.join(" | "));
check("The client's page leaves the line out too", src("app/s/page.tsx").includes("noBarback={barbackStatus(data).notBooked}") && src("app/s/update-mode.tsx").includes("noBarback={noBarback}") && src("app/s/event-summary.tsx").includes('(noBarback ? "none" : "removed")'));
check("The planner page uses the same wording", src("lib/partners/event-page.ts").includes("packageShortFor(v.package, bookingShortOf(s))"));
const csec = pp.bookingPackageSection(row("fw"), "Full Bar", [], "update");
check("The concierge never says removed or included, and quotes an add as a charge", csec.includes("a barback is not part of this booking") && !csec.includes("was removed from this booking") && csec.includes('quote_price_change with barback "Included"'));

// The priced add back, quoted while not part of this booking (compared below).
const addQuote = await editDb.previewAdminEdit("fw", { barback: "Included" });

// Undo at no charge.
res = await call({ sessionId: "fw", action: "barback_add_free" });
check("Add the barback at no charge: on again, total unchanged, nothing sent", res.status === 200 && extras.barbackStatus(row("fw")).on && row("fw").booked_price!.total === fwTotal && db.event_updates.length === 0 && hooks.length === 0 && texts.length === 0);
check("...the mark is gone and the change is logged", !row("fw").package_extras.barback_not_booked && fix.staffingLog(row("fw"))[0]?.text === "Barback added at no charge");
check("...the price basis has the barback again", row("fw").booked_price!.basis?.barback === true);
check("...a free add back only comes from not part of this booking", (await call({ sessionId: "fw", action: "barback_add_free" })).status === 400);

// The priced removal still credits the engine amount.
const pre = await editDb.previewAdminEdit("fw", { barback: "Removed" });
const credit = pre.ok ? pre.preview.engineAmount! : 0;
const saved = await editDb.saveAdminEdit({ sessionId: "fw", admin: admin as never, changes: { barback: "Removed" }, price: { mode: "engine" }, expectedVersion: row("fw").version, origin });
check("Remove the barback and credit the client: credits the engine amount", saved.ok && credit < 0 && row("fw").booked_price!.total === fwTotal + credit, `${credit} ${row("fw").booked_price?.total}`);
check("...shows removed by the admin, not not part of this booking", extras.barbackStatus(row("fw")).line === "Barback: removed by Kenneth" && !extras.barbackStatus(row("fw")).notBooked);
check("...and the Package card says removed", info.packageShortFor("Full Bar", extras.bookingShortOf(row("fw")))!.bullets.includes(info.BARBACK_REMOVED_LINE));
check("...logged with the credit", /^Barback removed \(credit \$\d/.test(fix.staffingLog(row("fw"))[0]?.text ?? ""), fix.staffingLog(row("fw"))[0]?.text);

// Undo with the priced add back.
reset();
await signIn(admin.id);
await call({ sessionId: "fw", action: "barback_not_booked" });
const q = await editDb.previewAdminEdit("fw", { barback: "Included" });
check("Priced add back from not part of this booking is quoted as a charge equal to the removal credit", q.ok && q.preview.engineAmount === -credit && JSON.stringify(q) === JSON.stringify(addQuote), JSON.stringify(q.ok && q.preview));
const back = await editDb.saveAdminEdit({ sessionId: "fw", admin: admin as never, changes: { barback: "Included" }, price: { mode: "engine" }, expectedVersion: row("fw").version, origin });
check("...applies through the normal flow: on, charged, the mark cleared", back.ok && extras.barbackStatus(row("fw")).on && row("fw").booked_price!.total === fwTotal - credit && !row("fw").package_extras.barback_not_booked && db.event_updates.length === 1);
check("...logged with the charge", /^Barback added back \(charge \$\d/.test(fix.staffingLog(row("fw"))[0]?.text ?? ""));

// While not part of this booking, a later change is priced like a booking that never had one.
reset();
await signIn(admin.id);
await call({ sessionId: "fw", action: "barback_not_booked" });
const guestsOff = await updates.quoteEventUpdate("fw", { guest_count: 150 });
const never = ev("never", "Full Bar", "Wedding", 100, { bartenders: 2, barback: "Removed" });
never.booked_price = booked(never);
db.sessions.push(never);
const guestsNever = await updates.quoteEventUpdate("never", { guest_count: 150 });
// The package part of the change. (Gratuity is never lowered below what was booked, so it can differ.)
const pkgDelta = (p: { package_price: number | null } | null | undefined, b: { package_price?: number | null } | null) => (p?.package_price ?? NaN) - (b?.package_price ?? NaN);
const off = pkgDelta(guestsOff?.price, row("fw").booked_price as never);
const sold = pkgDelta(guestsNever?.price, never.booked_price as never);
check("A later guest count change is priced like a booking sold without a barback", Number.isFinite(off) && Math.abs(off - sold) < 1, `${off} vs ${sold}`);
check("...and never brings a barback credit back in", (guestsOff?.price?.amount ?? -1) >= 0);

// A booking with no stored total: the total the pages show is frozen.
reset();
await signIn(admin.id);
row("fw").booked_price = null;
const shown = pc.computeBaseline(pc.withHoursBooked(row("fw").event_data as never, row("fw") as never), row("fw") as never, {})!.total;
await call({ sessionId: "fw", action: "barback_not_booked" });
check("No stored total: the shown total is kept, not lowered", row("fw").booked_price?.total === shown);

// ===== 3. Big Day and Premium =====
reset();
await signIn(admin.id);
for (const id of ["bd", "pr"]) {
  const before = clone(row(id));
  const r = await call({ sessionId: id, action: "barback_not_booked" });
  check(`${id === "bd" ? "The Big Day Bar" : "Premium"} cannot mark the barback not part of the booking`, r.status === 400 && JSON.stringify(row(id)) === JSON.stringify(before));
  check("...and still cannot remove it with a credit", !(await editDb.saveAdminEdit({ sessionId: id, admin: admin as never, changes: { barback: "Removed" }, price: { mode: "engine" }, expectedVersion: 1, origin })).ok);
  check("...still included, no control", extras.barbackStatus(row(id)).line === "Barback: included" && !extras.barbackStatus(row(id)).removable);
}

// ===== 4. A bartender cannot use either control =====
reset();
await signIn(jayde.id);
const fwBefore = clone(row("fw"));
const estBefore = clone(row("est"));
check("A bartender gets Admins only on Bartenders needed", (await call({ sessionId: "est", action: "bartenders", value: 1 })).status === 403);
check("...and on not part of this booking", (await call({ sessionId: "fw", action: "barback_not_booked" })).status === 403);
check("...and on add at no charge", (await call({ sessionId: "fw", action: "barback_add_free" })).status === 403);
check("...nothing changed", JSON.stringify(row("fw")) === JSON.stringify(fwBefore) && JSON.stringify(row("est")) === JSON.stringify(estBefore));
await signIn(admin.id);
stub.stubCookies.set("mf_team_view", "bartender");
check("An admin in Bartender view cannot either", (await call({ sessionId: "est", action: "bartenders", value: 1 })).status === 403);
stub.stubCookies.delete("mf_team_view");
check("The rule: admins and managers only", fix.canFixStaffing("admin") && fix.canFixStaffing("manager") && ["bartender", "bar_back", "server", "event_helper"].every((r) => !fix.canFixStaffing(r)));
const db2 = await import("../lib/team/staffing-fix-db.ts");
check("The save functions check the role too", !(await db2.setBartendersNeeded("est", jayde as never, 1)).ok && !(await db2.setBarbackNotBooked("fw", jayde as never, true)).ok);

// ===== 5. The page =====
const page = src("app/team/admin/e/[id]/page.tsx");
check("The Team tab shows Bartenders needed with the estimate note and the barback line", page.includes("<BartendersNeeded") && page.includes("estimateNote: estimateNote(session)") && page.includes("barbackLine: barback.applies ? barback.line : \"\""));
check("The Details edit form keeps the booking's number (a priced edit), not the staffing number", page.includes("const bart = bookedBartenders(session).count;"));
const ctrl = src("app/team/admin/e/[id]/barback-control.tsx");
check("The Booking card offers both removals with plain labels", ctrl.includes("Remove the barback and credit the client") && ctrl.includes("A barback was not part of this booking") && ctrl.includes("This does not change the price. Use it only when the client was never charged for a barback."));
check("...and both ways back", ctrl.includes("Add the barback at no charge") && ctrl.includes("Add the barback and charge the client"));

// ===== No hyphens on screen =====
const shownText = [
  "Bartenders needed", "Estimated from 90 guests. Set the right number.", "Staffing only. The price and the booking stay the same.", "Use the booking's number",
  "Staffing changes", "Hide staffing changes", "Save", "Saving...", "Pricing...", "Apply", "Cancel", "Turn the barback off",
  "Remove the barback and credit the client", "A barback was not part of this booking", "This does not change the price. Use it only when the client was never charged for a barback.",
  "Add the barback at no charge", "Add the barback and charge the client", "Add the barback back", "Add the barback at no charge. The price stays the same.",
  "Barback: not part of this booking, set by Kenneth", "Pick 1 to 4 bartenders.", "This event has no barback.", "The barback is already off.",
  "Add the barback back through the priced add back.", "Someone else changed this event. Reload and try again.",
  ...fix.staffingLog(row("fw")).map((e) => e.text), "Bartenders needed set to 1", "Bartenders needed back to the booking's number (2)",
  "Barback marked not part of this booking (no price change)", "Barback added at no charge",
];
const ctrlUi = src("app/team/admin/e/[id]/bartenders-needed.tsx") + ctrl;
const missing = shownText.filter((t) => !/\(\d\)|set to 1|Kenneth|^Pick|^This event|already off|priced add back|Someone else|^Barback (marked|added)|^Bartenders needed (set|back)/.test(t) && !ctrlUi.includes(t.replace("'", "&apos;")) && !ctrlUi.includes(t));
check("The wording checked here is the wording on screen", missing.length === 0, missing.join(" | "));
const hyph = shownText.filter((w) => /[A-Za-z]-[A-Za-z]|\s-\s|—|–/.test(w));
check("No hyphens in any new wording on screen", hyph.length === 0, hyph.join(" | "));

done("staffing fix");
