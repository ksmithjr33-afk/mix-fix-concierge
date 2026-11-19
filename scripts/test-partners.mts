// Partner portal, phase 1: planners. Partner login apart from staff in both
// directions, planners seeing only their linked events, several planners with
// one Lead, switching planners, who sees money and who approves a price
// change, hosts, the three ways of linking, the one tap remove link,
// deactivation, a planner finishing the planning chat, the planner title rule,
// and existing events unchanged. Then the follow up: the planner as the billed
// party (A), surprise events (B), simultaneous chat saves (C), and existing
// events unchanged before the surprise migration.
// Run: node --no-warnings scripts/test-partners.mts

import { registerHooks } from "node:module";
import { addDays, check, done, hooks, src, texts } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@anthropic-ai/sdk") return nextResolve(new URL("./fake-anthropic.mts", import.meta.url).href, context);
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db, missingTables } = await import("./fake-supabase.mts");
const { stubCookies, RedirectError } = await import("./stub-next.mts");
const ai = await import("./fake-anthropic.mts");
const rules = await import("../lib/partners/rules.ts");
const pauth = await import("../lib/partners/auth.ts");
const pdb = await import("../lib/partners/db.ts");
const actions = await import("../lib/partners/actions.ts");
const approvals = await import("../lib/partners/approvals.ts");
const page = await import("../lib/partners/event-page.ts");
const planning = await import("../lib/partners/planning.ts");
const pchat = await import("../lib/partners/chat.ts");
const clientView = await import("../lib/partners/client-view.ts");
const ptexts = await import("../lib/partners/texts.ts");
const staffAuth = await import("../lib/team/auth.ts");
const list = await import("../lib/team/event-list.ts");
const markets = await import("../lib/team/markets.ts");
const time = await import("../lib/team/time.ts");
const prompt = await import("../lib/system-prompt.ts");
const partnerChatRoute = await import("../app/api/partners/chat/route.ts");
const clientChat = await import("../app/api/chat/route.ts");

const today = time.chicagoToday();
const DAY = addDays(today, 30);
const PAST = addDays(today, -20);
const ADMIN = { id: "admin-1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true };
const MANAGER = { id: "mgr-1", name: "Kenny Smith", phone: "+12145550102", role: "manager", active: true };
const BARTENDER = { id: "bt-1", name: "Taylor Brooks", phone: "+12145550103", role: "bartender", active: true };
const CLIENT_PHONE = "+19725550199";
const PLANNER_PHONE = "+14695550111";
const PLANNER2_PHONE = "+14695550122";
const PLANNER3_PHONE = "+14695550133";
const HOST_PHONE = "+12145550144";
const BOOKED = { total: 2400, package_price: 2100, gratuity: 300, bartenders: 2, promo_code: null, custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: 150, source: "create-session" };
const hyphenFree = (s: string) => !/[-‐-―]/.test(s);

function session(id: string, top: Record<string, unknown> = {}, ed: Record<string, unknown> = {}) {
  const day = (top.event_date as string) ?? DAY;
  return {
    id,
    name: "Justin Reyes",
    email: "justin@example.com",
    phone: CLIENT_PHONE,
    status: "submitted",
    version: 1,
    event_date: day,
    package_type: "Full Bar",
    guest_count: "80",
    hours_booked: "4",
    booked_price: BOOKED,
    submitted_at: new Date().toISOString(),
    team_market: "dallas",
    event_data: {
      client_name: "Justin Reyes",
      email: "justin@example.com",
      client_phone: CLIENT_PHONE,
      event_type: "Wedding",
      event_date: day,
      bar_service_start: "6:00 PM",
      bar_service_end: "10:00 PM",
      event_address: "100 Main St, Dallas, TX 75201",
      guest_count: 80,
      package: "Full Bar",
      bartenders: 2,
      payment_preference: "Auto charge on due date",
      day_of_contact_name: "Sam Reyes",
      day_of_contact_phone: "2145550177",
      parking_info: "Lot B",
      signature_drinks: [{ name: "Spicy Paloma", ingredients: ["2 oz tequila", "Top with grapefruit soda"] }],
      ...ed,
    },
    ...top,
  } as Record<string, unknown>;
}

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  for (const t of [...missingTables]) missingTables.delete(t);
  db.staff = [ADMIN, MANAGER, BARTENDER];
  db.event_updates = [];
  texts.length = 0;
  hooks.length = 0;
  stubCookies.clear();
}

const S = (id: string) => (db.sessions ?? []).find((s) => s.id === id) as Record<string, unknown> & pdb_EventSession;
type pdb_EventSession = import("../lib/partners/db.ts").EventSession;
const fresh = async (id: string) => (await import("../lib/event-updates.ts")).getSession(id) as Promise<pdb_EventSession>;

/** A text to this phone, sent now or held for quiet hours (tests run at any hour). */
function textTo(phone: string, has: RegExp | string): string | null {
  const all = [...texts.filter((t) => t.phone === phone).map((t) => t.message), ...((db.partner_texts ?? []) as { phone: string; message: string }[]).filter((t) => t.phone === phone).map((t) => t.message)];
  return all.find((m) => (typeof has === "string" ? m.includes(has) : has.test(m))) ?? null;
}
const allPartnerTexts = () => [...texts.map((t) => t.message), ...((db.partner_texts ?? []) as { message: string }[]).map((t) => t.message)];

async function signInPartner(phone: string): Promise<string> {
  texts.length = 0;
  await pauth.requestPartnerCode(phone);
  const code = texts.find((t) => t.phone === phone)?.message.match(/\b(\d{6})\b/)?.[1] ?? "";
  const r = await pauth.verifyPartnerCode(phone, code);
  return r.ok ? r.token : "";
}

async function asPartner<T>(token: string, fn: () => Promise<T>): Promise<T> {
  stubCookies.clear();
  stubCookies.set(rules.PARTNER_COOKIE, token);
  try {
    return await fn();
  } finally {
    stubCookies.clear();
  }
}

const staffActor = (s: typeof ADMIN) => ({ kind: "staff" as const, name: s.name });

// =====================================================================
// 1. Partner login is separate from staff, in both directions
// =====================================================================
reset();
db.sessions = [session("e1")];
const made = await pdb.findOrCreatePlanner({ name: "Pat Planner", company: "Bloom Events", phone: "469 555 0111" }, "Isabel Jones");
check("A planner account is made with the phone as the login, active, type planner", made.ok && made.partner.phone === PLANNER_PHONE && made.partner.active && made.partner.type === "planner");
const pat = made.ok ? made.partner : (null as never);

texts.length = 0;
await pauth.requestPartnerCode(PLANNER_PHONE);
const codeText = texts.find((t) => t.phone === PLANNER_PHONE)?.message ?? "";
check("A planner gets a partner code by text", /Your Mix Fix partner code is \d{6}\. It expires in 10 minutes\./.test(codeText) && hyphenFree(codeText));
check("Partner codes live in their own table, never the staff code table", (db.partner_login_codes ?? []).length === 1 && (db.staff_login_codes ?? []).length === 0);

texts.length = 0;
await pauth.requestPartnerCode(ADMIN.phone);
check("A staff phone gets no partner code", texts.length === 0 && (db.partner_login_codes ?? []).length === 1);

for (let i = 0; i < 6; i++) await pauth.requestPartnerCode(PLANNER_PHONE);
check("The staff hourly code limit applies: at most 5 partner codes an hour", (db.partner_login_codes ?? []).filter((c) => c.phone === PLANNER_PHONE).length === 5);
db.partner_login_codes = [];

const patToken = await signInPartner(PLANNER_PHONE);
check("The right code signs the planner in", patToken.length > 20 && (db.partner_sessions ?? []).length === 1 && (db.staff_sessions ?? []).length === 0);
check("Signing in records the last sign in", !!(db.partners.find((p) => p.id === pat.id) as { last_sign_in_at?: string }).last_sign_in_at);

const principal = await asPartner(patToken, () => pauth.getCurrentPrincipal());
check("The partner cookie opens the partner side", principal?.kind === "partner" && principal.partner.id === pat.id);

stubCookies.clear();
stubCookies.set("mf_team", patToken);
check("A partner token in the staff cookie is not a staff session", (await staffAuth.getCurrentStaff()) === null);
let redirected = "";
try {
  await staffAuth.requireStaff("/team/events");
} catch (e) {
  redirected = e instanceof RedirectError ? e.to : "";
}
check("...so every /team page sends them to the staff sign in", redirected.startsWith("/team?next="));
stubCookies.clear();
stubCookies.set(rules.PARTNER_COOKIE, patToken);
check("A partner signed in on the partner side is still not staff", (await staffAuth.getCurrentStaff()) === null);
stubCookies.clear();

texts.length = 0;
await staffAuth.requestLoginCode(ADMIN.phone);
const staffCode = texts.find((t) => t.phone === ADMIN.phone)?.message.match(/\b(\d{6})\b/)?.[1] ?? "";
const staffLogin = await staffAuth.verifyLoginCode(ADMIN.phone, staffCode);
const staffToken = staffLogin.ok ? staffLogin.token : "";
stubCookies.set("mf_team", staffToken);
check("A staff session works on the team side", (await staffAuth.getCurrentStaff())?.id === ADMIN.id);
check("...and never opens /partners", (await pauth.getCurrentPrincipal()) === null);
stubCookies.clear();
stubCookies.set(rules.PARTNER_COOKIE, staffToken);
check("A staff token in the partner cookie opens nothing", (await pauth.getCurrentPrincipal()) === null);
stubCookies.clear();
check("The partner pages read only the partner cookie and never import staff sign in", !src("app/partners/page.tsx").includes("@/lib/team/auth") && !src("app/partners/e/[key]/page.tsx").includes("@/lib/team/auth") && src("lib/partners/auth.ts").includes("PARTNER_COOKIE"));
check("Partner cookie and staff cookie have different names", rules.PARTNER_COOKIE !== "mf_team");

// Profile: name, company, email, website, never the phone.
const prof = await pdb.updateOwnProfile(pat.id, { name: "Pat Planner", company: "Bloom Events Co", email: "PAT@bloom.test", website: "bloom.test", phone: "+15555550000" } as never);
const patRow = db.partners.find((p) => p.id === pat.id) as Record<string, unknown>;
check("A partner edits their own name, company, email and website", prof.ok && patRow.company === "Bloom Events Co" && patRow.email === "pat@bloom.test" && patRow.website === "https://bloom.test");
check("...but never their phone, which is their login", patRow.phone === PLANNER_PHONE);
await pdb.updateOwnProfile(pat.id, { name: "Pat Planner", company: "Bloom Events", email: "pat@bloom.test", website: "bloom.test" });

// =====================================================================
// 2. A planner sees only the events they are linked to
// =====================================================================
db.sessions.push(session("e2", {}, { client_name: "Maria Lopez", client_phone: "+19725550188" }));
db.sessions.push(session("e3", { event_date: PAST }, { client_name: "Ann Old", event_date: PAST }));
const l1 = await pdb.linkPlanner(S("e1"), pat, { via: "staff", by: staffActor(ADMIN) });
await pdb.linkPlanner(S("e3"), pat, { via: "staff", by: staffActor(ADMIN) });
const rows = await page.dashboardRows(principal!);
check("The dashboard lists only linked events", l1.ok && rows.length === 2 && !rows.some((r) => r.eventFor.includes("Maria")));
check("Upcoming first, then past", rows[0].eventFor === "Justin Reyes" && !rows[0].past && rows[1].past);
check("Each row: who it is for, type, date, city, package, booking, and a plain status", rows[0].eventType === "Wedding" && rows[0].city === "Dallas" && rows[0].package === "Full Bar" && rows[0].holdsBooking === false && rows[0].status === "Planned");
await pdb.ensurePartnerKey(S("e2"));
const e2Key = S("e2").partner_key as string;
check("An event they are not linked to is not found, even with its key", (await pdb.eventAccess(principal, e2Key)) === null);
check("Partner links never use the client's link id", (S("e1").partner_key as string) !== "e1" && !/e1$/.test(pdb.partnerEventHref(S("e1").partner_key as string)));
check("Statuses in plain words", rules.planningStatus({ status: "in_progress", hasAnswers: false, menuApproved: false }) === "Not started" && rules.planningStatus({ status: "in_progress", hasAnswers: true, menuApproved: false }) === "In progress" && rules.planningStatus({ status: "submitted", hasAnswers: true, menuApproved: true }) === "Menu approved");

// What the event page holds, and never holds.
db.event_assignments = [
  { id: "a1", session_id: "e1", staff_id: BARTENDER.id, status: "accepted" },
  { id: "a2", session_id: "e1", staff_id: MANAGER.id, status: "offered" },
];
db.staff_pay = [{ session_id: "e1", staff_id: BARTENDER.id, cents: 18750 }];
const acc1 = (await pdb.eventAccess(principal, S("e1").partner_key as string))!;
const view1 = await page.partnerEventView(acc1);
const viewText = JSON.stringify(view1);
check("The event page has the client and contact, times, venue, package, guests, drinks and deadlines", view1.eventFor.name === "Justin Reyes" && view1.eventFor.phone === CLIENT_PHONE && view1.serviceTimes === "6:00 PM to 10:00 PM" && view1.arrival === "3:00 PM" && view1.breakdown === "11:00 PM" && view1.package === "Full Bar" && view1.guestCount === "80" && view1.drinks.length === 1 && !!view1.deadlines.lastDrinkChange && view1.packageLine.startsWith("Three specialty cocktails") && view1.packageBullets.length > 0 && view1.packageProvides === "The client provides the alcohol.");
check("Accepted bartenders by first name only, never phones or last names", view1.bartenders.join() === "Taylor" && !viewText.includes("Brooks") && !viewText.includes(BARTENDER.phone) && !viewText.includes("Kenny"));
check("A client held event shows a planner no money at all", view1.pricing === null && !viewText.includes("2,400") && !viewText.includes("2400") && !view1.money.approve);
check("Never staff pay, notes, the team chat, the Scorecard or receipts", !/187\.50|18750|internal_notes|scorecard|receipt|chat_messages/i.test(viewText));
check("The partner pages never read staff only data", ["lib/partners/event-page.ts", "app/partners/e/[key]/page.tsx"].every((p) => !/staff_pay|pay-db|scorecard|receipts-db|chat-db|internal_notes/.test(src(p))));

// =====================================================================
// 3. Several planners on one event, one Lead
// =====================================================================
const sam = (await pdb.findOrCreatePlanner({ name: "Sam Second", company: "", phone: PLANNER2_PHONE }, "Isabel Jones")) as { ok: true; partner: import("../lib/partners/rules.ts").Partner };
const lee = (await pdb.findOrCreatePlanner({ name: "Lee Third", company: "Third Co", phone: PLANNER3_PHONE }, "Isabel Jones")) as { ok: true; partner: import("../lib/partners/rules.ts").Partner };
db.sessions.push(session("p1", { booking_holder: "planner", host_name: "Jordan Lee", phone: PLANNER_PHONE }, { client_name: "Pat Planner", client_phone: PLANNER_PHONE }));
await pdb.linkPlanner(S("p1"), pat, { via: "booked", by: { kind: "planner", name: "Pat Planner", partnerId: pat.id }, lead: true });
await pdb.linkPlanner(S("p1"), sam.partner, { via: "lead", by: { kind: "planner", name: "Pat Planner", partnerId: pat.id } });
await pdb.linkPlanner(S("p1"), lee.partner, { via: "staff", by: staffActor(MANAGER) });
let on = await pdb.plannersOn("p1");
check("Several planners on one event, exactly one Lead", on.length === 3 && on.filter((p) => p.isLead).length === 1 && on.find((p) => p.isLead)?.partner.id === pat.id);
const samToken = await signInPartner(PLANNER2_PHONE);
const samPrincipal = await asPartner(samToken, () => pauth.getCurrentPrincipal());
const samAcc = (await pdb.eventAccess(samPrincipal, S("p1").partner_key as string))!;
check("Each planner has their own login and is logged under their own name", samAcc.actor.name === "Sam Second" && samAcc.actor.partnerId === sam.partner.id && (db.partner_activity ?? []).some((a) => a.session_id === "p1" && a.actor_name === "Pat Planner" && a.action === "Planner added" && String(a.detail).includes("Sam")));
check("The Lead's company is the event's label", S("p1").planner_label === "Bloom Events");
const leadSwap = await actions.leadRemovePlanner(samAcc, pat.id);
check("A planner who is not the Lead cannot remove the Lead (or anyone)", !leadSwap.ok);
const patAccP1 = (await pdb.eventAccess(principal, S("p1").partner_key as string))!;
check("Even the Lead cannot remove themselves as Lead: only an admin or manager changes the Lead", !(await actions.leadRemovePlanner(patAccP1, pat.id)).ok);
await actions.staffBookingAction(MANAGER as never, S("p1"), { action: "lead", partnerId: lee.partner.id });
on = await pdb.plannersOn("p1");
check("A manager changes the Lead, and there is still exactly one", on.filter((p) => p.isLead).length === 1 && on.find((p) => p.isLead)?.partner.id === lee.partner.id && S("p1").planner_label === "Third Co");
await actions.staffBookingAction(ADMIN as never, S("p1"), { action: "lead", partnerId: pat.id });

// =====================================================================
// 4. Switching planners: the old one loses access at once, the new one never sees their name
// =====================================================================
db.conversation_logs = [
  {
    id: "c1",
    session_id: "e1",
    messages: [
      { role: "user", content: "CONTEXT - Pre-filled from booking system: x" },
      { role: "user", content: "We want a taco bar vibe", by: { kind: "planner", name: "Pat Planner", partnerId: pat.id } },
      { role: "assistant", content: "Love it" },
    ],
  },
];
texts.length = 0;
const replace = await actions.staffBookingAction(ADMIN as never, S("e1"), { action: "replace", partnerId: pat.id, name: "Lee Third", phone: PLANNER3_PHONE });
check("Replace removes the old planner and links the new one", replace.ok && (await pdb.plannersOn("e1")).map((p) => p.partner.id).join() === lee.partner.id);
check("The old planner loses access at once, on the server", (await pdb.eventAccess(principal, S("e1").partner_key as string)) === null && !(await page.dashboardRows(principal!)).some((r) => r.key === S("e1").partner_key));
const leeToken = await signInPartner(PLANNER3_PHONE);
const leePrincipal = await asPartner(leeToken, () => pauth.getCurrentPrincipal());
const leeAcc = (await pdb.eventAccess(leePrincipal, S("e1").partner_key as string))!;
const leeView = await page.partnerEventView(leeAcc);
check("The new planner sees everything already planned", leeView.drinks.length === 1 && leeView.dayOfContact.name === "Sam Reyes");
check("...but never the removed planner's name", !JSON.stringify(leeView).includes("Pat") && leeView.planners.map((p) => p.name).join() === "Lee Third");
const shown = page.visibleMessages(await page.intakeMessages("e1"), leeView.money, lee.partner.id, new Map([[lee.partner.id, "Lee Third"]]));
check("...not even on the planning chat answers they gave", shown.some((m) => m.byName === "A planner") && !JSON.stringify(shown).includes("Pat"));
const adminCard = await clientView.bookingCardData(S("e1"), "admin");
check("The removed planner's history stays in the activity log for admins and managers", adminCard.ready && adminCard.activity.some((a) => a.what.includes("Planner removed") && a.what.includes("Pat Planner")) && adminCard.activity.some((a) => a.what.includes("Planner added") && a.what.includes("Pat Planner")));

// Removing the Lead alerts admins when others remain.
texts.length = 0;
await pdb.removePlanner(S("p1"), pat.id, staffActor(ADMIN));
check("Removing the Lead with others left alerts admins and managers to pick a new Lead", texts.some((t) => t.phone === ADMIN.phone && t.message.includes("Pick a new Lead")) && texts.some((t) => t.phone === MANAGER.phone && t.message.includes("Pick a new Lead")));
check("...and the event has no Lead until one is picked", !(await pdb.plannersOn("p1")).some((p) => p.isLead));
check("The booking contact's old event link stops working when that planner is removed", await clientView.clientLinkBlocked(S("p1")));
const blocked = await clientChat.POST(new Request("http://plan.test/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], sessionId: "p1" }) }));
check("...on the server too: the chat refuses it", blocked.status === 403);
await pdb.linkPlanner(S("p1"), pat, { via: "staff", by: staffActor(ADMIN), lead: true });
check("Linking them again as Lead brings the link back", !(await clientView.clientLinkBlocked(S("p1"))) && (await pdb.plannersOn("p1")).find((p) => p.isLead)?.partner.id === pat.id);

// =====================================================================
// 5. Planner held: the Lead sees money and approves a price change
// =====================================================================
const patAcc = (await pdb.eventAccess(principal, S("p1").partner_key as string))!;
const patView = await page.partnerEventView(patAcc);
check("The Lead on a planner held event holds the booking and sees the total, balance and payments", patView.holdsBooking && patView.pricing?.total === "$2,400" && patView.pricing?.balance === "$2,250" && patView.money.agreement && patView.money.approve);
const samAcc2 = (await pdb.eventAccess(samPrincipal, S("p1").partner_key as string))!;
const samView = await page.partnerEventView(samAcc2);
check("Other planners see no money by default", samView.pricing === null && !samView.money.approve);
await actions.leadSetSwitch(patAcc, "others_can_see_pricing", true);
const samView2 = await page.partnerEventView((await pdb.eventAccess(samPrincipal, S("p1").partner_key as string))!);
check("...until the Lead turns on Other planners can see pricing, and they still cannot approve", samView2.pricing?.total === "$2,400" && !samView2.money.approve);
check("Only the Lead flips that switch", !(await actions.leadSetSwitch(samAcc2, "others_can_see_pricing", false)).ok);
await actions.leadSetSwitch(patAcc, "others_can_see_pricing", false);

texts.length = 0;
db.partner_texts = [];
const ask = await approvals.askForApproval(S("p1"), { guest_count: 150 }, samAcc2.actor);
check("A priced change from another planner goes to the Lead to approve", ask.kind === "sent" && ask.holderFirstName === "Pat" && !!textTo(PLANNER_PHONE, "affects the price"));
check("...and nothing is applied yet", (S("p1").event_data as Record<string, unknown>).guest_count === 80);
const approvalRow = (db.price_approvals ?? []).find((a) => a.session_id === "p1") as { id: string };
check("Another planner cannot approve it", !(await actions.leadDecide(samAcc2, approvalRow.id, true)).ok && (S("p1").event_data as Record<string, unknown>).guest_count === 80);
const yes = await actions.leadDecide(patAcc, approvalRow.id, true);
check("The Lead approves it and it is applied at the quoted total", yes.ok && (S("p1").event_data as Record<string, unknown>).guest_count === 150 && Number((S("p1").booked_price as { total: number }).total) > 2400);
check("The approval is logged under the Lead's name", (db.partner_activity ?? []).some((a) => a.session_id === "p1" && a.action === "Price change approved" && a.actor_name === "Pat Planner"));
check("A double tap never applies it twice", !(await actions.leadDecide(patAcc, approvalRow.id, true)).ok);

// =====================================================================
// 6. Client held: a planner cannot accept a price change; without a yes it does not apply
// =====================================================================
db.event_updates = [{ id: "u1", session_id: "e1", version: 1, source: "concierge", changes: [], summary: "Initial submission", within_deadline: true, applied: true, webhook_sent: true, created_at: new Date().toISOString() }];
texts.length = 0;
db.partner_texts = [];
ai.calls.length = 0;
ai.script.reply = (p) => (p.tool_choice?.type === "none" ? [{ type: "text", text: rules.sentForApprovalLine("Justin") }] : [ai.toolUse("quote_price_change", { guest_count: 160 })]);
stubCookies.set(rules.PARTNER_COOKIE, leeToken);
const res = await partnerChatRoute.POST(new Request("http://plan.test/api/partners/chat", { method: "POST", body: JSON.stringify({ key: S("e1").partner_key, text: "Make it 160 guests please" }) }));
const streamed = await res.text();
stubCookies.clear();
const sys = JSON.stringify(ai.calls[0]?.system ?? "");
check("Update mode knows it is a planner, by name, and is told never to state money", sys.includes("YOU ARE TALKING WITH A PLANNER: Lee Third is planning Justin's wedding") && sys.includes("MONEY: this planner does not hold the booking"));
check("The planner's prompt carries no booked total", !sys.includes("2,400") && !sys.includes("2400"));
const toolResult = JSON.stringify(ai.calls[1]?.messages ?? "");
check("The change is sent to the client to approve, with the exact line for the planner", toolResult.includes("We sent it to Justin to approve.") && streamed.includes("We sent it to Justin to approve."));
check("Nothing about the amount reaches the planner", !/\$\d/.test(streamed) && !/\$\d/.test(toolResult.replace(/\\"/g, "")));
check("Nothing is applied", (S("e1").event_data as Record<string, unknown>).guest_count === 80);
const clientAsk = textTo(CLIENT_PHONE, "affects the price");
check("The client gets the change and the new total, with an approve link", !!clientAsk && /\$\d/.test(clientAsk) && /\/approve\/[0-9a-f]{48}/.test(clientAsk));
check("The planner's own update chat is saved apart from the client's", ((db.partner_chats ?? []) as { partner_id: string; messages: { by?: { partnerId: string } }[] }[]).some((c) => c.partner_id === lee.partner.id && c.messages.some((m) => m.by?.partnerId === lee.partner.id)) && !((db.conversation_logs?.[0] as { update_messages?: unknown }).update_messages));
const ap = (db.price_approvals ?? []).find((a) => a.session_id === "e1") as { id: string };
check("A planner on a client held event can never accept it", !(await actions.leadDecide(leeAcc, ap.id, true)).ok);
const token = clientAsk?.match(/\/approve\/([0-9a-f]{48})/)?.[1] ?? "";
const no = await actions.clientDecideByToken(token, false);
check("The client says no: nothing applies", no.ok && (S("e1").event_data as Record<string, unknown>).guest_count === 80 && (db.price_approvals.find((a) => a.id === ap.id) as { status: string }).status === "declined");
// No answer: it expires and still does not apply.
await approvals.askForApproval(S("e1"), { guest_count: 170 }, leeAcc.actor);
const ap2 = db.price_approvals.find((a) => (a.changes as { guest_count?: number }).guest_count === 170) as { id: string; expires_at: string };
ap2.expires_at = new Date(Date.now() - 1000).toISOString();
const late = await approvals.decideApproval((await approvals.getApproval(ap2.id))!, true, { kind: "client", name: "Justin Reyes" });
check("No answer in time: it expires and is never applied, even with a late yes", !late.ok && (S("e1").event_data as Record<string, unknown>).guest_count === 80);
check("Approval and price texts have no hyphens in their wording", allPartnerTexts().every((m) => hyphenFree(m.replace(/https?:\/\/\S+/g, ""))) && allPartnerTexts().every((m) => hyphenFree(m)));

// =====================================================================
// 7. A host never sees prices by default
// =====================================================================
await pdb.setHost(S("p1"), { name: "Jordan Lee", phone: "214 555 0144" }, staffActor(ADMIN));
check("A host with a phone gets a welcome text with the sign in link", !!textTo(HOST_PHONE, "plan.test/partners"));
const hostToken = await signInPartner(HOST_PHONE);
const hostPrincipal = await asPartner(hostToken, () => pauth.getCurrentPrincipal());
check("The host signs in at /partners with a code", hostPrincipal?.kind === "host");
const hostAcc = (await pdb.eventAccess(hostPrincipal, S("p1").partner_key as string))!;
const hostView = await page.partnerEventView(hostAcc);
check("The host sees the event read only, with no prices, payments, balance or agreement", hostView.readOnly && hostView.pricing === null && !hostView.money.total && !hostView.money.agreement && !JSON.stringify(hostView).includes("$"));
check("A host only sees their own events", (await page.dashboardRows(hostPrincipal!)).length === 1 && (await pdb.eventAccess(hostPrincipal, S("e1").partner_key as string)) === null);
const hostChat = await asPartner(hostToken, () => partnerChatRoute.POST(new Request("http://plan.test/api/partners/chat", { method: "POST", body: JSON.stringify({ key: S("p1").partner_key, text: "hi" }) })));
check("A host can never chat or change anything", hostChat.status === 403);
check("Only the Lead can turn on Host can see pricing", !(await actions.leadSetSwitch(samAcc2, "host_can_see_pricing", true)).ok);
await actions.leadSetSwitch(patAcc, "host_can_see_pricing", true);
const hostView2 = await page.partnerEventView((await pdb.eventAccess(hostPrincipal, S("p1").partner_key as string))!);
check("...and then the host sees the total and nothing else", !!hostView2.pricing?.total && hostView2.pricing.balance === "" && hostView2.pricing.payments.length === 0 && hostView2.pricing.agreements.length === 0);
await actions.leadSetSwitch(patAcc, "host_can_see_pricing", false);
await pdb.setHost(S("p1"), { name: "Jordan Lee", phone: "" }, staffActor(ADMIN));
check("Taking the host's phone off ends their access", (await pdb.eventAccess(hostPrincipal, S("p1").partner_key as string)) === null);

// =====================================================================
// 8. The three ways of linking, and the client text on admin linking
// =====================================================================
reset();
db.sessions = [session("b1"), session("c1", {}, { client_name: "Maria Lopez", client_phone: "+19725550188" }), session("d1")];
// (a) The planner booked it: the concierge's answers.
await planning.applyBookingAnswers("b1", { role: "planner", host: { name: "Jordan Lee", phone: "", email: "" }, planner: null, requestedGuests: null });
const bLinks = (db.event_planners ?? []).filter((l) => l.session_id === "b1");
check("(a) A planner booking for a client: held by a planner, host set, account from the booking phone, linked as Lead", S("b1").booking_holder === "planner" && S("b1").host_name === "Jordan Lee" && bLinks.length === 1 && bLinks[0].is_lead === true && bLinks[0].linked_via === "booked" && (db.partners ?? []).some((p) => p.phone === CLIENT_PHONE));
check("...recorded with who and when", !!bLinks[0].linked_at && !!bLinks[0].linked_by_name && S("b1").booking_holder_set_by === "Concierge" && !!S("b1").booking_holder_set_at);
check("...and the planner gets a welcome text with the sign in link", !!textTo(CLIENT_PHONE, "plan.test/partners"));
// (b) Staff add a planner to a client held event: the client is texted a one tap remove link.
texts.length = 0;
db.partner_texts = [];
const added = await actions.staffBookingAction(MANAGER as never, S("c1"), { action: "add", name: "Pat Planner", company: "Bloom Events", phone: PLANNER_PHONE });
const cLink = (db.event_planners ?? []).find((l) => l.session_id === "c1")!;
check("(b) A manager adds a planner on the Details tab: linked, recorded with who and when", added.ok && cLink.linked_via === "staff" && cLink.linked_by_name === "Kenny Smith" && !!cLink.linked_at);
const clientText = textTo("+19725550188", "now has access to your bar planning");
check("...the client gets the exact text with a remove link", clientText?.startsWith("Pat Planner from Bloom Events now has access to your bar planning with The Mix Fix. If that is not right, tap here to remove them. https://plan.test/remove/") === true && hyphenFree(clientText ?? ""));
check("...and the planner gets a welcome", !!textTo(PLANNER_PHONE, "Hi Pat, you now have access to the bar planning for Maria's Wedding with The Mix Fix"));
check("Texts never carry another event's details", !(textTo("+19725550188", "now has access") ?? "").includes("Justin") && !(textTo(PLANNER_PHONE, "Hi Pat") ?? "").includes("Justin"));
// The phone matches an existing partner: that account is linked, no new one.
const before = (db.partners ?? []).length;
await actions.staffBookingAction(ADMIN as never, S("d1"), { action: "add", name: "Someone Else", phone: "(469) 555 0111" });
check("A phone that matches an existing partner links that account", (db.partners ?? []).length === before && (db.event_planners ?? []).some((l) => l.session_id === "d1" && db.partners.find((p) => p.id === l.partner_id)?.phone === PLANNER_PHONE));
// (c) The client adds their planner in update mode, and the Lead adds others on a planner held event.
// Clear both: from 9 PM to 8 AM the client's text from (b) is held in partner_texts, not sent.
texts.length = 0;
db.partner_texts = [];
const byClient = await actions.clientAddPlanner(S("c1"), { name: "Sam Second", phone: PLANNER2_PHONE });
const scLink = (db.event_planners ?? []).find((l) => l.session_id === "c1" && db.partners.find((p) => p.id === l.partner_id)?.phone === PLANNER2_PHONE)!;
check("(c) The client adds a planner: linked as Added by the client, with no remove text to themselves", byClient.ok && scLink.linked_via === "client" && scLink.linked_by_name === "Maria Lopez" && !textTo("+19725550188", "now has access"));
const booker = db.partners.find((p) => p.phone === CLIENT_PHONE)!;
const bookerToken = await signInPartner(CLIENT_PHONE);
const bookerAcc = (await pdb.eventAccess(await asPartner(bookerToken, () => pauth.getCurrentPrincipal()), S("b1").partner_key as string))!;
const byLead = await actions.leadAddPlanner(bookerAcc, { name: "Lee Third", phone: PLANNER3_PHONE });
check("(c) The Lead on a planner held event adds another planner", byLead.ok && (db.event_planners ?? []).some((l) => l.session_id === "b1" && l.linked_via === "lead" && l.linked_by_name === booker.name));
check("A client cannot add planners to a planner held event", !(await actions.clientAddPlanner(S("b1"), { name: "X", phone: "+14695550999" })).ok);
const concierge = prompt.buildIntakePrompt(null, new Date(), { people: pchat.bookingQuestionsSection({ askRole: true, askPlanner: true }) });
check("The planning chat asks once: guest of honor, hosting for someone else, or a planner", concierge.includes('"Are you the guest of honor, hosting this for someone else, or a planner booking for a client?" Ask it only once in the whole chat') && concierge.includes("Are you working with an event planner?"));
const tool = pchat.withBookingFields((await import("../lib/intake-tools.ts")).submitEventDataTool);
check("submit_event_data takes the booking answers, kept out of the saved event", ["booking_role", "host_name", "host_phone", "planner_phone"].every((k) => k in ((tool.input_schema as { properties: Record<string, unknown> }).properties)) && !("booking_role" in pchat.takeBookingAnswers({ booking_role: "planner", host_name: "J", guest_count: 1 }).rest));

// =====================================================================
// 9. The one tap remove link
// =====================================================================
const removeToken = clientText?.match(/\/remove\/([0-9a-f]{48})/)?.[1] ?? "";
const patNow = db.partners.find((p) => p.phone === PLANNER_PHONE)!;
const patTok2 = await signInPartner(PLANNER_PHONE);
const patP2 = await asPartner(patTok2, () => pauth.getCurrentPrincipal());
check("Before the tap, the planner has access", (await pdb.eventAccess(patP2, S("c1").partner_key as string)) !== null);
const tapped = await actions.removeByToken(removeToken);
check("One tap on the link removes that planner, and their access ends at once", tapped.ok && (await pdb.eventAccess(patP2, S("c1").partner_key as string)) === null && !(await pdb.plannersOn("c1")).some((p) => p.partner.id === patNow.id));
check("The link works once", !(await actions.removeByToken(removeToken)).ok);
check("Removal is recorded as the client", (db.partner_activity ?? []).some((a) => a.session_id === "c1" && a.action === "Planner removed" && a.actor_name === "Maria Lopez"));
check("The link page removes only on its button, so a link preview never removes anyone", !src("app/remove/[token]/page.tsx").includes("removeByToken") && src("app/api/planner-remove/route.ts").includes("export async function POST") && !src("app/api/planner-remove/route.ts").includes("export async function GET"));
check("The client can remove a planner in update mode too", (await actions.clientRemovePlanner(S("c1"), db.partners.find((p) => p.phone === PLANNER2_PHONE)!.id as string)).ok);

// =====================================================================
// 10. Deactivation ends access at once and alerts admins
// =====================================================================
texts.length = 0;
const bookerP = await asPartner(bookerToken, () => pauth.getCurrentPrincipal());
check("Before: the booking planner is signed in with access", bookerP !== null && (await pdb.eventAccess(bookerP, S("b1").partner_key as string)) !== null);
const deact = await pdb.deactivatePartner(booker.id as string, staffActor(ADMIN));
check("Deactivating ends every session at once", deact.ok && (await asPartner(bookerToken, () => pauth.getCurrentPrincipal())) === null && !(db.partner_sessions ?? []).some((s) => s.partner_id === booker.id));
check("...and access, even with an old principal", (await pdb.eventAccess({ kind: "partner", partner: { ...(booker as never as import("../lib/partners/rules.ts").Partner), active: false } }, S("b1").partner_key as string)) === null);
check("...admins and managers get a text about the events they hold or lead", texts.some((t) => t.phone === ADMIN.phone && t.message.includes("was deactivated") && t.message.includes("holds the booking")) && texts.some((t) => t.phone === MANAGER.phone && t.message.includes("was deactivated")));
texts.length = 0;
await pauth.requestPartnerCode(CLIENT_PHONE);
check("A deactivated partner cannot get a code", texts.length === 0);
check("Their old booking link stops working too", await clientView.clientLinkBlocked(S("b1")));
check("They cannot be linked again until turned back on", !(await pdb.findOrCreatePlanner({ phone: CLIENT_PHONE, name: "x" }, "Isabel")).ok);

// =====================================================================
// 11. A planner completes the planning chat, every answer marked as theirs
// =====================================================================
reset();
db.sessions = [session("i1", { status: "in_progress", version: 0, event_data: null, bar_service_start: "6:00 PM", event_type: "Wedding", name: "Justin Reyes" })];
const ip = (await pdb.findOrCreatePlanner({ name: "Pat Planner", company: "Bloom Events", phone: PLANNER_PHONE }, "Isabel")) as { ok: true; partner: import("../lib/partners/rules.ts").Partner };
await pdb.linkPlanner(S("i1"), ip.partner, { via: "staff", by: staffActor(ADMIN) });
const ipToken = await signInPartner(PLANNER_PHONE);
const key = S("i1").partner_key as string;
ai.calls.length = 0;
ai.script.reply = () => [{ type: "text", text: "Hi Pat! You are planning Justin's wedding. What is the address?" }];
const turn = async (text: string) => {
  const r = await asPartner(ipToken, () => partnerChatRoute.POST(new Request("http://plan.test/api/partners/chat", { method: "POST", body: JSON.stringify({ key, text }) })));
  return r.text();
};
await turn("");
const sys1 = ((ai.calls[0]?.system ?? []) as { text: string }[]).map((b) => b.text).join("");
check("The planning chat knows it is a planner and addresses them by name", sys1.includes("YOU ARE TALKING WITH A PLANNER: Pat Planner is planning Justin's wedding") && sys1.includes('"You are planning Justin\'s wedding."'));
check("...and never asks whether they are planning for themselves", !sys1.includes("WHO IS PLANNING"));
check("A planner who does not hold the booking gets no payment step and no balance", sys1.includes("PAYMENT STEP: skip it entirely") && !sys1.includes("$2,250"));
await turn("100 Main St, Dallas, TX 75201");
ai.script.reply = (p) =>
  p.messages.length > 4
    ? [{ type: "text", text: "All set!" }, ai.toolUse("submit_event_data", { client_name: "Justin Reyes", email: "justin@example.com", event_type: "Wedding", event_date: DAY, bar_service_start: "6:00 PM", bar_service_end: "10:00 PM", event_address: "100 Main St, Dallas, TX 75201", guest_count: 80, package: "Full Bar", signature_drinks: [] })]
    : [{ type: "text", text: "Great, anything else?" }];
await turn("That is everything");
const log = (db.conversation_logs ?? []).find((c) => c.session_id === "i1") as { messages: { role: string; content: string; by?: { kind: string; partnerId?: string } }[] };
const answers = log.messages.filter((m) => m.role === "user" && !m.content.startsWith("CONTEXT"));
check("Every answer the planner gave is marked as theirs", answers.length === 3 && answers.every((m) => m.by?.kind === "planner" && m.by.partnerId === ip.partner.id));
check("The planning is submitted", hooks.some((h) => h.url.endsWith("/api/save-event")) && S("i1").status === "submitted");
check("Submitting is logged under the planner's name", (db.partner_activity ?? []).some((a) => a.session_id === "i1" && a.action === "Submitted the planning" && a.actor_name === "Pat Planner"));
check("On a client held event the client is texted a short summary with a link to review", !!textTo(CLIENT_PHONE, /^Pat finished the bar planning\. Review it here: https:\/\/plan\.test\/s\?id=i1$/));
const keep = pchat.keepAuthors(log.messages, log.messages.map(({ by: _by, ...m }) => m));
check("The client's browser sending the chat back keeps the planner's marks", keep.filter((m) => m.by?.partnerId === ip.partner.id).length === 3);

// =====================================================================
// 12. The title rule (item 7)
// =====================================================================
const base = { event_data: { client_name: "Pat Planner", event_type: "Wedding", event_name: "Lee wedding" }, event_date: DAY };
const withHost = markets.eventData({ ...base, booking_holder: "planner", host_name: "Jordan Lee", planner_label: "Bloom Events" } as never);
check("Admin title: the host's full name, event type, then via the planner company", list.adminEventTitle(withHost) === "Jordan Lee · Wedding via Bloom Events");
check("Staff views: the host's first name", list.eventTitle(withHost) === "Jordan · Wedding" && list.titleFor(withHost, "bartender") === "Jordan · Wedding" && list.titleFor(withHost, "manager") === "Jordan Lee · Wedding via Bloom Events");
const noHost = markets.eventData({ ...base, booking_holder: "planner", planner_label: "Pat Planner" } as never);
check("No host named: the planner's name", list.adminEventTitle(noHost) === "Pat Planner · Wedding via Pat Planner" && list.eventTitle(noHost) === "Pat · Wedding");
check("The admin event header uses the rule", src("app/team/admin/e/[id]/page.tsx").includes("{adminEventTitle(titled)}</h1>"));

// =====================================================================
// 13. Existing events are unchanged
// =====================================================================
reset();
const old = session("old1");
db.sessions = [old];
const oldEd = markets.eventData(old as never);
check("An existing event reads as client held, no planners, no host", rules.bookingOf(old).holder === "client" && rules.bookingOf(old).host === null && (await pdb.plannersOn("old1")).length === 0);
check("Its titles do not change", list.adminEventTitle(oldEd) === "Justin Reyes · Wedding" && list.eventTitle(oldEd) === "Justin · Wedding" && !("__holder" in oldEd));
check("Its own link opens as before", !(await clientView.clientLinkBlocked(old as never)));
for (const t of ["partners", "partner_login_codes", "partner_sessions", "event_planners", "partner_activity", "price_approvals", "partner_texts", "partner_chats"]) missingTables.add(t);
check("Before the migration: the client page shows no planners card", (await clientView.clientPlannersCard(old as never)) === null);
check("...the Booking card says it is not set up yet", (await clientView.bookingCardData(old as never, "admin")).ready === false);
check("...the Partners page and Clients page planners load empty", (await pdb.listPartners(today)) === null && (await pdb.plannersBySession(["old1"])).size === 0);
check("...partner sign in does nothing and throws nothing", (await pauth.findPartnerByPhone(PLANNER_PHONE)) === null && (await pdb.eventAccess(null, "x")) === null);
await ptexts.sendHeldPartnerTexts();
check("...and the cron's held texts job is a no op", true);
missingTables.clear();
check("Every existing page reads sessions with *, so the new columns never break a read", src("lib/event-updates.ts").includes('.select("*")') && src("app/s/page.tsx").includes('.select("*")'));
check("One migration file, never run by the app", src("supabase/migrations/20261225_partners.sql").includes("create table if not exists public.partners") && src("supabase/migrations/20261225_partners.sql").includes("add column if not exists booking_holder         text        not null default 'client'"));
check("The partners header link is for admins and managers", (await import("../lib/team/header-nav.ts")).headerLinks(true, { unreadNews: 0 }).some((l) => l.href === "/team/admin/partners") && !(await import("../lib/team/header-nav.ts")).headerLinks(false, { unreadNews: 0 }).some((l) => l.href === "/team/admin/partners"));
check("Texts and screens about partners have no hyphens", [rules.clientPlannerAddedText({ name: "Pat", company: "Bloom" }, "L"), rules.plannerWelcomeText({ name: "Pat", eventFor: "Jordan", eventType: "Wedding", signInLink: "L" }), rules.sentForApprovalLine("Justin"), rules.planningNoticeText({ who: "Pat", submitted: false, summary: "Guest count: from 80 to 100", link: "L" }), rules.leadRemovedAdminText({ title: "T", date: "D", link: "L" })].every(hyphenFree));

// =====================================================================
// 14. Part A: the planner is the party on the agreement and invoice
// =====================================================================
const sms = await import("../lib/team/sms.ts");
const surprise = await import("../lib/partners/surprise.ts");
const guard = await import("../lib/surprise-guard.ts");
const editDb = await import("../lib/team/admin-edit-db.ts");
const delivery = await import("../lib/update-delivery.ts");
const updates = await import("../lib/event-updates.ts");
const banner = await import("../lib/partners/surprise-banner.ts");
const sysText = (c: unknown) => (((c as { system?: { text: string }[] })?.system ?? []) as { text: string }[]).map((b) => b.text).join("");
const toolNames = (c: unknown) => (((c as { tools?: { name: string }[] })?.tools ?? []) as { name: string }[]).map((t) => t.name);
const lastUser = (p: { messages: { role: string; content: unknown }[] }) => {
  const m = [...p.messages].reverse().find((x) => x.role === "user" && typeof x.content === "string");
  return (m?.content as string) ?? "";
};
type Msg = { role: string; content: string };
async function clientTurn(id: string, messages: Msg[]): Promise<string> {
  const r = await clientChat.POST(new Request("http://plan.test/api/chat", { method: "POST", body: JSON.stringify({ messages, sessionId: id }) }));
  return r.text();
}
const CTX: Msg = { role: "user", content: "CONTEXT - Pre-filled from booking system: Client name: Justin Reyes. Use this info and do not re-ask for it." };
const ROLE_Q = pchat.ROLE_QUESTION;
const SURPRISE_Q = pchat.SURPRISE_QUESTION;
const PRIVATE_Q = pchat.PRIVATE_NUMBER_QUESTION;
// After the surprise migration: every new column is on the row (null or false).
const NEW_COLS = { is_surprise: false, honoree_name: null, honoree_phone: null, honoree_email: null, surprise_set_by: null, surprise_set_at: null, planning_role: null };
const intakeRow = (id: string, top: Record<string, unknown> = {}) => session(id, { status: "in_progress", version: 0, event_data: null, event_type: "Birthday", name: "Justin Reyes", ...NEW_COLS, ...top });
const HONOREE_PHONE = "+12145550155";
const HOST2_PHONE = "+12145550160";
const PRIVATE_PHONE = "+12145550166";

reset();
process.env.GHL_UPDATE_WEBHOOK_URL = "https://hooks.test/update";
db.sessions = [
  session("ph1", { booking_holder: "planner", host_name: "Jordan Lee", host_phone: HOST_PHONE, host_email: "jordan@example.com", phone: PLANNER_PHONE, email: "pat@bloom.test", ...NEW_COLS }, { client_name: "Pat Planner", client_phone: PLANNER_PHONE, email: "pat@bloom.test" }),
];
const aPat = (await pdb.findOrCreatePlanner({ name: "Pat Planner", company: "Bloom Events", phone: PLANNER_PHONE }, "Isabel")) as { ok: true; partner: import("../lib/partners/rules.ts").Partner };
const aSam = (await pdb.findOrCreatePlanner({ name: "Sam Second", phone: PLANNER2_PHONE }, "Isabel")) as { ok: true; partner: import("../lib/partners/rules.ts").Partner };
await pdb.linkPlanner(S("ph1"), aPat.partner, { via: "booked", by: { kind: "planner", name: "Pat Planner", partnerId: aPat.partner.id }, lead: true });
await pdb.linkPlanner(S("ph1"), aSam.partner, { via: "lead", by: { kind: "planner", name: "Pat Planner", partnerId: aPat.partner.id } });
const aCard = await clientView.bookingCardData(S("ph1"), "admin");
check("A1: the admin Booking card shows Billed to the Lead (name, company) and Event for the host", aCard.billing?.billedTo === "Pat Planner, Bloom Events" && aCard.billing?.eventFor === "Jordan Lee");
check("A1: the admin Business tab gets the same lines, and renders them", JSON.stringify(await clientView.billingFor(S("ph1"))) === JSON.stringify(aCard.billing) && src("app/team/admin/e/[id]/business-tab.tsx").includes("Billed to:") && src("app/team/admin/e/[id]/business-tab.tsx").includes("Event for:") && src("app/team/admin/e/[id]/page.tsx").includes("billing={billing}"));
const aPatTok = await signInPartner(PLANNER_PHONE);
const aPatAcc = (await pdb.eventAccess(await asPartner(aPatTok, () => pauth.getCurrentPrincipal()), S("ph1").partner_key as string))!;
const aSamTok = await signInPartner(PLANNER2_PHONE);
const aSamAcc = (await pdb.eventAccess(await asPartner(aSamTok, () => pauth.getCurrentPrincipal()), S("ph1").partner_key as string))!;
check("A1: the planner's event page shows Billed to and Event for", (await page.partnerEventView(aPatAcc)).billing?.billedTo === "Pat Planner, Bloom Events" && (await page.partnerEventView(aSamAcc)).billing?.eventFor === "Jordan Lee" && src("app/partners/e/[key]/page.tsx").includes('label="Billed to:"') && src("app/partners/e/[key]/page.tsx").includes('label="Event for:"'));
check("A1: a client held event shows no Billed to line", rules.billingLines(rules.bookingOf({}), null) === null);

// A2 and A3: the host gets the total and nothing else, and never the money texts.
await actions.leadSetSwitch(aPatAcc, "host_can_see_pricing", true);
const aHostTok = await signInPartner(HOST_PHONE);
const aHostAcc = (await pdb.eventAccess(await asPartner(aHostTok, () => pauth.getCurrentPrincipal()), S("ph1").partner_key as string))!;
const aHostView = await page.partnerEventView(aHostAcc);
const hm = rules.moneyAccess(rules.bookingOf(S("ph1")), { kind: "host", name: "Jordan" });
check("A2: Host can see pricing shows the host the total and nothing else", aHostView.pricing?.total === "$2,400" && aHostView.pricing.balance === "" && aHostView.pricing.payments.length === 0 && aHostView.pricing.agreements.length === 0 && hm.total && !hm.balance && !hm.payments && !hm.agreement && !hm.approve);
check("A3: the host page never shows the agreement, payments, or balance", !aHostView.money.agreement && !aHostView.money.payments && !aHostView.money.balance && (await page.partnerAgreementLink(aHostAcc, "x", false)) === null && aHostView.billing === null);
texts.length = 0;
db.partner_texts = [];
await approvals.askForApproval(S("ph1"), { guest_count: 120 }, aSamAcc.actor);
check("A2: a price change and its total go to the booking holder (the Lead), never the host, even with Host can see pricing on", !!textTo(PLANNER_PHONE, "affects the price") && !textTo(HOST_PHONE, /./));
const scrubbed = rules.scrubHostContact({ email: "Jordan@example.com", client_phone: "(214) 555 0144", phone: "2145550144" }, S("ph1"));
check("A2: a GHL payload never carries the host's email or phone: the booking holder's instead", scrubbed.email === "pat@bloom.test" && scrubbed.client_phone === PLANNER_PHONE && scrubbed.phone === PLANNER_PHONE && scrubbed.billed_to === "planner" && scrubbed.event_for_name === "Jordan Lee");
// The update webhook (GHL's payment link and balance reminders follow its contact), with the host's email mixed in by mistake.
(S("ph1").event_data as Record<string, unknown>).email = "jordan@example.com";
hooks.length = 0;
const aUpd = await updates.applyEventUpdate("ph1", { special_requests: "Extra limes" });
await delivery.deliverEventUpdates("ph1", aUpd?.rows ?? []);
const aHook = hooks.find((h) => h.url === "https://hooks.test/update");
check("A2: the update webhook goes to the booking holder's contact, never the host's", !!aHook && aHook.body.email === "pat@bloom.test" && aHook.body.billed_to === "planner" && !JSON.stringify(aHook.body).includes("jordan@example.com"));
check("A2: the intake webhook and list only payloads go through the same scrub", src("app/api/webhook/route.ts").includes("scrubHostContact(payload") && src("lib/update-delivery.ts").includes("scrubHostContact(listOnlyPayload"));
// A4: an admin moves Lead to another planner.
check("A4: no warning while the Lead is the original booking contact", aCard.leadMovedWarning === "");
await actions.staffBookingAction(ADMIN as never, S("ph1"), { action: "lead", partnerId: aSam.partner.id });
const aCard2 = await clientView.bookingCardData(S("ph1"), "admin");
check("A4: moving Lead shows the GHL warning on the Booking card, word for word", aCard2.leadMovedWarning === "Payment reminders in GHL still go to the original booking contact. Update the contact in GHL." && src("app/team/admin/e/[id]/booking-card.tsx").includes("data.leadMovedWarning"));
check("A4: ...and Billed to follows the new Lead", aCard2.billing?.billedTo === "Sam Second");
check("A4: a client held event never shows it", !pdb.leadMoved(session("x") as never, { phone: PLANNER_PHONE }));

// =====================================================================
// 15. Part B: surprise events
// =====================================================================
// B1. The migration.
const mig = src("supabase/migrations/20261226_surprise_events.sql");
check(
  "B1: the migration adds the surprise columns, safe to run twice",
  ["is_surprise      boolean     not null default false", "honoree_name", "honoree_phone", "honoree_email", "surprise_set_by", "surprise_set_at"].every((c) => mig.includes(c)) &&
    (mig.match(/add column if not exists/g) ?? []).length === 7 &&
    mig.includes("drop constraint if exists") &&
    mig.includes("create index if not exists") &&
    !/create table (?!if not exists)/.test(mig)
);

// B2. The opening question: guest of honor.
reset();
db.sessions = [intakeRow("g1"), intakeRow("s1"), intakeRow("pl1"), intakeRow("hp1", { booking_holder: "planner", phone: "+19725550111" }), intakeRow("adm1", { is_surprise: true, honoree_name: "Rae Moss", surprise_set_by: "Isabel Jones", surprise_set_at: new Date().toISOString() }), session("old2", { status: "in_progress", version: 0, event_data: null, event_type: "Birthday", name: "Justin Reyes" })];
ai.calls.length = 0;
ai.script.reply = () => [{ type: "text", text: `Welcome! ${ROLE_Q}` }];
let g: Msg[] = [CTX, { role: "user", content: "Hi" }];
await clientTurn("g1", g);
const firstSys = sysText(ai.calls.at(-1));
check("B2: right after the greeting, one question with three answers, word for word", firstSys.includes(`right after your greeting and before any event question, ask exactly: "${ROLE_Q}"`) && !firstSys.includes("Are you planning this for yourself"));
check("B2: the concierge can save the answer the moment it is given", toolNames(ai.calls.at(-1)).includes("save_planning_role"));
g = [...g, { role: "assistant", content: `Welcome! ${ROLE_Q}` }, { role: "user", content: "I am the guest of honor" }];
ai.script.reply = () => [{ type: "text", text: "Happy birthday! What is your full name?" }, ai.toolUse("save_planning_role", { role: "guest_of_honor" })];
await clientTurn("g1", g);
check("B2: guest of honor: saved, and the booking stays client held with no host", S("g1").planning_role === "guest_of_honor" && rules.bookingOf(S("g1")).holder === "client" && !S("g1").host_name);
g = [...g, { role: "assistant", content: "Happy birthday! What is your full name?" }, { role: "user", content: "Justin Reyes" }];
ai.script.reply = () => [{ type: "text", text: "Thanks Justin. What is the address?" }];
await clientTurn("g1", g);
check("B2: guest of honor: never asked the opening question again, and never the surprise question", !sysText(ai.calls.at(-1)).includes(ROLE_Q) && !sysText(ai.calls.at(-1)).includes(SURPRISE_Q));

// Hosting for someone else (not a planner), a surprise.
let h: Msg[] = [CTX, { role: "user", content: "Hi" }, { role: "assistant", content: `Welcome! ${ROLE_Q}` }, { role: "user", content: "I am hosting it for my sister" }];
ai.script.reply = () => [{ type: "text", text: "How fun! Who is the party for?" }, ai.toolUse("save_planning_role", { role: "someone_else" })];
await clientTurn("s1", h);
check("B2: hosting for someone else: saved and still client held", S("s1").planning_role === "someone_else" && rules.bookingOf(S("s1")).holder === "client");
check("B2: ...the concierge is told to ask only the name, never that person's phone or email", sysText(ai.calls.at(-1)).includes("never ask for that person's phone or email"));
h = [...h, { role: "assistant", content: "How fun! Who is the party for?" }, { role: "user", content: "My sister Maya Fields" }];
ai.script.reply = () => [{ type: "text", text: `Lovely. ${SURPRISE_Q}` }, ai.toolUse("save_planning_role", { host_name: "Maya Fields" })];
await clientTurn("s1", h);
check("B2: the person it is for is saved as the host by name only", S("s1").host_name === "Maya Fields" && !S("s1").host_phone && !S("s1").host_email);
check("B2: the surprise follow up is asked right away (and the opening question is not asked again)", sysText(ai.calls.at(-1)).includes(`ask exactly: "${SURPRISE_Q}"`) && !sysText(ai.calls.at(-1)).includes(ROLE_Q));
h = [...h, { role: "assistant", content: `Lovely. ${SURPRISE_Q}` }, { role: "user", content: "Yes! She has no idea" }];
ai.script.reply = () => [{ type: "text", text: `We will never contact Maya about this event. ${PRIVATE_Q}` }, ai.toolUse("save_planning_role", { is_surprise: true, honoree_name: "Maya Fields" })];
await clientTurn("s1", h);
check("B2: a yes saves is_surprise and the guest of honor's name, by the concierge", S("s1").is_surprise === true && S("s1").honoree_name === "Maya Fields" && S("s1").surprise_set_by === "Concierge" && !!S("s1").surprise_set_at);
check("B2: ...and the concierge is told to promise we never contact them, then ask for a private number, word for word", sysText(ai.calls.at(-1)).includes("tell them we will never contact the guest of honor") && sysText(ai.calls.at(-1)).includes(`ask exactly: "${PRIVATE_Q}"`));
h = [...h, { role: "assistant", content: `We will never contact Maya about this event. ${PRIVATE_Q}` }, { role: "user", content: "214 555 0166" }];
ai.script.reply = () => [{ type: "text", text: "Got it. What date is the party?" }, ai.toolUse("save_planning_role", { private_phone: "214 555 0166" })];
await clientTurn("s1", h);
const s1Sys = sysText(ai.calls.at(-1));
check("B2: once answered, neither question is asked again", !s1Sys.includes(ROLE_Q) && !s1Sys.includes(SURPRISE_Q) && s1Sys.includes("SURPRISE EVENT: this is a surprise for Maya"));
const again = await planning.savePlanningRole("s1", { role: "planner", is_surprise: false });
check("B2: a second answer never overwrites the first", S("s1").planning_role === "someone_else" && S("s1").is_surprise === true && again.saved === false);
h = [...h, { role: "assistant", content: "Got it. What date is the party?" }, { role: "user", content: "That is everything" }];
ai.script.reply = () => [
  { type: "text", text: "All set!" },
  ai.toolUse("submit_event_data", { client_name: "Justin Reyes", email: "justin@example.com", event_type: "Birthday", event_date: DAY, bar_service_start: "6:00 PM", bar_service_end: "10:00 PM", event_address: "100 Main St, Dallas, TX 75201", guest_count: 80, package: "Full Bar", signature_drinks: [], booking_role: "someone_else", host_name: "Maya Fields", is_surprise: true, honoree_name: "Maya Fields", private_phone: "214 555 0166" }),
];
await clientTurn("s1", h);
check("B2: submitted: still client held, host by name only, and the private number is the client phone", S("s1").status === "submitted" && rules.bookingOf(S("s1")).holder === "client" && S("s1").host_name === "Maya Fields" && !S("s1").host_phone && (S("s1").event_data as Record<string, unknown>).client_phone === PRIVATE_PHONE);
check("B2: no planner is linked and no host welcome text goes out", !(db.event_planners ?? []).some((l) => l.session_id === "s1") && !allPartnerTexts().some((m) => m.includes("view your")));
ai.script.reply = () => [{ type: "text", text: "What would you like to change?" }];
await clientTurn("s1", [{ role: "user", content: "Hi" }]);
check("B2: never asked on an event that is already submitted (update mode has neither question)", !sysText(ai.calls.at(-1)).includes(ROLE_Q) && !sysText(ai.calls.at(-1)).includes(SURPRISE_Q) && !toolNames(ai.calls.at(-1)).includes("save_planning_role"));
const late2 = await planning.savePlanningRole("s1", { role: "guest_of_honor" });
check("B2: ...and nothing about it can be saved on a submitted event", late2.saved === false && S("s1").planning_role === "someone_else");

// A planner booking for a client: the surprise question, answered no, then the planner flow as today.
let pm: Msg[] = [CTX, { role: "user", content: "Hi" }, { role: "assistant", content: `Welcome! ${ROLE_Q}` }, { role: "user", content: "I am a planner booking for my client Jordan Lee" }];
ai.script.reply = () => [{ type: "text", text: `Great, planning Jordan's party. ${SURPRISE_Q}` }, ai.toolUse("save_planning_role", { role: "planner", host_name: "Jordan Lee" })];
await clientTurn("pl1", pm);
check("B2: planner: saved, and the booking is not moved to the planner until the planning is in", S("pl1").planning_role === "planner" && rules.bookingOf(S("pl1")).holder === "client" && S("pl1").host_name === "Jordan Lee");
pm = [...pm, { role: "assistant", content: `Great, planning Jordan's party. ${SURPRISE_Q}` }, { role: "user", content: "No, Jordan knows" }];
ai.script.reply = () => [{ type: "text", text: "Would you like Jordan to have access to view the plans?" }, ai.toolUse("save_planning_role", { is_surprise: false })];
await clientTurn("pl1", pm);
check("B2: planner: the surprise follow up is asked for the third answer too", sysText(ai.calls.at(-1)).includes(`ask exactly: "${SURPRISE_Q}"`) && sysText(ai.calls.at(-1)).includes("they are a planner booking for a client"));
check("B2: a no is saved as answered and is not a surprise", S("pl1").is_surprise === false && !!S("pl1").surprise_set_at);
pm = [...pm, { role: "assistant", content: "Would you like Jordan to have access to view the plans?" }, { role: "user", content: "Yes, 214 555 0144" }];
ai.script.reply = () => [
  { type: "text", text: "All set!" },
  ai.toolUse("submit_event_data", { client_name: "Justin Reyes", email: "justin@example.com", event_type: "Birthday", event_date: DAY, bar_service_start: "6:00 PM", event_address: "100 Main St, Dallas, TX 75201", guest_count: 80, package: "Full Bar", signature_drinks: [], booking_role: "planner", host_name: "Jordan Lee", host_phone: "214 555 0144", is_surprise: false }),
];
await clientTurn("pl1", pm);
check("B2: planner: neither question again on the next turn", !sysText(ai.calls.at(-1)).includes(ROLE_Q) && !sysText(ai.calls.at(-1)).includes(SURPRISE_Q));
check("B2: planner: continues as the planner flow does today (held by the planner, linked as Lead, host with access)", S("pl1").booking_holder === "planner" && (db.event_planners ?? []).some((l) => l.session_id === "pl1" && l.is_lead) && S("pl1").host_phone === HOST_PHONE && !!textTo(HOST_PHONE, "plan.test/partners"));

// The booking already tells us: skip.
ai.script.reply = () => [{ type: "text", text: "Welcome!" }];
await clientTurn("hp1", [CTX, { role: "user", content: "Hi" }]);
check("B2: a planner already holds the booking: the opening question is skipped, the surprise one is still asked", !sysText(ai.calls.at(-1)).includes(ROLE_Q) && sysText(ai.calls.at(-1)).includes(SURPRISE_Q), sysText(ai.calls.at(-1)).slice(sysText(ai.calls.at(-1)).indexOf("WHO IS"), sysText(ai.calls.at(-1)).indexOf("WHO IS") + 600));
await clientTurn("adm1", [CTX, { role: "user", content: "Hi" }]);
check("B2: an admin already marked it a surprise: neither question is asked", !sysText(ai.calls.at(-1)).includes(ROLE_Q) && !sysText(ai.calls.at(-1)).includes(SURPRISE_Q) && sysText(ai.calls.at(-1)).includes("SURPRISE EVENT: this is a surprise for Rae"));
check("B2: the surprise follow up is only for the second and third answers", pchat.bookingQuestionsSection({ askRole: true, askPlanner: false, canSave: true }).includes('Only for "someone_else" or "planner", and never for the guest of honor') && !pchat.bookingQuestionsSection({ askRole: false, askPlanner: true, askSurprise: false, role: "guest_of_honor", canSave: true }).includes(SURPRISE_Q));
check("B2: the questions and the answers have no hyphens", [ROLE_Q, SURPRISE_Q, PRIVATE_Q].every(hyphenFree));
// Before the surprise migration: the question is still asked once (by the chat), and nothing tries to save it.
await clientTurn("old2", [CTX, { role: "user", content: "Hi" }]);
check("B2: before the migration the chat still opens with the new question, with no save tool", sysText(ai.calls.at(-1)).includes(ROLE_Q) && !toolNames(ai.calls.at(-1)).includes("save_planning_role"));
const tb = pchat.takeBookingAnswers({ booking_role: "planner", host_name: "Jordan Lee", host_phone: "2145550144", host_email: "j@x.test", is_surprise: true, honoree_name: "Jordan Lee" });
check("B2: a planner's surprise: the host gets no phone or email, so no welcome text and no login", tb.answers.host?.name === "Jordan Lee" && tb.answers.host.phone === "" && tb.answers.host.email === "" && tb.answers.surprise?.on === true);
const tb2 = pchat.takeBookingAnswers({ booking_role: "someone_else", host_name: "Maya", host_phone: "2145550144" });
check("B2: hosting for someone else never saves the host's phone", tb2.answers.role === "someone_else" && tb2.answers.host?.phone === "" && !("is_surprise" in tb2.rest) && !("private_phone" in tb2.rest));

// B9. The surprise question is only for SURPRISE_EVENT_TYPES (a birthday for now).
reset();
const asks = (sys: string) => sys.includes(`ask exactly: "${SURPRISE_Q}"`);
const waits = (sys: string) => sys.includes("Never ask it before you know what kind of event it is");
const SE = { planning_role: "someone_else", host_name: "Maya Fields" };
const PL = { planning_role: "planner", host_name: "Jordan Lee" };
db.sessions = [
  intakeRow("bd2", SE), intakeRow("bd3", PL),
  intakeRow("wd2", { ...SE, event_type: "Wedding" }), intakeRow("wd3", { ...PL, event_type: "Wedding" }),
  intakeRow("co2", { ...SE, event_type: "Corporate Event" }), intakeRow("co3", { ...PL, event_type: "Corporate Event" }),
  intakeRow("an2", { ...SE, event_type: "Anniversary" }), intakeRow("an3", { ...PL, event_type: "Anniversary" }),
  intakeRow("lz1", { ...SE, event_type: "40th birthday" }), intakeRow("lz2", { ...PL, event_type: "bday" }), intakeRow("lz3", { ...SE, event_type: "Birthday Party" }),
  intakeRow("ed1", { ...SE, event_type: null, event_data: { event_type: "Birthday" } }), intakeRow("ed2", { ...SE, event_type: null, event_data: { event_type: "Wedding" } }), intakeRow("ed3", { ...SE, event_type: "Birthday", event_data: { event_type: "Wedding" } }),
  intakeRow("nt1", { event_type: null }), intakeRow("nt2", { ...SE, event_type: null }),
  intakeRow("ws1", { ...SE, event_type: "Wedding Shower" }),
  session("wad", { ...NEW_COLS, host_name: "Maya Fields" }, { event_type: "Wedding" }),
];
ai.script.reply = () => [{ type: "text", text: "Welcome!" }];
const sysFor = async (id: string, msgs: Msg[] = [CTX, { role: "user", content: "Hi" }]) => { await clientTurn(id, msgs); return sysText(ai.calls.at(-1)); };
const bd2Sys = await sysFor("bd2");
const bd3Sys = await sysFor("bd3");
check("B9: a birthday: asked for hosting for someone else (the second answer)", asks(bd2Sys) && bd2Sys.includes("they are hosting for someone else") && !waits(bd2Sys));
check("B9: a birthday: asked for a planner (the third answer)", asks(bd3Sys) && bd3Sys.includes("they are a planner booking for a client") && !waits(bd3Sys));
for (const [id, type] of [["wd2", "a wedding"], ["wd3", "a wedding"], ["co2", "a corporate event"], ["co3", "a corporate event"], ["an2", "an anniversary"], ["an3", "an anniversary"]] as const) {
  const sys = await sysFor(id);
  check(`B9: ${type} (${id.endsWith("2") ? "hosting for someone else" : "planner"}): never asked`, !sys.includes(SURPRISE_Q) && sys.includes("never ask whether it is a surprise"));
}
const wd3Sys = await sysFor("wd3");
check("B9: a planner on a wedding is still asked about host access (that used to follow a no to the surprise question)", wd3Sys.includes("ask once whether they would like the host to have access to view the plans"));
check(
  "B9: loose matches, ignoring case: Birthday, Birthday Party, 40th birthday, bday all count",
  ["Birthday", "Birthday Party", "40th birthday", "bday", "BDAY", "b day", "B-Day", "Surprise 30th Birthday!"].every(pchat.isSurpriseEventType) &&
    !["Wedding", "Corporate Event", "Anniversary", "Wedding Shower", "", "Baby Shower"].some(pchat.isSurpriseEventType) &&
    pchat.isSurpriseEventType(null) === false
);
check("B9: one list in code, starting with birthday only", pchat.SURPRISE_EVENT_TYPES.length === 1 && pchat.SURPRISE_EVENT_TYPES[0].type === "birthday");
for (const id of ["lz1", "lz2", "lz3"]) check(`B9: the concierge asks on "${S(id).event_type}"`, asks(await sysFor(id)));
check("B9: no session event type: event_data.event_type is read (a birthday there is asked)", asks(await sysFor("ed1")));
check("B9: ...and a wedding there is not", !(await sysFor("ed2")).includes(SURPRISE_Q));
check("B9: the session's event_type comes first", asks(await sysFor("ed3")));
// The booking gives no event type: never before the client says what kind of event it is.
const nt1Sys = await sysFor("nt1");
check("B9: no event type on the booking: the concierge waits until the client says (never right after the greeting)", waits(nt1Sys) && !nt1Sys.includes("Right after your greeting (they are"));
const nt2Sys = await sysFor("nt2");
check("B9: ...even for someone already known to host for someone else", waits(nt2Sys) && !nt2Sys.includes("Right after your greeting (they are"));
check("B9: ...then asks at that point only on a birthday, never on any other kind of event", nt2Sys.includes("if it is a birthday") && nt2Sys.includes("For any other kind of event never ask it"));
let nt: Msg[] = [CTX, { role: "user", content: "Hi" }, { role: "assistant", content: "Welcome! What kind of event is it?" }, { role: "user", content: "A 40th birthday for my sister Maya" }];
ai.script.reply = () => [{ type: "text", text: `Fun! ${SURPRISE_Q}` }];
const nt2b = await sysFor("nt2", nt);
check("B9: once the client says, the same rule still holds for that turn, and the answer saves", waits(nt2b) && toolNames(ai.calls.at(-1)).includes("save_planning_role"));
nt = [...nt, { role: "assistant", content: `Fun! ${SURPRISE_Q}` }, { role: "user", content: "Yes" }];
ai.script.reply = () => [{ type: "text", text: `We will never contact Maya about this event. ${PRIVATE_Q}` }, ai.toolUse("save_planning_role", { is_surprise: true, honoree_name: "Maya Fields" })];
await clientTurn("nt2", nt);
check("B9: ...and a yes is saved", S("nt2").is_surprise === true && S("nt2").honoree_name === "Maya Fields");
check("B9: the guest of honor is never asked, whatever the event type", !pchat.bookingQuestionsSection({ askRole: false, askPlanner: true, askSurprise: false, role: "guest_of_honor", canSave: true, eventType: "Birthday" }).includes(SURPRISE_Q));
// A client who volunteers that a wedding shower is a surprise.
const ws: Msg[] = [CTX, { role: "user", content: "Hi" }, { role: "assistant", content: "Welcome! What date is the shower?" }, { role: "user", content: "June 5. And it is a surprise for Maya, she has no idea!" }];
ai.script.reply = () => [{ type: "text", text: `We will never contact Maya about this event. ${PRIVATE_Q}` }, ai.toolUse("save_planning_role", { is_surprise: true, honoree_name: "Maya Fields" })];
const wsSys = await sysFor("ws1", ws);
check("B9: a wedding shower: the concierge never asks, but is told to save a surprise the client mentions and ask for the private number", !wsSys.includes(SURPRISE_Q) && wsSys.includes("tell you on their own that it is a surprise") && wsSys.includes(`ask exactly: "${PRIVATE_Q}"`));
check("B9: ...and the volunteered surprise is saved the same way", S("ws1").is_surprise === true && S("ws1").honoree_name === "Maya Fields" && S("ws1").surprise_set_by === "Concierge");
ai.script.reply = () => [
  { type: "text", text: "All set!" },
  ai.toolUse("submit_event_data", { client_name: "Justin Reyes", email: "justin@example.com", event_type: "Wedding Shower", event_date: DAY, bar_service_start: "6:00 PM", event_address: "100 Main St, Dallas, TX 75201", guest_count: 80, package: "Full Bar", signature_drinks: [], booking_role: "someone_else", host_name: "Maya Fields", is_surprise: true, honoree_name: "Maya Fields", private_phone: "214 555 0166" }),
];
await clientTurn("ws1", [...ws, { role: "assistant", content: PRIVATE_Q }, { role: "user", content: "214 555 0166" }]);
check("B9: ...and the private number becomes the client phone at submit", (S("ws1").event_data as Record<string, unknown>).client_phone === PRIVATE_PHONE);
// Admins and managers: Surprise on any event type, as before.
const wad = await actions.staffBookingAction(ADMIN as never, S("wad"), { action: "surprise", on: true, name: "Maya Fields" });
check("B9: an admin can still turn Surprise on for a wedding", wad.ok && S("wad").is_surprise === true && S("wad").surprise_set_by === "Isabel Jones");
check("B9: the new wording has no hyphens", [pchat.bookingQuestionsSection({ askRole: true, askPlanner: true, canSave: true }), pchat.bookingQuestionsSection({ askRole: false, askPlanner: true, askSurprise: true, role: "planner", canSave: true, eventType: "Wedding" })].every((t) => hyphenFree(t.replace(/guest_of_honor|someone_else/g, ""))));

// B3 to B8 on one submitted surprise event.
reset();
db.sessions = [session("sp1", { ...NEW_COLS, host_name: "Maya Fields" }, { client_name: "Justin Reyes" }), intakeRow("sp2")];
await pdb.setHost(S("sp1"), { name: "Maya Fields", phone: "214 555 0160" }, staffActor(ADMIN));
const spHostTok = await signInPartner(HOST2_PHONE);
check("Before it is a surprise, the host can sign in", spHostTok.length > 20 && (await asPartner(spHostTok, () => pauth.getCurrentPrincipal()))?.kind === "host");
const bartenderTry = await actions.staffBookingAction(BARTENDER as never, S("sp1"), { action: "surprise", on: true, name: "Maya Fields" });
check("B6: a bartender cannot turn Surprise on", !bartenderTry.ok && !S("sp1").is_surprise);
const clashClient = await actions.staffBookingAction(MANAGER as never, S("sp1"), { action: "surprise", on: true, name: "Maya Fields", phone: CLIENT_PHONE });
check("B3: the client phone can never be saved as the guest of honor's either (texts to the client would stop)", !clashClient.ok && /client's contact/.test(clashClient.ok ? "" : clashClient.error) && !S("sp1").is_surprise);
const spOn = await actions.staffBookingAction(MANAGER as never, S("sp1"), { action: "surprise", on: true, name: "Maya Fields", phone: "214 555 0155", email: "Maya@example.com" });
check("B6: a manager turns Surprise on with the guest of honor", spOn.ok && S("sp1").is_surprise === true && S("sp1").honoree_phone === HONOREE_PHONE && S("sp1").honoree_email === "maya@example.com" && S("sp1").surprise_set_by === "Kenny Smith");
check("B6: ...logged in partner activity", (db.partner_activity ?? []).some((a) => a.session_id === "sp1" && a.action === "Surprise turned on" && a.actor_name === "Kenny Smith" && String(a.detail).includes("Maya Fields")));
const spCard = await clientView.bookingCardData(S("sp1"), "manager");
check("B6: the Booking card shows it, with the honoree, for admins and managers", spCard.surprise.ready && spCard.surprise.on && spCard.surprise.active && spCard.surprise.name === "Maya Fields" && spCard.surprise.phone === HONOREE_PHONE && !!spCard.surprise.liftsAfter && src("app/team/admin/e/[id]/booking-card.tsx").includes('action: "surprise"'));
await actions.staffBookingAction(ADMIN as never, S("sp1"), { action: "surprise", on: true, name: "Maya Fields", phone: "214 555 0155", email: "maya@example.com" });
check("B6: editing the honoree is logged", (db.partner_activity ?? []).some((a) => a.session_id === "sp1" && a.action === "Guest of honor changed" && a.actor_name === "Isabel Jones"));

// B3: the host on a surprise event.
texts.length = 0;
await pauth.requestPartnerCode(HOST2_PHONE);
check("B3: the host on a surprise event cannot sign in at /partners (no code)", texts.length === 0);
check("B3: ...and a session they already had stops working", (await asPartner(spHostTok, () => pauth.getCurrentPrincipal())) === null && (await pdb.eventAccess({ kind: "host", phone: HOST2_PHONE, name: "Maya" }, S("sp1").partner_key as string)) === null);
const hostLogin = await pdb.setHost(S("sp1"), { name: "Maya Fields", phone: "(214) 555 0155" }, staffActor(ADMIN));
check("B3: the honoree's number is refused as a host login, with a plain reason", !hostLogin.ok && !hostLogin.ok && hostLogin.error === surprise.honoreeRefusal("host login") && hyphenFree(hostLogin.error));
texts.length = 0;
db.partner_texts = [];
const hostOther = await pdb.setHost(S("sp1"), { name: "Maya Fields", phone: "214 555 0177" }, staffActor(ADMIN));
check("B3: the host gets no login and no welcome text on a surprise event", !hostOther.ok && !hostOther.ok && hostOther.error === surprise.HOST_SURPRISE_REFUSAL && !textTo("+12145550177", /./));
// B3: never a planner.
const plannerHonoree = await actions.staffBookingAction(ADMIN as never, S("sp1"), { action: "add", name: "Maya Fields", phone: "214 555 0155" });
check("B3: the honoree's number is refused as a planner, and no account is made", !plannerHonoree.ok && !plannerHonoree.ok && plannerHonoree.error === surprise.honoreeRefusal("planner") && !(db.partners ?? []).some((p) => p.phone === HONOREE_PHONE));
const plannerEmail = await actions.clientAddPlanner(S("sp1"), { name: "Maya", phone: "+14695550999", email: "maya@example.com" });
check("B3: ...by email too", !plannerEmail.ok);
const hostPlanner = await actions.clientAddPlanner(S("sp1"), { name: "Maya Fields", phone: "214 555 0160" });
check("B3: the host on a surprise event cannot be added as a planner", !hostPlanner.ok && !hostPlanner.ok && hostPlanner.error === surprise.PLANNER_SURPRISE_REFUSAL);
// B3: never the day of contact.
const doc = await editDb.saveAdminEdit({ sessionId: "sp1", admin: ADMIN as never, changes: { day_of_contact_phone: "214 555 0155" }, price: { mode: "keep" }, expectedVersion: S("sp1").version, origin: "https://plan.test" });
check("B3: the honoree's number is refused as the day of contact (admin edit)", !doc.ok && !doc.ok && doc.error === surprise.honoreeRefusal("day of contact") && (S("sp1").event_data as Record<string, unknown>).day_of_contact_phone === "2145550177");
ai.calls.length = 0;
ai.script.reply = (p) => (p.tool_choice?.type === "none" ? [{ type: "text", text: surprise.honoreeRefusal("day of contact") }] : [{ type: "text", text: "Saving that." }, ai.toolUse("update_event_data", { day_of_contact_phone: "2145550155" })]);
const docChat = await clientTurn("sp1", [{ role: "user", content: "Make Maya the day of contact, 214 555 0155" }]);
check("B3: ...and in the concierge's update mode, with the reason said", (S("sp1").event_data as Record<string, unknown>).day_of_contact_phone === "2145550177" && JSON.stringify(ai.calls.at(-1)?.messages ?? "").includes("cannot be saved as the day of contact") && docChat.includes("data:"));
// B3: never the client phone (the private number question during planning).
db.sessions.push(intakeRow("sp3", { is_surprise: true, honoree_name: "Maya Fields", honoree_phone: HONOREE_PHONE, surprise_set_at: new Date().toISOString(), planning_role: "someone_else", host_name: "Maya Fields" }));
const cp = await planning.savePlanningRole("sp3", { private_phone: "214 555 0155" });
check("B3: the honoree's number is refused as the client phone", cp.refused === surprise.honoreeRefusal("client phone"));
ai.calls.length = 0;
ai.script.reply = (p) => (p.tool_choice?.type === "none" ? [{ type: "text", text: surprise.honoreeRefusal("client phone") }] : [{ type: "text", text: "Thanks!" }, ai.toolUse("save_planning_role", { private_phone: "2145550155" })]);
const cpChat = await clientTurn("sp3", [CTX, { role: "user", content: "Hi" }, { role: "assistant", content: PRIVATE_Q }, { role: "user", content: "214 555 0155" }]);
const cpSaved = ((db.conversation_logs ?? []).find((c) => c.session_id === "sp3") as { messages: Msg[] }).messages.at(-1)?.content ?? "";
check("B3: ...and the concierge says why", ai.calls.length === 2 && JSON.stringify(ai.calls[1].messages).includes("cannot be saved as the client phone") && cpChat.includes("data:") && cpSaved.includes("cannot be saved as the client phone"));

// B4: one guard in the shared text path.
texts.length = 0;
const dropped = await sms.sendStaffText("(214) 555 0155", "Maya", "Your bar plans are ready");
check("B4: a text to the honoree's number is dropped", dropped === false && texts.length === 0);
check("B4: ...and logged on the event", (db.partner_activity ?? []).some((a) => a.session_id === "sp1" && a.action === "Text to the guest of honor blocked"));
const viaPartner = await ptexts.sendPartnerText(S("sp1"), HONOREE_PHONE, "Maya", "Hi Maya", new Date());
check("B4: whatever sent it: a partner text (sent now or held for quiet hours) is dropped too", viaPartner === false && !texts.some((t) => t.phone === HONOREE_PHONE) && !(db.partner_texts ?? []).some((t) => t.phone === HONOREE_PHONE));
await sms.sendStaffText(CLIENT_PHONE, "Justin", "Hi Justin");
check("B4: texts to anyone else still go out", texts.some((t) => t.phone === CLIENT_PHONE));
check("B4: the guard is in the one shared text path every sender uses", src("lib/team/sms.ts").includes("if (await dropTextToHonoree(phone)) return false;"));

// B5: the staff banner.
const bText = banner.surpriseBannerText(S("sp1"));
check("B5: staff see the banner, first name only, word for word", bText === "Surprise event. Do not contact Maya or mention the bar to them." && !bText.includes("Fields"));
check("B5: on the staff event page, the admin event page, and its Day of tab (the header shows on every tab)", src("app/team/e/[id]/page.tsx").includes("<SurpriseBanner text={surprise} />") && src("app/team/admin/e/[id]/page.tsx").includes("<SurpriseBanner text={surprise} />") && src("app/team/admin/e/[id]/page.tsx").includes("header={header}"));
check("B5: no banner on an event that is not a surprise", banner.surpriseBannerText(session("plain")) === null);

// B8: the label for planners and the booking holder.
const spPl = (await pdb.findOrCreatePlanner({ name: "Pat Planner", company: "Bloom Events", phone: PLANNER_PHONE }, "Isabel")) as { ok: true; partner: import("../lib/partners/rules.ts").Partner };
await pdb.linkPlanner(S("sp1"), spPl.partner, { via: "staff", by: staffActor(ADMIN) });
const spTok = await signInPartner(PLANNER_PHONE);
const spView = await page.partnerEventView((await pdb.eventAccess(await asPartner(spTok, () => pauth.getCurrentPrincipal()), S("sp1").partner_key as string))!);
check("B8: planners see a Surprise event label on their event page", spView.surprise === true && src("app/partners/e/[key]/page.tsx").includes("Surprise event"));
check("B8: the booking holder sees it on their own event link", src("app/s/page.tsx").includes("SURPRISE_LABEL") && surprise.SURPRISE_LABEL === "Surprise event");

// B7: the block lifts 30 days after the event date.
const day30 = addDays(today, -30);
const day31 = addDays(today, -31);
db.sessions.push(session("lift30", { event_date: day30, ...NEW_COLS, is_surprise: true, honoree_phone: "+12145550190", honoree_name: "Ana Bell" }, { event_date: day30 }));
db.sessions.push(session("lift31", { event_date: day31, ...NEW_COLS, is_surprise: true, honoree_phone: "+12145550191", honoree_name: "Bo Cole" }, { event_date: day31 }));
texts.length = 0;
await sms.sendStaffText("+12145550190", "Ana", "Thanks for coming");
await sms.sendStaffText("+12145550191", "Bo", "Thanks for coming");
check("B7: day 30 after the event: still blocked", !texts.some((t) => t.phone === "+12145550190") && surprise.surpriseActive(S("lift30")));
check("B7: day 31: the block lifts and texts go out", texts.some((t) => t.phone === "+12145550191") && !surprise.surpriseActive(S("lift31")) && banner.surpriseBannerText(S("lift31")) === null);
const at = (ymd: string) => new Date(`${ymd}T18:00:00Z`);
check("B7: by the clock: in force through day 30, lifted on day 31", surprise.surpriseActive(S("sp1"), at(addDays(DAY, 30))) && !surprise.surpriseActive(S("sp1"), at(addDays(DAY, 31))) && (await guard.honoreeEventFor(HONOREE_PHONE, at(addDays(DAY, 31)))) === null);
check("B7: the post event follow up and review request respect it (GHL is told, and never gets the honoree's email)", src("lib/team/closeout-db.ts").includes("surprise_block: blocked") && src("lib/team/closeout-db.ts").includes("isHonoree(sx, { email: base.client_email }) ? null"));

// Turning it off, logged. (sp3 shares the number and is still a surprise.)
db.sessions = db.sessions.filter((x) => x.id !== "sp3");
await actions.staffBookingAction(MANAGER as never, S("sp1"), { action: "surprise", on: false });
check("B6: a manager turns Surprise off, logged", S("sp1").is_surprise === false && (db.partner_activity ?? []).some((a) => a.session_id === "sp1" && a.action === "Surprise turned off"));
texts.length = 0;
await sms.sendStaffText(HONOREE_PHONE, "Maya", "hi");
check("B6: ...and texts to that number go out again", texts.some((t) => t.phone === HONOREE_PHONE));
check("Surprise wording has no hyphens", [surprise.honoreeRefusal("client phone"), surprise.honoreeRefusal("day of contact"), surprise.honoreeRefusal("planner"), surprise.honoreeRefusal("host login"), surprise.HOST_SURPRISE_REFUSAL, surprise.PLANNER_SURPRISE_REFUSAL, surprise.surpriseBanner("Maya"), rules.LEAD_MOVED_WARNING].every(hyphenFree));

// =====================================================================
// 16. Part C: the client and a planner in the planning chat at the same time
// =====================================================================
const m = (role: string, content: string) => ({ role, content });
const merged1 = pchat.mergeChatTurns([m("user", "ctx"), m("user", "hi"), m("assistant", "A1"), m("user", "P1"), m("assistant", "R1")], [m("user", "ctx"), m("user", "hi"), m("assistant", "A1"), m("user", "C1"), m("assistant", "R2")]);
check("C: a save keeps the other person's latest turns and appends only the new ones", merged1.map((x) => x.content).join() === "ctx,hi,A1,P1,R1,C1,R2");
const merged2 = pchat.mergeChatTurns(merged1, [m("user", "ctx"), m("user", "hi"), m("assistant", "A1"), m("user", "C1"), m("assistant", "R2"), m("user", "C2")]);
check("C: a stale view never duplicates a turn", merged2.map((x) => x.content).join() === "ctx,hi,A1,P1,R1,C1,R2,C2");

reset();
db.sessions = [session("cw1", { status: "in_progress", version: 0, event_data: null, event_type: "Wedding", name: "Justin Reyes" })];
const cwP = (await pdb.findOrCreatePlanner({ name: "Lee Third", company: "Third Co", phone: PLANNER3_PHONE }, "Isabel")) as { ok: true; partner: import("../lib/partners/rules.ts").Partner };
await pdb.linkPlanner(S("cw1"), cwP.partner, { via: "staff", by: staffActor(ADMIN) });
const cwTok = await signInPartner(PLANNER3_PHONE);
const base3: Msg[] = [CTX, { role: "user", content: "Hi" }, { role: "assistant", content: "Hello! Who is the wedding for?" }];
db.conversation_logs = [{ id: "cl1", session_id: "cw1", messages: base3, updated_at: "2026-01-01T00:00:00.000Z" }];
ai.script.reply = (p) => [{ type: "text", text: `Reply to: ${lastUser(p)}` }];
const clientWrite = clientTurn("cw1", [...base3, { role: "user", content: "Client says tacos" }]);
const plannerWrite = asPartner(cwTok, () => partnerChatRoute.POST(new Request("http://plan.test/api/partners/chat", { method: "POST", body: JSON.stringify({ key: S("cw1").partner_key, text: "Planner says mezcal" }) })).then((r) => r.text()));
await Promise.all([clientWrite, plannerWrite]);
const cwLog = () => ((db.conversation_logs ?? []).find((c) => c.session_id === "cw1") as { messages: { role: string; content: string; by?: { partnerId?: string } }[] }).messages;
const cwText = cwLog().map((x) => x.content);
check(
  "C: two writers at once: every turn from both is kept",
  ["Client says tacos", "Reply to: Client says tacos", "Planner says mezcal", "Reply to: Planner says mezcal"].every((t) => cwText.includes(t)) && cwText.length === base3.length + 4,
  cwText.join(" | ")
);
check("C: ...and the planner's turn is still marked as theirs", cwLog().some((x) => x.content === "Planner says mezcal" && x.by?.partnerId === cwP.partner.id));
await clientTurn("cw1", [...base3, { role: "user", content: "Client says tacos" }, { role: "assistant", content: "Reply to: Client says tacos" }, { role: "user", content: "Client again" }]);
const cwText2 = cwLog().map((x) => x.content);
check("C: the client saving from a view without the planner's turns drops nothing and repeats nothing", cwText2.includes("Planner says mezcal") && cwText2.includes("Reply to: Planner says mezcal") && cwText2.includes("Client again") && cwText2.length === base3.length + 6 && new Set(cwText2).size === cwText2.length);
// A deterministic race: the planner's save lands between the client's read and the client's write.
const { guards } = await import("./fake-supabase.mts");
let raced = false;
guards.push((table, op, rows) => {
  if (raced || table !== "conversation_logs" || op !== "update" || rows[0]?.session_id !== "cw1") return null;
  raced = true;
  const row = rows[0] as { messages: Msg[]; updated_at: string };
  row.messages = [...row.messages, { role: "user", content: "Planner sneaks in" }, { role: "assistant", content: "Reply to: Planner sneaks in" }];
  row.updated_at = new Date(Date.now() + 5000).toISOString();
  return null;
});
await clientTurn("cw1", [...cwLog().filter((x) => !x.content.includes("sneaks")), { role: "user", content: "Client last word" }]);
guards.length = 0;
const cwText3 = cwLog().map((x) => x.content);
check("C: a save that races another save keeps both: the late writer reads again and appends", raced && cwText3.includes("Planner sneaks in") && cwText3.includes("Reply to: Planner sneaks in") && cwText3.includes("Client last word") && cwText3.includes("Reply to: Client last word") && new Set(cwText3).size === cwText3.length, cwText3.join(" | "));
check("C: the save reads the stored messages again and only lands if nobody saved in between", src("app/api/chat/route.ts").includes("mergeChatTurns(row.messages, messages)") && src("app/api/chat/route.ts").includes('q.eq("updated_at", row.updated_at)'));

// =====================================================================
// 17. Existing events are unchanged before the surprise migration
// =====================================================================
reset();
const pre = session("pre1", { host_name: "Jordan Lee", host_phone: HOST_PHONE, booking_holder: "planner", phone: PLANNER_PHONE }, { client_name: "Pat Planner", client_phone: PLANNER_PHONE });
db.sessions = [pre];
check("Before the migration: no surprise, no banner, no block", !surprise.surpriseActive(pre) && banner.surpriseBannerText(pre) === null && (await guard.honoreeEventFor(HOST_PHONE)) === null);
texts.length = 0;
await sms.sendStaffText(HOST_PHONE, "Jordan", "Hello");
check("...every text goes out as before", texts.some((t) => t.phone === HOST_PHONE));
const preTok = await signInPartner(HOST_PHONE);
check("...the host still signs in", preTok.length > 20);
check("...the Booking card loads and says surprise events are not set up yet", (await clientView.bookingCardData(S("pre1"), "admin")).surprise.ready === false && src("app/team/admin/e/[id]/booking-card.tsx").includes("Surprise events turn on once the surprise database update runs."));
check("...the Booking card still loads with neither migration run", await (async () => {
  for (const t of ["partners", "event_planners", "partner_activity", "price_approvals"]) missingTables.add(t);
  const c = await clientView.bookingCardData(S("pre1"), "admin");
  missingTables.clear();
  return c.ready === false && c.surprise.ready === false;
})());
check("...the opening question still reads the booking (a planner holds it: skipped)", !(await (async () => {
  db.sessions.push(session("pre2", { status: "in_progress", version: 0, event_data: null, booking_holder: "planner" }));
  ai.script.reply = () => [{ type: "text", text: "Hi" }];
  await clientTurn("pre2", [CTX, { role: "user", content: "Hi" }]);
  return sysText(ai.calls.at(-1)).includes(ROLE_Q);
})()));

done("partner portal");
