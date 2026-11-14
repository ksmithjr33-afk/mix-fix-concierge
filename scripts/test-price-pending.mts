// A change the pricing engine cannot price is saved anyway and marked price
// pending. This runs the exact conversation from 2026-11-13 (Candice, legacy
// Essentials Bar, upgrading to Full Bar, event inside six days, no booked
// total) through the real chat route, with a model that behaves the way it
// did that day: "Let me get a price" before every tool call, a new quote on
// every "yes", and a "Just to confirm" question whenever a tool result asks
// for a yes or no question. It asserts: package saved as Full Bar, price
// pending set with the summary, one admin text, one client message about the
// price, no repeated confirmation, no price filler, no change order and no
// charge until an admin sets the total, then the normal change order flow.
// Run: node --no-warnings scripts/test-price-pending.mts

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

process.env.GHL_UPDATE_WEBHOOK_URL = "https://hooks.test/update";

const { db } = await import("./fake-supabase.mts");
const ai = await import("./fake-anthropic.mts");
const time = await import("../lib/team/time.ts");
const pp = await import("../lib/price-pending.ts");
const ppdb = await import("../lib/price-pending-db.ts");
const updates = await import("../lib/event-updates.ts");
const alertsDb = await import("../lib/unsaved-sessions-db.ts");
const { UPDATE_OPENER } = await import("../lib/update-mode-shared.ts");
const chat = await import("../app/api/chat/route.ts");

const today = time.chicagoToday();
const admin = { id: "admin-1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true };
const admin2 = { id: "admin-2", name: "Kenny Smith", phone: "+12145550102", role: "admin", active: true };

function candice(top: Record<string, unknown> = {}) {
  return {
    id: "cand1",
    name: "Candice McConnell",
    email: "candice@example.com",
    status: "submitted",
    version: 1,
    event_date: addDays(today, 1),
    package_type: "Essentials Bar",
    guest_count: "80",
    hours_booked: "4",
    booked_price: null,
    submitted_at: new Date().toISOString(),
    event_data: {
      client_name: "Candice McConnell",
      email: "candice@example.com",
      event_type: "Birthday",
      event_date: addDays(today, 1),
      bar_service_start: "6:00 PM",
      bar_service_end: "10:00 PM",
      event_address: "100 Main St, Dallas, TX 75201",
      guest_count: 80,
      package: "Essentials Bar",
      payment_preference: "Auto charge on due date",
      signature_drinks: [],
    },
    ...top,
  } as Record<string, unknown>;
}

function reset(session: Record<string, unknown>) {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [admin, admin2];
  db.sessions = [session];
  db.event_updates = [{ id: "u1", session_id: session.id, version: 1, source: "concierge", changes: [], summary: "Initial submission", within_deadline: true, applied: true, webhook_sent: true, created_at: new Date().toISOString() }];
  db.conversation_logs = [{ session_id: session.id, messages: [], update_messages: [] }];
  db.team_settings = [];
  texts.length = 0;
  hooks.length = 0;
}

// The model as it behaved that day.
const FILLER = "Let me get a price on that for you right now! ";
ai.script.reply = (p) => {
  if (p.tool_choice?.type === "none") {
    // Follow up turn: do what the TOOL RESULT says.
    const last = p.messages[p.messages.length - 1].content as { content: string }[];
    const result = last.map((b) => b.content).join("\n");
    const exact = /Say exactly, once: "([^"]+)"/.exec(result);
    if (exact) return [{ type: "text", text: `${exact[1]} Anything else you would like to change?` }];
    if (/ALREADY SAVED/.test(result)) return [{ type: "text", text: "Your Full Bar upgrade is already saved. Anything else you would like to change?" }];
    if (/yes or no question/.test(result)) return [{ type: "text", text: "Our team will need to confirm the pricing on that upgrade. Just to confirm, you want to switch from Essentials Bar to Full Bar?" }];
    return [{ type: "text", text: "Anything else you would like to change?" }];
  }
  const user = String(p.messages[p.messages.length - 1].content).toLowerCase();
  if (user === "no") return [{ type: "text", text: "Got it, Candice! Thank you, and enjoy your event." }];
  if (user.startsWith("yes please")) return [{ type: "text", text: FILLER }, ai.toolUse("update_event_data", { package: "Full Bar", quoted_new_total: 115 })];
  return [{ type: "text", text: FILLER }, ai.toolUse("quote_price_change", { package: "Full Bar" })];
};

/** One turn through the real route: returns the reply the client sees. */
async function turn(history: { role: string; content: string }[], text: string): Promise<string> {
  history.push({ role: "user", content: text });
  const res = await chat.POST(new Request("http://plan.test/api/chat", { method: "POST", body: JSON.stringify({ messages: history, sessionId: "cand1", chatStartVersion: 1 }) }));
  const body = await res.text();
  let reply = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const ev = JSON.parse(line.slice(6)) as { text?: string; error?: string };
    if (ev.error) throw new Error(ev.error);
    if (ev.text) reply += ev.text;
  }
  history.push({ role: "assistant", content: reply.trim() });
  return reply.trim();
}

// ===== The conversation =====
reset(candice());
const history: { role: string; content: string }[] = [{ role: "user", content: UPDATE_OPENER }];
const replies: string[] = [];
for (const said of ["need to upgrade to full bar", "yes, it was an extra $115", "Yes", "Yes please, upgrade to full bar", "no"]) replies.push(await turn(history, said));

const s = db.sessions[0] as Record<string, unknown> & { event_data: Record<string, unknown>; price_pending_info: import("../lib/price-pending.ts").PricePendingInfo };
check("The package is saved as Full Bar on the first turn", (s.event_data.package as string) === "Full Bar" && s.package_type === "Full Bar" && db.event_updates.filter((u) => u.applied && u.version === 2).length === 1);
check("Saved once: one update row for the upgrade, no second save", db.event_updates.length === 2 && s.version === 2, `${db.event_updates.length} rows, v${s.version}`);
check("The event is price pending", s.price_pending === true && !!s.price_pending_at);
const info = s.price_pending_info;
check("The summary has the change, old and new package, old total, and the client's quote", info.old_package === "Essentials Bar" && info.new_package === "Full Bar" && info.old_total === null && info.client_quoted === "$115" && pp.pendingSummary(info).includes("Package: from Essentials Bar to Full Bar"), pp.pendingSummary(info));
check("One admin text per admin, once", texts.length === 2 && new Set(texts.map((t) => t.phone)).size === 2, JSON.stringify(texts));
const t = texts[0]?.message ?? "";
check("The admin text has the client, the date, the change, Price needed, and the manager view link", t.startsWith("Price needed: Candice McConnell on ") && t.includes(time.shortDate(addDays(today, 1))) && t.includes("Package: from Essentials Bar to Full Bar") && t.includes("https://plan.test/team/admin/e/cand1"), t);
const aboutPrice = replies.filter((r) => /management team will get the price|new total/i.test(r));
check("One client message about the price", aboutPrice.length === 1 && replies[0].includes(pp.PRICE_PENDING_CLIENT_MESSAGE), JSON.stringify(replies));
check("It asks if they want to change anything else", replies[0].endsWith("Anything else you would like to change?"));
check("Zero confirmation questions", replies.every((r) => !/just to confirm|should i make that change|confirm you want/i.test(r)), JSON.stringify(replies));
check("No price filler reaches the client", replies.every((r) => !/let me get|let me price|get that quoted/i.test(r)), JSON.stringify(replies));
check("Later turns acknowledge it is saved", replies[1].includes("already saved") && replies[3].includes("already saved"));
check("No total is ever stated to the client", replies.every((r) => !/\$\d/.test(r)));
const saved = (db.conversation_logs[0].update_messages as { content: string }[]).map((m) => m.content).join("\n");
check("The saved chat has no filler either", !/let me get a price/i.test(saved));

// No change order, no charge.
const payloads = hooks.filter((h) => h.url === "https://hooks.test/update").map((h) => h.body);
check("GHL got the update with price_pending and the summary", payloads.length === 1 && payloads[0].price_pending === "Yes" && String(payloads[0].price_pending_summary).includes("Essentials Bar to Full Bar"));
check("No change order or charge: every money field is blank", payloads.every((p) => p.pending_change_amount === null && p.pending_change_new_total === null && p.booked_total === null && p.pending_change_gratuity === null));
check("No new total in the payload text", payloads.every((p) => !/\$\d/.test(String(p.pending_change_price_text))));
const prompts = ai.calls.map((c) => JSON.stringify(c.system));
check("Once pending, the concierge's prompt says so and has no balance amount", prompts.slice(-2).every((p) => p.includes("PRICE PENDING:") && !p.includes("Your remaining balance is now $")));

// ===== Staffing alert and the manager view =====
const alerts = await alertsDb.saveAlerts();
check("The Staffing page lists it under Price needed", alerts.pricePending.length === 1 && alerts.pricePending[0].sessionId === "cand1" && alerts.pricePending[0].name === "Candice McConnell");
const page = src("app/team/admin/e/[id]/page.tsx");
check("The manager view shows the Price needed card at the top of Details", page.includes("{session.price_pending && (") && page.indexOf("<PriceNeededCard") < page.indexOf("<ClockStatus"));
check("Bartenders cannot set a price", (await ppdb.setPendingPrice("cand1", 1865, { id: "b1", name: "Sam Lee", role: "bartender" })).ok === false && s.price_pending === true);
const routeSrc = src("app/api/team/admin/price-pending/route.ts");
check("The price route checks admin on the server", routeSrc.includes('staff.role !== "admin"') && routeSrc.indexOf("getCurrentStaff()") < routeSrc.indexOf("setPendingPrice("));
check("A bad total is refused", (await ppdb.setPendingPrice("cand1", "abc", admin)).ok === false);

hooks.length = 0;
const set = await ppdb.setPendingPrice("cand1", "$1,865", admin);
const after = db.sessions[0] as Record<string, unknown> & { booked_price: { total: number } };
check("Saving the total clears price pending and records who set it", set.ok && after.price_pending === false && after.price_set_by === "admin-1" && after.price_set_by_name === "Isabel Jones" && after.price_set_total === 1865 && after.booked_price.total === 1865);
const co = hooks.filter((h) => h.url === "https://hooks.test/update").map((h) => h.body);
check("Then the normal change order flow: GHL gets the new total and the payment preference", co.length === 1 && co[0].price_pending === "No" && co[0].pending_change_new_total === 1865 && co[0].booked_total === 1865 && co[0].payment_preference === "Auto charge on due date" && String(co[0].pending_change_summary).includes("Essentials Bar"), JSON.stringify(co[0] ?? {}).slice(0, 300));
check("Setting it twice is refused", (await ppdb.setPendingPrice("cand1", 1900, admin)).ok === false);
check("The Staffing alert clears", (await alertsDb.saveAlerts()).pricePending.length === 0);

// ===== Every change type, and legacy packages with a booked total =====
reset(candice({ booked_price: { total: 1200, package_price: 1050, gratuity: 150, bartenders: 1, promo_code: null, custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: 150, source: "create-session" } }));
const guests = await updates.applyEventUpdate("cand1", { guest_count: 120 }, {});
check("A guest count change on a legacy package with a booked total is saved and price pending (no engine row for the old package)", (db.sessions[0] as { event_data: { guest_count: number } }).event_data.guest_count === 120 && guests?.pricePending?.fresh === true && guests.pricePending.info.old_total === 1200);
check("The booked total is left alone while pending", (db.sessions[0] as { booked_price: { total: number } }).booked_price.total === 1200);
const hours = await updates.applyEventUpdate("cand1", { bar_service_end: "11:00 PM" }, {});
check("A second unpriced change adds to the same pending summary", hours?.pricePending?.fresh === true && hours.pricePending.info.items.length === 2 && hours.pricePending.info.old_total === 1200);

// A priceable event that is already pending stays pending: its base total is unknown.
reset(candice({ package_type: "Full Bar", event_data: { ...(candice().event_data as object), package: "Full Bar" }, booked_price: { total: 1900, package_price: 1700, gratuity: 200, bartenders: 2, promo_code: null, custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: 150, source: "create-session" }, price_pending: true, price_pending_info: { items: [], old_package: "Essentials Bar", new_package: "Full Bar", old_total: null, client_quoted: null, reason: "x" } }));
const q = await updates.quoteEventUpdate("cand1", { guest_count: 100 });
check("While pending, a change that would normally price is not priced", q?.price?.new_total === null);
reset(candice({ package_type: "Full Bar", event_data: { ...(candice().event_data as object), package: "Full Bar", event_date: addDays(today, 30) }, booked_price: { total: 1900, package_price: 1700, gratuity: 200, bartenders: 2, promo_code: null, custom_price: null, discount_amount: null, tip_jar: true, deposit_paid: 150, source: "create-session" } }));
const priced = await updates.quoteEventUpdate("cand1", { guest_count: 100 });
check("A Full Bar booking with a booked total still prices normally", typeof priced?.price?.new_total === "number" && priced!.price!.new_total! > 1900);

// ===== The filler filter =====
const out: string[] = [];
const f = pp.createFillerFilter((x) => out.push(x));
for (const piece of ["Let me get a price", " on that for you right now! Your change is", " saved. Let me get that quoted properly for you! Anything else?"]) f.push(piece);
f.finish();
check("Price filler sentences are dropped, everything else passes", out.join("") === "Your change is saved. Anything else?", JSON.stringify(out.join("")));
check("Filler examples from that day", ["Let me get a price on that for you right now!", "Let me get that quoted properly for you!", "Let me price that upgrade for you!", "Let me get the exact price on that right now!", "Okay, let me get that quoted for you now."].every(pp.isPriceFiller));
check("Real sentences are kept", ["I will pass that along to our management team.", "Let me know if you want to change anything else.", "Your new total is $1,865.", "The difference is $240, which brings your new total to $1,989."].every((x) => !pp.isPriceFiller(x)));
check("A client's quoted price is read from what they wrote", pp.quotedAmount("yes, it was an extra $115") === "$115" && pp.quotedAmount("about $1,200.50 total") === "$1,200.50" && pp.quotedAmount("no") === null);

done("price pending");
