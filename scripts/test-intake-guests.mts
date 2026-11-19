// The booked guest count in the intake concierge, through the real chat route.
//
// From the live test on 2026-11-17 (session b6a5edcd): booked for 18 guests,
// the concierge asked "How many guests are you expecting?", the client said
// 100, and it saved 100 against a total priced for 18, with no quote, no price
// pending, and no alert. Now it confirms the booked count, prices a different
// one with the engine update mode uses, and flags any gap that slips through.
//
// Engine numbers used here (Full Bar, 4 hours): 18 and 17 guests are both
// $820 + $82 gratuity = $902; 100 guests needs 2 bartenders.
// Run: node --no-warnings scripts/test-intake-guests.mts

import { registerHooks } from "node:module";
import { addDays, check, done, hooks, texts } from "./team-harness.mts";

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
const prompt = await import("../lib/system-prompt.ts");
const facts = await import("../lib/booked-facts.ts");
const guests = await import("../lib/intake-guests.ts");
const updates = await import("../lib/event-updates.ts");
const bwdb = await import("../lib/booking-webhook-db.ts");
const bw = await import("../lib/booking-webhook.ts");
const alertsDb = await import("../lib/unsaved-sessions-db.ts");
const popDb = await import("../lib/popular-drinks-db.ts");
const chat = await import("../app/api/chat/route.ts");

const today = time.chicagoToday();
const eventDate = addDays(today, 60);
const admin = { id: "admin-1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true };
const NOW = new Date();

// The booked price as /api/create-session now records it, basis included.
const booking = bw.readBooking({ name: "Kenny Test", email: "k@example.com", event_date: eventDate, start_time: "6:00 PM", package_type: "Full Bar", guest_count: "18", event_type: "Social Gathering", hours_booked: "4", bartender_count: "1", total_price: "$902", gratuity: "$82", package_price: "$820" });
const bookedPrice = bwdb.bookedPriceFrom(booking, NOW.toISOString())!;

function session(top: Record<string, unknown> = {}) {
  return {
    id: "k1",
    name: "Kenny Test",
    status: "in_progress",
    version: 0,
    event_data: null,
    event_date: eventDate,
    package_type: "Full Bar",
    guest_count: "18",
    hours_booked: "4",
    event_type: "Social Gathering",
    bar_service_start: "6:00 PM",
    bartender_count: 1,
    booked_price: bookedPrice,
    ...top,
  } as Record<string, unknown>;
}

function reset(s: Record<string, unknown>) {
  for (const k of Object.keys(db)) delete db[k];
  db.staff = [admin];
  db.sessions = [s];
  db.conversation_logs = [{ session_id: s.id, messages: [], status: "in_progress" }];
  db.event_updates = [];
  db.events = [];
  db.team_settings = [];
  db.team_hidden_events = [];
  texts.length = 0;
  hooks.length = 0;
  ai.calls.length = 0;
  popDb.forgetPopularDrinks();
}

const ctx = `${facts.CONTEXT_PREFIX} Client name: Kenny Test, Package: Full Bar, Guest count: 18, Event type: Social Gathering, Hours of bar service booked: 4, Bar service start time booked: 6:00 PM, Bartenders booked: 1. Use this info and do not re-ask for it.`;

async function turn(history: { role: string; content: string }[], id = "k1"): Promise<string> {
  const res = await chat.POST(new Request("http://plan.test/api/chat", { method: "POST", body: JSON.stringify({ messages: history, sessionId: id }) }));
  let reply = "";
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const ev = JSON.parse(line.slice(6)) as { text?: string; error?: string };
    if (ev.error) throw new Error(ev.error);
    if (ev.text) reply += ev.text;
  }
  return reply;
}

/** The TOOL RESULT the bot got for quote_guest_count on its follow up turn. */
function quoteResult(): string {
  const follow = ai.calls.find((c) => c.tool_choice?.type === "none");
  const last = follow?.messages[follow.messages.length - 1].content as { content: string }[] | undefined;
  return last?.map((b) => b.content).join("\n") ?? "";
}

// The model: asks to price whatever number the client gives, then reads the tool result back.
function quotingModel(n: number) {
  ai.script.reply = (p) => {
    if (p.tool_choice?.type === "none") return [{ type: "text", text: "Here is where that lands." }];
    return [{ type: "text", text: "Let me get a price on that for you! " }, ai.toolUse("quote_guest_count", { guest_count: n })];
  };
}

function submitting(input: Record<string, unknown>) {
  ai.script.reply = () => [
    { type: "text", text: "Thank you so much, Kenny! Please hang tight while we gather all your details together!" },
    ai.toolUse("submit_event_data", { client_name: "Kenny Test", package: "Full Bar", event_date: eventDate, signature_drinks: [], ...input }),
  ];
}

const s1 = () => db.sessions[0] as Record<string, unknown> & { event_data: Record<string, unknown>; booked_price: Record<string, unknown> };
const flagged = async () => (await alertsDb.saveAlerts()).guestCount.length;

// ---------- 1. The prompt: confirm the booked count, never ask ----------

const P = prompt.buildIntakePrompt(null, NOW, { booked: { ...facts.NO_BOOKED_FACTS, guests: 18 } });
check("A booked guest count is stated and confirmed once, not asked", P.includes('"You are booked for 18 guests, is that still right?"') && P.includes("Do NOT ask how many guests they are expecting"));
check("...the Phase 1 checklist confirms instead of asking", !P.includes(prompt.ASK_GUESTS_ITEM) && P.includes("Confirm the booked guest count"));
check("...and the old 'How many guests are you expecting' rule is replaced", !P.includes(prompt.GUEST_COUNT_HANDLING) && !/ask the client: "How many guests are you expecting\?"/.test(P));
check("...a different number is priced with quote_guest_count, and a quote needs a clear yes", P.includes("call quote_guest_count with that number") && P.includes("On a no, keep guest_count 18"));
const plain = prompt.buildIntakePrompt(null, NOW);
check("With no booked count it asks as it does today", plain.includes(prompt.ASK_GUESTS_ITEM) && plain.includes(prompt.GUEST_COUNT_HANDLING));
check("A booked range is its higher end", facts.bookedGuestCount("50-75") === 75 && facts.bookedGuestCount("50 to 75") === 75 && facts.bookedGuestCount("") === null);

reset(session());
ai.script.reply = () => [{ type: "text", text: "Hey Kenny! You are booked for 18 guests, is that still right?" }];
await turn([{ role: "user", content: ctx }, { role: "user", content: "Hey! I just booked." }]);
const sys = (ai.calls[0].system as { text: string }[])[0].text;
const toolNames = (ai.calls[0].tools as { name: string }[]).map((t) => t.name);
check("The chat route sends the booked count and the quote tool", sys.includes("BOOKED GUEST COUNT: 18") && toolNames.includes("quote_guest_count"));
reset(session());
await turn([{ role: "user", content: ctx }, { role: "user", content: "Hey!" }], "nosuch");
check("A chat with no session row gets no quote tool and no confirm rule", !(ai.calls[0].tools as { name: string }[]).some((t) => t.name === "quote_guest_count") && !(ai.calls[0].system as { text: string }[])[0].text.includes("BOOKED GUEST COUNT"));

// ---------- 2. Confirmed: save it and move on ----------

reset(session());
submitting({ guest_count: 18 });
await turn([{ role: "user", content: "That is everything." }]);
check("The confirmed booked count is saved as is", s1().status === "submitted" && s1().event_data.guest_count === 18 && db.event_updates.length === 1);
check("...with no flag", (await flagged()) === 0);

// ---------- 3a. Same price: save the new count and move on ----------

reset(session());
quotingModel(17);
let reply = await turn([{ role: "user", content: "Actually 17." }]);
check("3a. The same price is told as no price change", /NO PRICE CHANGE/.test(quoteResult()) && /send guest_count 17/.test(quoteResult()));
check("...and the price filler never reaches the client", !reply.includes("Let me get a price"));
submitting({ guest_count: 17 });
await turn([{ role: "user", content: "That is everything." }]);
check("3a. At submission the new count is saved", s1().event_data.guest_count === 17 && s1().guest_count === "17");
check("...as an update with no money change, the total unchanged", db.event_updates.length === 2 && (db.event_updates[1].change_order as Record<string, unknown>)?.amount === 0 && s1().booked_price.total === 902);
check("...and no flag", (await flagged()) === 0 && !s1().price_pending);

// ---------- 3b. A new price: quote, clear yes, then apply ----------

reset(session());
quotingModel(100);
await turn([{ role: "user", content: "We are expecting 100 now." }]);
const q100 = quoteResult();
const priced = guests.quoteGuestCount(s1() as never, 100)!;
check("3b. A different count that changes the price is quoted, nothing saved", /QUOTE, NOTHING SAVED/.test(q100) && q100.includes(`new_total: ${priced.price!.new_total}`) && s1().status === "in_progress");
check("...with the difference and a yes or no question", q100.includes(`difference: ${priced.price!.amount}`) && /one yes or no question/.test(q100));
check("4. More bartenders than booked is part of the quote", /100 guests needs 2 bartenders instead of 1/.test(q100) && priced.bartenders === "Needs 2 bartenders for 100 guests, booked with 1.");
check("...and the quote is priced against what was booked (the basis), $902 at 18 guests", priced.price!.booked_total === 902 && priced.price!.amount! > 0);

submitting({ guest_count: 100, guest_count_quoted_total: priced.price!.new_total });
await turn([{ role: "user", content: "Yes, go ahead." }]);
check("3b. On a yes it is applied as an update with the change order", s1().event_data.guest_count === 100 && db.event_updates.length === 2 && (db.event_updates[1].change_order as Record<string, unknown>)?.new_total === priced.price!.new_total);
check("...the booked price moves to the new total, bartenders to 2", s1().booked_price.total === priced.price!.new_total && s1().event_data.bartenders === 2);
check("...the GHL update goes out with the difference", hooks.some((h) => h.url === "https://hooks.test/update"));
check("...the quoted total never lands in event_data", !("guest_count_quoted_total" in s1().event_data));
check("...and no flag", (await flagged()) === 0);

reset(session());
submitting({ guest_count: 18 });
await turn([{ role: "user", content: "No, keep it at 18." }]);
check("3b. On a no the booked count is kept", s1().event_data.guest_count === 18 && db.event_updates.length === 1 && s1().booked_price.total === 902);

// ---------- 3c. Cannot be priced: save, price pending, one admin text ----------

const essentials = session({ package_type: "Essentials Bar", booked_price: { ...bookedPrice, basis: null } });
reset(essentials);
quotingModel(100);
reply = await turn([{ role: "user", content: "Make it 100." }]);
check("3c. The engine cannot price it: the bot says management will confirm", /PRICE PENDING/.test(quoteResult()) && /Our management team will get the price/.test(quoteResult()) && !/QUOTE/.test(quoteResult()));
check("...and nothing is texted before the client finishes", texts.length === 0);
submitting({ package: "Essentials Bar", guest_count: 100 });
await turn([{ role: "user", content: "That is everything." }]);
check("3c. At submission the new count is saved", s1().event_data.guest_count === 100 && s1().guest_count === "100");
check("...the event is marked price pending", s1().price_pending === true);
check("...the admins get one text", texts.filter((t) => t.message.startsWith("Price needed")).length === 1);
check("4. ...which says more bartenders are needed", texts[0]?.message.includes("Needs 2 bartenders for 100 guests, booked with 1."));
check("...and no guest count flag while the price is pending", (await flagged()) === 0);

// ---------- 5. The basis on the booked price ----------

check("5. A booking records what its total was priced for", JSON.stringify(bookedPrice.basis) === JSON.stringify({ package: "Full Bar", guests: 18, hours: 4, isWedding: false, bartenders: 1, tipJar: true, woodenBar: true, barback: true }));
const ranged = bwdb.bookedPriceFrom(bw.readBooking({ name: "A", package_type: "Premium Bar", guest_count: "50-75", hours_booked: "5", total_price: "$3000" }), NOW.toISOString())!;
check("...a range is its higher end, and bartenders follow the guests when none were sent", ranged.basis?.guests === 75 && ranged.basis?.hours === 5 && ranged.basis?.bartenders === 1);
check("...a retired package has no basis", bwdb.bookedPriceFrom(bw.readBooking({ name: "A", package_type: "Essentials Bar", guest_count: "50", hours_booked: "4", total_price: "$900" }), NOW.toISOString())!.basis === null);
// The gap from the live test: event_data says 100, the total was for 18. A later change is priced from 18, not 100.
reset(session({ status: "submitted", version: 1, event_data: { client_name: "Kenny Test", package: "Full Bar", event_date: eventDate, guest_count: 100, bar_service_start: "6:00 PM", bar_service_end: "10:00 PM", bartenders: 1 } }));
const later = await updates.quoteEventUpdate("k1", { guest_count: 120 });
check("...so a later change is priced against the booked event, not the saved one", later?.price?.booked_total === 902 && later?.price?.new_total === 902 + (later?.price?.amount ?? 0) && (later?.price?.amount ?? 0) > 1749 - 902);

// ---------- 6. The safety net ----------

reset(session());
submitting({ guest_count: 100 }); // a new count with no confirmed quote
await turn([{ role: "user", content: "That is everything." }]);
check("6. A new count with no confirmed quote is saved without a price change", s1().event_data.guest_count === 100 && s1().booked_price.total === 902 && db.event_updates.length === 1);
const flag = guests.guestCountFlag(s1() as never);
check("...and flagged for admins", flag?.booked === 18 && flag?.current === 100 && /No price change was applied or is pending/.test(flag.text));
check("...in the Staffing alerts", (await flagged()) === 1 && (await alertsDb.saveAlerts()).guestCount[0].sessionId === "k1");
db.team_hidden_events.push({ session_id: "k1" });
check("...not for a hidden event", (await flagged()) === 0);
check("No flag when the counts match, a range counts as its higher end", guests.guestCountFlag({ status: "submitted", guest_count: "50-75", event_data: { guest_count: 75 }, price_pending: false }) === null);
check("No flag while the price is pending", guests.guestCountFlag({ status: "submitted", guest_count: "18", event_data: { guest_count: 100 }, price_pending: true }) === null);
check("No flag before the event is submitted", guests.guestCountFlag({ status: "in_progress", guest_count: "18", event_data: null, price_pending: false }) === null);

done("intake guest count");
