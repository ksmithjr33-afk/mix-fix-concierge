// Change requests inside six days: a client drink change (and, with auto send
// on, a change to the client's shopping list) is saved as a request instead of
// refused or saved; Approve applies it through the normal update path and
// Decline changes nothing; GHL hears change_request_pending, approved and
// declined; the admins get one text, held in quiet hours unless the event is
// within 24 hours; the Dive Bar set menu rule is unchanged; and the request
// shows on the Client list tab, the events list and the calendar.
// Run: node --no-warnings scripts/test-requests.mts

import { addDays, check, done, hooks, src, texts, textsTo } from "./team-harness.mts";

process.env.GHL_UPDATE_WEBHOOK_URL = "https://hooks.test/update";

const { db } = await import("./fake-supabase.mts");
const updates = await import("../lib/event-updates.ts");
const delivery = await import("../lib/update-delivery.ts");
const cldb = await import("../lib/client-list-db.ts");
const cl = await import("../lib/client-list.ts");
const actions = await import("../lib/client-list-actions.ts");
const requests = await import("../lib/change-requests.ts");
const diff = await import("../lib/event-diff.ts");
const time = await import("../lib/team/time.ts");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const today = time.chicagoToday();
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const NEAR = longDate(addDays(today, 3));
const TOMORROW = longDate(addDays(today, 1));
const FAR = longDate(addDays(today, 20));

const admin = { id: "admin-1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const admin2 = { id: "admin-2", name: "Isabel Jones", phone: "+12145550102", role: "admin" as const, active: true };
const bartender = { id: "bart-1", name: "Sam Lee", phone: "+12145550101", role: "bartender" as const, active: true };
const origin = "https://plan.test";

const MULE = { name: "Mule", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.5 oz lime juice", "Top with ginger beer"], garnish: "lime wheel" };
const MARG = { name: "Margarita", base_spirit: "tequila", ingredients: ["2 oz tequila", "1 oz lime juice", "0.75 oz agave"], garnish: "lime wheel" };
const PALOMA = { name: "Paloma", base_spirit: "tequila", ingredients: ["2 oz tequila", "0.5 oz lime juice", "Top with grapefruit soda"], garnish: "tajin rim" };

function reset(opts: { date?: string; pkg?: string; drinks?: unknown[]; autoSend?: boolean; start?: string } = {}) {
  for (const k of Object.keys(db)) delete db[k];
  const date = opts.date ?? NEAR;
  const ed = {
    client_name: "Alex Butler",
    email: "alex@example.com",
    event_type: "Birthday",
    event_name: "Alex's 40th",
    event_date: date,
    bar_service_start: opts.start ?? "6:00pm",
    bar_service_end: "10:00pm",
    hours_booked: 4,
    guest_count: 100,
    package: opts.pkg ?? "Full Bar",
    event_address: "123 Elm St, Dallas, TX 75201",
    parking_info: "Driveway",
    special_requests: "",
    signature_drinks: opts.drinks ?? [MULE, MARG],
  };
  db.sessions = [
    { id: "s1", name: "Alex Butler", email: "alex@example.com", event_date: date, package_type: ed.package, guest_count: "100", hours_booked: "4", status: "submitted", event_data: ed, version: 1, submitted_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", booked_price: null, team_market: "dallas" },
  ];
  db.event_updates = [{ id: "u1", session_id: "s1", version: 1, source: "concierge", changes: diff.snapshotChanges(ed), summary: "Initial submission", applied: true, created_at: "2026-10-01T00:00:00Z" }];
  db.staff = [admin, admin2, bartender];
  db.event_assignments = [{ id: "a1", session_id: "s1", staff_id: bartender.id, status: "accepted" }];
  db.team_settings = [{ key: cldb.AUTO_SEND_KEY, value: opts.autoSend ?? true }];
  hooks.length = 0;
  texts.length = 0;
}

const session = () => db.sessions[0] as Record<string, unknown> & { event_data: Record<string, unknown>; version: number };
const holds = () => (db.client_list_holds ?? []) as Record<string, unknown>[];
const updateHooks = () => hooks.filter((h) => h.url === "https://hooks.test/update").map((h) => h.body);
const drinkNames = () => (session().event_data.signature_drinks as { name: string }[]).map((d) => d.name).join(", ");
const adminTexts = () => [...textsTo(admin), ...textsTo(admin2)];

/** A client update the way the chat route saves it, delivers it, and announces a new request. */
async function clientUpdate(partial: Record<string, unknown>, now?: Date) {
  const r = await updates.applyEventUpdate("s1", partial, {});
  if (r && r.rows.length > 0) await delivery.deliverEventUpdates("s1", r.rows, { staffOrigin: origin });
  if (r?.held?.fresh) await requests.announceRequest(r.held.id, now);
  return r;
}

/** A time on today's date in Dallas. */
const at = (hour: number, min = 0, day = today) => time.zonedInstant(day, hour * 60 + min, "America/Chicago");
const NOON = at(12);

// ----- A drink change inside six days becomes a request -----
for (const autoSend of [true, false]) {
  reset({ autoSend });
  const r = await clientUpdate({ signature_drinks: [PALOMA, MARG] }, NOON);
  check(`Auto send ${autoSend ? "on" : "off"}: a drink change inside 6 days is saved as a request`, !!r?.held && holds().length === 1 && holds()[0].status === "pending");
  check(`Auto send ${autoSend ? "on" : "off"}: the drink change is not saved on the event`, drinkNames() === "Mule, Margarita" && session().version === 1 && r!.rows.length === 0);
  check(`Auto send ${autoSend ? "on" : "off"}: nothing is refused`, r?.requestFailed === false);
}
reset();
const req = await clientUpdate({ signature_drinks: [PALOMA, MARG] }, NOON);
const hold = holds()[0];
check("The request keeps the full before and after", JSON.stringify((hold.changes as diff.FieldChange[])[0].old) === JSON.stringify(MULE) && JSON.stringify((hold.changes as diff.FieldChange[])[0].new) === JSON.stringify(PALOMA));
check("The request holds the complete drinks array for Approve", JSON.stringify((hold.partial as Record<string, unknown>).signature_drinks) === JSON.stringify([PALOMA, MARG]));
check("The client's event page shows a change is waiting", !!req?.held);
const again = await clientUpdate({ signature_drinks: [PALOMA, MARG] }, NOON);
check("Asking for the same change twice makes one request", holds().length === 1 && again?.held?.fresh === false);

reset();
const mixed = await clientUpdate({ signature_drinks: [PALOMA, MARG], parking_info: "Valet out front" }, NOON);
check("A drink change and a parking change together: parking saves, the drink change waits", mixed?.rows.some((r) => r.applied) && session().event_data.parking_info === "Valet out front" && drinkNames() === "Mule, Margarita" && holds().length === 1);
check("Only the drink change is in the request", Object.keys(holds()[0].partial as object).join() === "signature_drinks");

reset();
const extra = await clientUpdate({ signature_drinks: [MULE, MARG, PALOMA, { ...PALOMA, name: "Paloma 2" }] }, NOON);
check("Inside 6 days a drink beyond the package goes to a manager like any other day, never refused", extra?.rows.some((r) => !r.applied && r.changes.some((c) => c.field === "manager_request")) && extra?.requestFailed === false);

reset({ date: FAR });
const outside = await clientUpdate({ signature_drinks: [PALOMA, MARG] }, NOON);
check("More than 6 days out a drink change saves right away, no request", outside?.held === null && drinkNames() === "Paloma, Margarita" && holds().length === 0);

// ----- The concierge's words -----
const chatSrc = src("app/api/chat/route.ts");
check("The tool result tells the bot the change was sent for approval and is not confirmed", chatSrc.includes("NOT SAVED, SENT TO OUR TEAM FOR APPROVAL") && chatSrc.includes("Never say it was saved"));
check("The fallback reply for a request uses the request message, never 'That change is saved'", /lastApply\.held && lastApply\.rows\.length === 0\) \{\s*text = `\$\{CHANGE_REQUEST_MESSAGE\}/.test(chatSrc));
check("The old drink lock refusal is gone from the chat route and prompts", !/DRINKS_LOCKED_MESSAGE|drink menu is locked/i.test(chatSrc + src("lib/update-prompt.ts") + src("lib/event-diff.ts")));
check("The chat route announces new requests", chatSrc.includes("if (result.held.fresh) await announceRequest(result.held.id)"));

// ----- Admin text and its quiet hours rule -----
reset();
await clientUpdate({ signature_drinks: [PALOMA, MARG] }, NOON);
check("At noon the admins are texted right away, once each", adminTexts().length === 2 && textsTo(admin).length === 1 && textsTo(bartender).length === 0);
const msg = textsTo(admin)[0]?.message ?? "";
check("The text has the event name, date and what was asked", msg.includes("Alex's 40th") && msg.includes(time.shortDate(addDays(today, 3))) && msg.includes("Drink 1: from Mule to Paloma"), msg);
check("The text links to the Client list tab", msg.includes("https://plan.test/team/admin/e/s1?tab=client"));
check("The text never has oz amounts", !/\boz\b/.test(msg));
await requests.announceRequest(String(holds()[0].id), NOON);
await requests.sendRequestTexts(at(13));
check("The admins are texted only once per request", adminTexts().length === 2);

reset();
const late = at(22, 30);
await clientUpdate({ signature_drinks: [PALOMA, MARG] }, late);
check("At 10:30 PM (quiet hours) nobody is texted", adminTexts().length === 0);
const after = String(holds()[0].admin_text_after ?? "");
check("The text waits until 8:00 AM the next morning", after === time.zonedInstant(addDays(today, 1), 8 * 60, "America/Chicago").toISOString(), after);
await requests.sendRequestTexts(at(7, 55, addDays(today, 1)));
check("At 7:55 AM it still waits", adminTexts().length === 0);
await requests.sendRequestTexts(at(8, 0, addDays(today, 1)));
check("At 8:00 AM the admins are texted", adminTexts().length === 2);
await requests.sendRequestTexts(at(8, 5, addDays(today, 1)));
check("The 8:00 AM text goes once", adminTexts().length === 2);

reset({ date: TOMORROW, start: "6:00pm" });
await clientUpdate({ signature_drinks: [PALOMA, MARG] }, at(22, 30));
check("In quiet hours, an event within 24 hours texts the admins right away", adminTexts().length === 2);

reset();
await clientUpdate({ signature_drinks: [PALOMA, MARG] }, late);
await actions.declineHold(admin, "s1", holds()[0].id);
await requests.sendRequestTexts(at(8, 0, addDays(today, 1)));
check("A request decided before 8:00 AM is not texted", adminTexts().length === 0);

check("Pure rule: outside quiet hours, now", requests.requestTextAt({ event_date: NEAR, bar_service_start: "6:00pm" }, NOON).now);
check("Pure rule: quiet hours, 3 days out, waits", !requests.requestTextAt({ event_date: NEAR, bar_service_start: "6:00pm" }, at(23)).now);
check("Pure rule: quiet hours, within 24 hours, now", requests.requestTextAt({ event_date: TOMORROW, bar_service_start: "6:00pm" }, at(23)).now);
check("The cron sends the held texts", src("app/api/cron/team/route.ts").includes("sendRequestTexts(now)"));
check("Texts go through the existing staff text function", src("lib/change-requests.ts").includes("sendStaffText(a.phone, a.name, message)") && src("lib/change-requests.ts").includes("alertAdmins()"));

// ----- GHL: pending, approved, declined -----
reset();
await clientUpdate({ signature_drinks: [PALOMA, MARG] }, NOON);
const pending = updateHooks().at(-1);
check("GHL gets change_request_pending true when a request is made", pending?.change_request_pending === true && pending?.change_request_approved === false && pending?.change_request_declined === false && pending?.event_updated === false);
check("The pending payload has a plain summary", pending?.change_request_summary === "Drink 1: from Mule to Paloma", String(pending?.change_request_summary));

// ----- Approve applies it through the normal update path -----
hooks.length = 0;
texts.length = 0;
const ok = await actions.approveHold(admin, "s1", holds()[0].id, origin);
check("Approve saves the drink change", ok.ok && drinkNames() === "Paloma, Margarita" && session().version === 2, JSON.stringify(ok));
const row = (db.event_updates as Record<string, unknown>[]).find((r) => r.version === 2);
check("Approve writes a normal update row, marked with the admin", !!row && row.applied === true && row.updated_by === "admin" && row.updated_by_name === "Kenneth");
check("Approve texts the assigned bartender like any update", textsTo(bartender).length === 1);
const approved = updateHooks().at(-1);
check("GHL gets change_request_approved true with a plain summary", approved?.change_request_approved === true && approved?.change_request_pending === false && approved?.change_request_summary === "Drink 1: from Mule to Paloma" && approved?.event_updated === true);
check("The request is marked approved", holds()[0].status === "approved" && holds()[0].decided_by_name === "Kenneth");
check("The bartenders' supplies list follows the event (read from the Shopping list sync)", src("lib/update-delivery.ts").includes("await syncOrderSheet(session)"));

// ----- Decline changes nothing -----
reset();
await clientUpdate({ signature_drinks: [PALOMA, MARG] }, NOON);
const before = JSON.stringify(session());
hooks.length = 0;
texts.length = 0;
const no = await actions.declineHold(admin, "s1", holds()[0].id);
check("Decline changes nothing on the event", no.ok && JSON.stringify(session()) === before && (db.event_updates as unknown[]).length === 1);
check("Decline texts nobody on the team", texts.length === 0);
const declined = updateHooks().at(-1);
check("GHL gets change_request_declined true with a plain summary", declined?.change_request_declined === true && declined?.change_request_approved === false && declined?.change_request_summary === "Drink 1: from Mule to Paloma" && declined?.event_updated === false);
check("A declined request cannot be approved after", !(await actions.approveHold(admin, "s1", holds()[0].id, origin)).ok && drinkNames() === "Mule, Margarita");

// Every normal update payload carries the request fields as false.
reset({ date: FAR });
await clientUpdate({ parking_info: "Lot B" }, NOON);
const plain = updateHooks().at(-1);
check("Normal update payloads carry the request fields, all false", plain?.change_request_pending === false && plain?.change_request_approved === false && plain?.change_request_declined === false && plain?.change_request_summary === "");

// ----- The Dive Bar rule is unchanged -----
const DIVE = (await import("../lib/dive-menu.ts")).diveSetMenuDrinks();
for (const [label, date] of [["inside 6 days", NEAR], ["weeks out", FAR]] as const) {
  reset({ pkg: "Dive Bar", drinks: DIVE, date });
  const r = await clientUpdate({ signature_drinks: [PALOMA, ...DIVE.slice(1)] }, NOON);
  check(`Dive Bar ${label}: a drink change is still refused with the set menu message, not made a request`, r?.diveMenuSet === true && r?.held === null && holds().length === 0 && (session().event_data.signature_drinks as { name: string }[])[0].name === "Margarita");
}
reset({ pkg: "Dive Bar", drinks: DIVE });
check("Dive Bar: the chat still answers with the set menu message", chatSrc.includes("DRINK CHANGE NOT SAVED, Dive Bar has a set menu"));

// ----- Where requests show -----
reset();
await clientUpdate({ signature_drinks: [PALOMA, MARG] }, NOON);
check("The events list knows which events have a request waiting", (await cldb.sessionsWithPendingRequests(["s1", "s2"])).has("s1"));
const eventsPage = src("app/team/admin/events/page.tsx");
check("The events list shows a request marker", eventsPage.includes('"change request waiting"') && eventsPage.includes("request: true"));
const cal = src("app/team/calendar-view.tsx");
check("The calendar shows a request marker and explains it", cal.includes("e.request &&") && cal.includes("Change request"));
const managerPage = src("app/team/admin/e/[id]/page.tsx");
check("The Client list tab has a count of requests waiting", managerPage.includes("client: pendingHolds.length"));
const panel = src("app/team/admin/e/[id]/client-list-panel.tsx");
check("The Client list tab shows the full before and after and the price difference, with Approve and Decline", panel.includes("h.blocks") && panel.includes("Price difference") && panel.includes('act("approve"') && panel.includes('act("decline"') && managerPage.includes("changeBlocks("));
check("Approve and Decline are admin only on the server", src("app/api/team/admin/client-list/route.ts").includes('staff.role !== "admin"') && src("lib/client-list-actions.ts").includes('admin.role !== "admin"'));
check("The request message is plain and honest", cl.CHANGE_REQUEST_MESSAGE.includes("not confirmed yet") && !/\bsaved\b/i.test(cl.CHANGE_REQUEST_MESSAGE));

done("change request");
