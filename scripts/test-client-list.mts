// Client shopping list auto send: first send on completion, updated sends,
// the six day lock, held changes with Approve and Decline, the custom recipe
// hold, the admin edit checkbox, and the master switch. Runs the real update
// path against the in-memory database with fetch stubbed.
// Run: node --no-warnings scripts/test-client-list.mts

import { addDays, check, done, hooks, src } from "./team-harness.mts";

process.env.GHL_UPDATE_WEBHOOK_URL = "https://hooks.test/update";

const { db } = await import("./fake-supabase.mts");
const updates = await import("../lib/event-updates.ts");
const delivery = await import("../lib/update-delivery.ts");
const cl = await import("../lib/client-list.ts");
const cldb = await import("../lib/client-list-db.ts");
const actions = await import("../lib/client-list-actions.ts");
const editDb = await import("../lib/team/admin-edit-db.ts");
const lists = await import("../lib/shopping-list.ts");
const time = await import("../lib/team/time.ts");
const diff = await import("../lib/event-diff.ts");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const today = time.chicagoToday();
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const FAR = longDate(addDays(today, 20));
const NEAR = longDate(addDays(today, 3));

const admin = { id: "admin-1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const origin = "https://plan.test";

const MULE = { name: "Mule", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.5 oz lime juice", "Top with ginger beer"], garnish: "lime wheel" };
const MARG = { name: "Margarita", base_spirit: "tequila", ingredients: ["2 oz tequila", "1 oz lime juice", "0.75 oz agave"], garnish: "lime wheel" };

function eventData(date: string, extra: Record<string, unknown> = {}) {
  return {
    client_name: "Alex Butler",
    email: "alex@example.com",
    event_type: "Birthday",
    event_date: date,
    bar_service_start: "6:00pm",
    bar_service_end: "10:00pm",
    hours_booked: 4,
    guest_count: 100,
    package: "Full Bar",
    event_address: "123 Elm St, Dallas, TX 75201",
    parking_info: "Driveway",
    special_requests: "",
    signature_drinks: [MULE, MARG],
    ...extra,
  };
}

function reset(opts: { date?: string; extra?: Record<string, unknown>; autoSend?: boolean } = {}) {
  for (const k of Object.keys(db)) delete db[k];
  const date = opts.date ?? FAR;
  const ed = eventData(date, opts.extra);
  db.sessions = [
    {
      id: "s1",
      name: "Alex Butler",
      email: "alex@example.com",
      event_date: date,
      package_type: "Full Bar",
      guest_count: "100",
      hours_booked: "4",
      status: "submitted",
      event_data: ed,
      version: 1,
      submitted_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      booked_price: null,
      team_market: "dallas",
    },
  ];
  db.event_updates = [{ id: "u1", session_id: "s1", version: 1, source: "concierge", changes: diff.snapshotChanges(ed), summary: "Initial submission", applied: true, created_at: "2026-10-01T00:00:00Z" }];
  db.staff = [admin];
  db.team_settings = [{ key: cldb.AUTO_SEND_KEY, value: opts.autoSend ?? true }];
  hooks.length = 0;
}

const session = () => db.sessions[0] as Record<string, unknown> & { event_data: Record<string, unknown>; version: number };
const updateHooks = () => hooks.filter((h) => h.url === "https://hooks.test/update").map((h) => h.body);
const lastHook = () => updateHooks().at(-1);
const logRows = () => (db.client_list_log ?? []) as Record<string, unknown>[];
const holds = () => (db.client_list_holds ?? []) as Record<string, unknown>[];

/** A client update the way the chat route saves and delivers it. */
async function clientUpdate(partial: Record<string, unknown>) {
  const r = await updates.applyEventUpdate("s1", partial, {});
  if (r && r.rows.length > 0) await delivery.deliverEventUpdates("s1", r.rows, { staffOrigin: origin });
  return r;
}

// ----- The client list itself -----
reset();
const ed0 = session().event_data;
const email = lists.generateClientShoppingListEmail(lists.generateShoppingList(ed0 as never), ed0 as never, "");
const list0 = cl.clientList(ed0);
check("The client list is read from the existing client email, line for line", list0.sections.flatMap((s) => s.lines).every((l) => email.includes(`- ${l}`)) && email.split("\n").filter((l) => l.startsWith("- ")).length === list0.sections.flatMap((s) => s.lines).length);
check("Full Bar: the client buys the alcohol only", list0.sections.map((s) => s.title).join(",") === "LIQUOR");
const tailored = cl.clientList(eventData(FAR, { package: "Tailored Bar" }));
check("Tailored Bar: the client buys everything", ["LIQUOR", "MIXERS AND JUICES", "ICE & BAR SUPPLIES"].every((t) => tailored.sections.some((s) => s.title === t)));
check("Beer and Wine: nothing for the client to buy", cl.listIsEmpty(cl.clientList(eventData(FAR, { package: "Beer and Wine", signature_drinks: [] }))));

// ----- First send on completion -----
reset();
const first = await cldb.completionFields("s1");
check("Completion: the first list is sent", first.client_shopping_list_send === true && first.client_shopping_list_reason === "first", JSON.stringify(first));
check("Completion: changes is empty on the first list", first.client_shopping_list_changes === "");
check("Completion: the link goes to the list on the client's event page", first.client_shopping_list_url === "https://plan.test/s?id=s1#shopping-list");
check("Completion: the list goes as plain text", first.client_shopping_list_text === cl.clientListText(list0) && first.client_shopping_list_text.startsWith("LIQUOR\n- "));
check("Completion: order_sheet_url is the admin order sheet", first.order_sheet_url === "https://plan.test/team/admin/e/s1/order");
check("Completion: list_change_declined is false", first.list_change_declined === false);
check("Completion: the send is logged", logRows().some((l) => l.action === "sent" && l.reason === "first" && l.dry_run === false));
const again = await cldb.completionFields("s1");
check("Completion again (a repeat of the intake webhook): the first list never goes out twice", again.client_shopping_list_send === false && logRows().filter((l) => l.reason === "first").length === 1);
check("The client's event page shows the list once it is out", await cldb.clientCanSeeList("s1"));

reset({ date: NEAR });
const nearFirst = await cldb.completionFields("s1");
check("Completion inside 6 days: the first list still goes out", nearFirst.client_shopping_list_send === true && nearFirst.client_shopping_list_reason === "first");

// ----- Updates more than six days out -----
reset();
await cldb.completionFields("s1");
await clientUpdate({ guest_count: 150 });
const upd = lastHook();
check("Update that changes the list: the updated list is sent", upd?.client_shopping_list_send === true && upd?.client_shopping_list_reason === "updated", JSON.stringify(upd && { s: upd.client_shopping_list_send, r: upd.client_shopping_list_reason }));
check("Update that changes the list: the changes are summarized", typeof upd?.client_shopping_list_changes === "string" && /: now .+, was /.test(String(upd?.client_shopping_list_changes)), String(upd?.client_shopping_list_changes));
check("Update payload: the list text is the current list", upd?.client_shopping_list_text === cl.clientListText(cl.clientList(session().event_data)));
check("Update payload: order_sheet_url is sent", upd?.order_sheet_url === "https://plan.test/team/admin/e/s1/order");
check("Update payload: list_change_declined is false", upd?.list_change_declined === false);
await clientUpdate({ parking_info: "Street parking only" });
const quiet = lastHook();
check("Update that does not change the list: nothing is sent", quiet?.client_shopping_list_send === false && quiet?.client_shopping_list_reason === "" && quiet?.client_shopping_list_changes === "");
check("Every update sends the real version: the next list change compares to the last list sent", (() => {
  const st = (db.client_list_state as Record<string, unknown>[])[0];
  return cl.sameList(st.last_list as never, cl.clientList(session().event_data));
})());
await clientUpdate({ guest_count: 150 });
check("Saying the same thing again is not a change", updateHooks().length === 2);

// Retrying a delivery reuses the decision.
const sendsBefore = logRows().filter((l) => l.action === "sent").length;
const sentRow = (db.event_updates as Record<string, unknown>[]).find((r) => r.version === 2)!;
hooks.length = 0;
await delivery.deliverEventUpdates("s1", [sentRow as never]);
check("A manual retry resends the same decision and logs nothing new", lastHook()?.client_shopping_list_send === true && logRows().filter((l) => l.action === "sent").length === sendsBefore);

// ----- The lock at six days -----
reset();
await cldb.completionFields("s1");
const sentAtFirst = logRows().filter((l) => l.action === "sent").length;
// Days pass: the event is now three days out.
session().event_date = NEAR;
session().event_data = { ...session().event_data, event_date: NEAR };
await clientUpdate({ parking_info: "Gate code 1234" });
check("At the lock nothing is sent by itself, and an update that does not touch the list sends nothing", lastHook()?.client_shopping_list_send === false && logRows().filter((l) => l.action === "sent").length === sentAtFirst);
check("The lock uses the same cutoff as drink changes, in the market's time zone", src("lib/event-updates.ts").includes("eventTimeZone(session)") && diff.computeDeadlines(NEAR, new Date(), "America/Los_Angeles").withinSixDays);

// ----- Hold, approve, decline inside six days -----
reset({ date: NEAR });
await cldb.completionFields("s1");
const drinkTry = await clientUpdate({ signature_drinks: [{ ...MULE, name: "Big Mule" }, MARG] });
check("Inside 6 days a drink change becomes a request, not saved", !!drinkTry?.held && drinkTry.rows.length === 0 && session().version === 1);
const changeHold = (pred: (p: Record<string, unknown>) => boolean) => holds().find((h) => h.kind === "change" && pred(h.partial as Record<string, unknown>))!;
const parking = await clientUpdate({ parking_info: "Valet" });
check("Inside 6 days an update that does not touch the list applies as today", parking?.held === null && session().event_data.parking_info === "Valet" && session().version === 2);
const held = await clientUpdate({ guest_count: 150 });
check("Inside 6 days a guest count change is held, not saved", !!held?.held && held.rows.length === 0 && session().event_data.guest_count === 100 && session().version === 2);
const guestHold = changeHold((p) => p.guest_count === 150);
check("The held change is waiting for an admin", holds().length === 2 && guestHold?.status === "pending");
check("The hold is logged", logRows().some((l) => l.action === "held" && l.hold_id === guestHold.id));
const hoursHeld = await clientUpdate({ bar_service_end: "11:00pm" });
check("Inside 6 days an hours change that leaves the list the same (100 guests, 4 to 5 hours) applies as today", hoursHeld?.held === null && session().event_data.bar_service_end === "11:00pm");
const extraHeld = await clientUpdate({ extra_bottles: "Fireball" });
check("Inside 6 days an extra bottle is held too", !!extraHeld?.held && !session().event_data.extra_bottles);
const quote = await updates.quoteEventUpdate("s1", { guest_count: 150 });
check("The bot's quote says the change will be held", quote?.listHold === true);
const chatSrc = src("app/api/chat/route.ts");
check("The bot tells the client the change is sent for approval, not saved", chatSrc.includes("SENT TO OUR TEAM FOR APPROVAL") && chatSrc.includes("CHANGE_REQUEST_MESSAGE"));

hooks.length = 0;
const approve = await actions.approveHold(admin, "s1", guestHold.id, origin);
check("Approve saves the change", approve.ok && session().event_data.guest_count === 150, JSON.stringify(approve));
const ap = lastHook();
check("Approve sends the list with reason approved", ap?.client_shopping_list_send === true && ap?.client_shopping_list_reason === "approved", JSON.stringify(ap && { s: ap.client_shopping_list_send, r: ap.client_shopping_list_reason }));
check("Approve is logged with who approved it", logRows().some((l) => l.action === "approved" && l.reason === "approved" && l.by_name === "Kenneth"));
check("An approved hold cannot be approved twice", !(await actions.approveHold(admin, "s1", guestHold.id, origin)).ok);

const versionBefore = session().version;
const bottlesBefore = session().event_data.extra_bottles;
hooks.length = 0;
const bottleHold = changeHold((p) => p.extra_bottles === "Fireball");
const decline = await actions.declineHold(admin, "s1", bottleHold.id);
check("Decline leaves the event unchanged", decline.ok && session().version === versionBefore && session().event_data.extra_bottles === bottlesBefore && bottleHold.status === "declined");
const dc = lastHook();
check("Decline sends list_change_declined true and no list", dc?.list_change_declined === true && dc?.client_shopping_list_send === false && dc?.event_updated === false);
check("Decline is logged with who declined it", logRows().some((l) => l.action === "declined" && l.by_name === "Kenneth"));

// ----- Custom recipe -----
reset({ extra: { signature_drinks: [{ ...MULE, is_custom: true }, MARG] } });
const custom = await cldb.completionFields("s1");
check("Custom recipe: the first list is held, not sent", custom.client_shopping_list_send === false && holds().some((h) => h.kind === "custom_recipe" && h.status === "pending"));
check("Custom recipe: the client's page does not show the list yet", !(await cldb.clientCanSeeList("s1")));
await clientUpdate({ guest_count: 150 });
check("Custom recipe: an update before review sends nothing", lastHook()?.client_shopping_list_send === false);
hooks.length = 0;
const review = await actions.reviewAndSend(admin, "s1", holds().find((h) => h.kind === "custom_recipe")!.id);
check("Review and send sends the first list", review.ok && lastHook()?.client_shopping_list_send === true && lastHook()?.client_shopping_list_reason === "first");
check("Review and send is logged with who sent it", logRows().some((l) => l.action === "approved" && l.reason === "first" && l.by_name === "Kenneth"));
check("After review the client's page shows the list", await cldb.clientCanSeeList("s1"));
await clientUpdate({ guest_count: 175 });
check("After review list changes send as usual", lastHook()?.client_shopping_list_reason === "updated");

// ----- Admin edits -----
reset();
await cldb.completionFields("s1");
const pv = await editDb.previewAdminEdit("s1", { guest_count: "150" });
check("Admin edit preview says the list changes", pv.ok && pv.preview.listChanges.length > 0);
const pvParking = await editDb.previewAdminEdit("s1", { parking_info: "Back lot" });
check("Admin edit preview of a field off the list says nothing changes", pvParking.ok && pvParking.preview.listChanges === "");
await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { guest_count: "150" }, price: { mode: "keep" }, expectedVersion: 1, origin });
check("Admin edit with the box on (the default): the updated list is sent", lastHook()?.client_shopping_list_send === true && lastHook()?.client_shopping_list_reason === "updated");
await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { guest_count: "200" }, price: { mode: "keep" }, expectedVersion: 2, origin, sendList: false });
check("Admin edit with the box unchecked: nothing is sent", lastHook()?.client_shopping_list_send === false && logRows().some((l) => l.action === "not_sent" && String(l.detail).includes("unchecked")));
const editPage = src("app/team/admin/e/[id]/edit-event.tsx");
check("The admin edit form shows Send updated list to client, on by default", editPage.includes("Send updated list to client") && editPage.includes("useState(true)"));
reset({ date: NEAR });
await cldb.completionFields("s1");
const nearEdit = await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { guest_count: "150" }, price: { mode: "keep" }, expectedVersion: 1, origin });
check("Admin edits inside 6 days are never held", nearEdit.ok && session().event_data.guest_count === 150 && holds().length === 0);

// ----- Master switch off -----
reset({ autoSend: false, date: NEAR, extra: { signature_drinks: [{ ...MULE, is_custom: true }, MARG] } });
const off = await cldb.completionFields("s1");
check("Switch off: completion sends nothing", off.client_shopping_list_send === false && off.client_shopping_list_reason === "");
check("Switch off: no custom recipe hold is created", holds().length === 0);
check("Switch off: the decision is still logged for admins, as a dry run", logRows().length > 0 && logRows().every((l) => l.dry_run === true));
const offUpdate = await clientUpdate({ guest_count: 150 });
check("Switch off: a list change inside 6 days applies as today, nothing held", offUpdate?.held === null && session().event_data.guest_count === 150 && holds().length === 0);
await editDb.saveAdminEdit({ sessionId: "s1", admin, changes: { guest_count: "175" }, price: { mode: "keep" }, expectedVersion: session().version, origin });
check("Switch off: every payload has client_shopping_list_send false", updateHooks().length >= 2 && updateHooks().every((h) => h.client_shopping_list_send === false));
check("Switch off: the client's event page does not show the list", !(await cldb.clientCanSeeList("s1")));
check("Switch off: the quote does not say it will be held", (await updates.quoteEventUpdate("s1", { guest_count: 200 }))?.listHold === false);

// ----- Wiring -----
const hookSrc = src("app/api/webhook/route.ts");
check("The intake webhook adds the list fields from the saved session", hookSrc.includes("completionFields(sessionId)") && hookSrc.includes("client_shopping_list_send: false"));
check("The chat route passes the session to the intake webhook", /fetch\(`\$\{origin\}\/api\/webhook`[\s\S]{0,200}sessionId,/.test(chatSrc));
const clRoute = src("app/api/team/admin/client-list/route.ts");
check("Approve, Decline, and Review and send are admin only", clRoute.includes('staff.role !== "admin"') && clRoute.includes("status: 403") && clRoute.includes("status: 401"));
const adminPage = src("app/team/admin/e/[id]/page.tsx");
check("The admin event page shows the list panel with its log", adminPage.includes("<ClientListPanel") && adminPage.includes("listLog(id)"));
check("The settings route is admin only", src("app/api/team/admin/settings/route.ts").includes('staff.role !== "admin"'));

done("client list");
