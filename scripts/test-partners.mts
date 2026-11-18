// Partner portal, phase 1: planners. Partner login apart from staff in both
// directions, planners seeing only their linked events, several planners with
// one Lead, switching planners, who sees money and who approves a price
// change, hosts, the three ways of linking, the one tap remove link,
// deactivation, a planner finishing the planning chat, the planner title rule,
// and existing events unchanged.
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
check("The event page has the client and contact, times, venue, package, guests, drinks and deadlines", view1.eventFor.name === "Justin Reyes" && view1.eventFor.phone === CLIENT_PHONE && view1.serviceTimes === "6:00 PM to 10:00 PM" && view1.arrival === "3:00 PM" && view1.breakdown === "11:00 PM" && view1.package === "Full Bar" && view1.guestCount === "80" && view1.drinks.length === 1 && !!view1.deadlines.lastDrinkChange && view1.packageIncludes.length > 0);
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
check("...and then the host sees the total and balance only", !!hostView2.pricing?.total && hostView2.pricing.payments.length === 0 && hostView2.pricing.agreements.length === 0);
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
texts.length = 0;
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
check("The planning chat asks once: yourself or a planner booking for a client", concierge.includes('"Are you planning this for yourself, or are you a planner booking for a client?" Ask it only once in the whole chat.') && concierge.includes("Are you working with an event planner?"));
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

done("partner portal");
