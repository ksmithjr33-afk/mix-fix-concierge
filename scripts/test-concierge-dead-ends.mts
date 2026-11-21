// The intake concierge after the 2026-11-21 live failure (a Premium Bar
// friends Christmas party, 60 guests):
//  1. Four replies acknowledged an answer and stopped, so the client had to type
//     "Yes" or "What's next". Every reply before the wrap up now ends with the
//     next unanswered question, worked out in code when the model leaves it out.
//  2. The closing went out without submit_event_data, nothing was saved, and the
//     concierge later said "Your details have been submitted". The save is now
//     forced, the client hears only the real result, skipped drinks still submit
//     (Drinks not finalized) and a failed save tells the client and the admins.
//  3. Questions that did not fit the booking: the role question on a holiday
//     party, the name the booking had, a second bar on "possibly both", a bar on
//     site on Premium, and a 4th drink never confirmed.
//  4. Booking fields: the text "null" (how GHL sends an empty field) is missing
//     everywhere, missing fields are logged at session creation, and the opening
//     confirms what the booking already told us.
// Ends with a replay of that chat (anonymized) through the real chat route.
// Run: node --no-warnings scripts/test-concierge-dead-ends.mts

import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { check, done, hooks, src, texts } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@anthropic-ai/sdk") return nextResolve(new URL("./fake-anthropic.mts", import.meta.url).href, context);
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db, guards } = await import("./fake-supabase.mts");
const ai = await import("./fake-anthropic.mts");
const plan = await import("../lib/intake-plan.ts");
const blank = await import("../lib/blank.ts");
const bw = await import("../lib/booking-webhook.ts");
const facts = await import("../lib/booked-facts.ts");
const ctxMsg = await import("../lib/partners/intake-context.ts");
const markets = await import("../lib/team/markets.ts");
const eu = await import("../lib/event-updates.ts");
const unsaved = await import("../lib/unsaved-sessions.ts");
const prompt = await import("../lib/system-prompt.ts");
const pchat = await import("../lib/partners/chat.ts");
const chat = await import("../app/api/chat/route.ts");
const createSession = await import("../app/api/create-session/route.ts");

type Msg = { role: string; content: string };
const replay = JSON.parse(readFileSync(new URL("./fixtures/holiday-party-replay.json", import.meta.url), "utf8")) as { messages: Msg[] };
const R = replay.messages;
const CLOSING = R[66].content;

const ADMIN = { id: "a1", name: "Isabel Jones", phone: "+12145550100", role: "admin", active: true, alerts: true };
const SESSION = {
  id: "hp1",
  name: "Sam T Rivers",
  email: "sam@example.com",
  event_date: "null", // exactly as the booking sent it
  package_type: "Premium Bar",
  guest_count: "60",
  event_name: "Social Gathering",
  hours_booked: "5",
  status: "in_progress",
  version: 0,
  event_data: null,
  booking_holder: "client",
  planner_asked: false,
  is_surprise: false,
  planning_role: null,
  package_extras: {},
  booked_price: null,
};

function reset(extra: Record<string, unknown> = {}) {
  for (const k of Object.keys(db)) delete db[k];
  guards.length = 0;
  db.sessions = [{ ...SESSION, ...extra }];
  db.conversation_logs = [];
  db.event_updates = [];
  db.events = [];
  db.team_settings = [];
  db.team_hidden_events = [];
  db.staff = [{ ...ADMIN }];
  db.popular_drinks = [];
  hooks.length = 0;
  texts.length = 0;
  ai.calls.length = 0;
}
const S = () => db.sessions[0] as Record<string, unknown>;
const ED = () => S().event_data as Record<string, unknown> | null;
const adminTexts = () => texts.filter((t) => t.phone === ADMIN.phone).map((t) => t.message);

async function turn(history: Msg[], sessionId = "hp1"): Promise<{ reply: string; events: string[] }> {
  const res = await chat.POST(new Request("http://plan.test/api/chat", { method: "POST", body: JSON.stringify({ messages: history, sessionId, clientName: "Sam T Rivers", email: "sam@example.com" }) }));
  let reply = "";
  const events: string[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const ev = JSON.parse(line.slice(6)) as { text?: string; error?: string; event?: string };
    if (ev.error) events.push(`error:${ev.error}`);
    if (ev.event) events.push(ev.event);
    if (ev.text) reply += ev.text;
  }
  return { reply, events };
}
const storedLast = () => ((db.conversation_logs[0] as { messages: Msg[] } | undefined)?.messages ?? []).at(-1)?.content ?? "";

const PAYLOAD = {
  client_name: "Sam and Dana Rivers",
  email: "sam@example.com",
  event_type: "Christmas Gift Exchange",
  event_name: "2nd Annual Christmas Gift Exchange",
  event_date: "December 11, 2026",
  venue_type: "private_residence",
  bar_service_start: "6:30 PM",
  bar_service_end: "11:30 PM",
  event_address: "100 Elm St, Argyle, TX 76226",
  indoor_outdoor: "Outdoor, covered patio",
  bar_floor_access: "downstairs",
  bar_on_site: "Bringing the wooden bar",
  parking_info: "They will keep the team from getting blocked in",
  guest_count: 60,
  drinking_pace: "Moderate",
  theme: "2nd Annual Christmas Gift Exchange",
  event_colors: "Champagne gold and white",
  menu_colors: "Champagne gold and white",
  allergies: [],
  day_of_contact_name: "Dana Rivers",
  day_of_contact_phone: "214-555-0199",
  package: "Premium Bar",
  signature_drinks: [
    { name: "Mistletoe Mojito", base_spirit: "rum" },
    { name: "White Christmas Margarita", base_spirit: "tequila" },
    { name: "North Pole Espresso Martini", base_spirit: "vodka" },
    { name: "Christmas Bourbon Old Fashioned", base_spirit: "bourbon" },
  ],
  drinks_finalized: false,
  beer: true,
  wine: true,
  payment_preference: "Payment link",
};
const RECIPE = { ingredients: ["2 oz vodka", "1 oz lime juice"] };

// =====================================================================
// 1. Every reply before the wrap up ends with the next question
// =====================================================================

// The live turn: "Guest of honor", then "Love it, ..." with save_planning_role and no question.
reset({ event_name: "Birthday" });
ai.script.reply = (p) =>
  p.tool_choice?.type === "none"
    ? [{ type: "text", text: "What time would you like bar service to start?" }]
    : [{ type: "text", text: R[6].content }, ai.toolUse("save_planning_role", { role: "guest_of_honor" })];
let t = await turn(R.slice(0, 6));
check("A save with words and no question no longer stops there: the model is asked to continue", ai.calls.length === 2 && ai.calls[1].tool_choice?.type === "none" && JSON.stringify(ai.calls[1].messages).includes("TOOL RESULT"));
check("...and the reply ends with the next question", plan.hasQuestion(t.reply) && t.reply.startsWith("Love it") && t.reply.endsWith("start?"), t.reply);
check("...the role was still saved", S().planning_role === "guest_of_honor");

// A save whose words already ask the next question: no second turn.
reset({ event_name: "Birthday" });
ai.script.reply = () => [{ type: "text", text: "Love it! What date is your event?" }, ai.toolUse("save_planning_role", { role: "guest_of_honor" })];
t = await turn(R.slice(0, 6));
check("A save whose reply already asks the next question needs no second turn", ai.calls.length === 1 && t.reply === "Love it! What date is your event?");

// A plain reply with no question (the theme message): regenerated with the real next item named.
reset();
const themeHistory = [...R.slice(0, 42)];
ai.script.reply = (p) => (p.tool_choice?.type === "none" ? [{ type: "text", text: "For your cocktail menu design, what colors are you going with?" }] : [{ type: "text", text: R[42].content }]);
t = await turn(themeHistory);
const regen = JSON.stringify(ai.calls[1]?.messages ?? "");
check("A reply with no question is regenerated, naming the next unanswered item worked out in code (the colors)", ai.calls.length === 2 && regen.includes("NEXT QUESTION CHECK") && regen.includes("the colors"), regen.slice(-400));
check("...and the client gets the acknowledgement and the question in one reply", t.reply.startsWith("I love that") && t.reply.endsWith("going with?"), t.reply);

// The regenerate still has no question: the code asks the real next question itself.
reset();
ai.script.reply = (p) => (p.tool_choice?.type === "none" ? [{ type: "text", text: "Sounds great!" }] : [{ type: "text", text: R[42].content }]);
t = await turn(themeHistory);
check("If the model still asks nothing, the next unanswered question is added word for word (the colors)", t.reply.endsWith("What colors are you going with for your event? We will use these for your cocktail menu design."), t.reply);
check("...and it is saved in the chat that way", storedLast().endsWith("cocktail menu design."));

// nextPlanStep from the live chat at each dead end.
const ctx = (extra: Partial<import("../lib/intake-plan.ts").PlanContext> = {}) => ({
  packageType: "Premium Bar",
  booking: { name: "Sam T Rivers", packageType: "Premium Bar", guests: 60, hours: 5, eventType: "Social Gathering", eventDate: "null" },
  ...extra,
});
check("Next item after the date: what they are celebrating (the booking only says Social Gathering)", plan.nextPlanStep(ctx(), R.slice(0, 6))?.id === "event_type");
const told = [...R.slice(0, 6), { role: "assistant", content: "What are you celebrating?" }, R[7]];
check("A friends Christmas party has no guest of honor: the role question is skipped, next is the start time", plan.nextPlanStep(ctx(), told)?.id === "start_time");
check("The name is never asked when the booking has it", !["name"].includes(plan.nextPlanStep(ctx(), told)!.id) && plan.nextPlanStep(ctx({ booking: { packageType: "Premium Bar" } }), [])?.id === "confirm_booking");
check("After the theme: the colors", plan.nextPlanStep(ctx(), R.slice(0, 42))?.id === "colors");
check("After the wrap up question is answered, nothing is left (time for the closing)", plan.nextPlanStep(ctx(), R.slice(0, 66)) === null);
check("Premium never gets the bar on site question", !JSON.stringify(R.slice(0, 66).map(() => 0)) || plan.nextPlanStep(ctx(), R.slice(0, 30))?.id !== "bar_on_site");
const fullBarAtBar = plan.nextPlanStep({ ...ctx(), packageType: "Full Bar", booking: { ...ctx().booking, packageType: "Full Bar" } }, R.slice(0, 30));
check("...while Full Bar does, at the same point", fullBarAtBar?.id === "bar_on_site", fullBarAtBar?.id);
check("The generic line is only for when the code cannot tell", plan.regenerateInstruction(null).includes(plan.GENERIC_NEXT) && !plan.regenerateInstruction({ id: "x", label: "the colors", question: "Q?" }).includes(plan.GENERIC_NEXT));

// =====================================================================
// 2. The final save: never claimed, forced when skipped, honest when it fails
// =====================================================================

// The live turn: the closing message without the tool call.
reset();
ai.script.reply = (p) => (p.tool_choice?.type === "tool" ? [ai.toolUse("submit_event_data", PAYLOAD)] : [{ type: "text", text: CLOSING }]);
t = await turn(R.slice(0, 66));
check("A closing without submit_event_data forces the call (tool_choice submit_event_data)", ai.calls.some((c) => c.tool_choice?.type === "tool" && (c.tool_choice as { name?: string }).name === "submit_event_data"));
check("...and the plan is submitted", S().status === "submitted" && !!ED());
check("...the client hears the real result, in our words", t.reply.startsWith(CLOSING) && t.reply.endsWith(plan.SUBMITTED_DRINKS_LINE), t.reply);
check("...the page moves on to the confirmation only after the save", t.events.includes("complete"));
check("...and save-event and the GHL webhook still fire", hooks.some((h) => h.url.endsWith("/api/save-event")) && hooks.some((h) => h.url.endsWith("/api/webhook")));

// Drinks skipped: Drinks not finalized, the team is texted, the 4th drink held back.
const ed = ED()!;
check("Skipped drink details still submit, marked drinks_not_finalized", ed.drinks_not_finalized === true);
check("...with the Drinks not finalized line in the team notes, never in special requests", !/Drinks not finalized|Not confirmed/.test(String(ed.special_requests ?? "")) && String(ed.team_notes ?? "").includes("Drinks not finalized: the client named Mistletoe Mojito, White Christmas Margarita, North Pole Espresso Martini, Christmas Bourbon Old Fashioned. Text them to finish the menu."), String(ed.team_notes));
check("The 4th drink nobody said yes to is held back and listed", (ed.signature_drinks as unknown[]).length === 3 && String(ed.team_notes).includes("Not confirmed: Christmas Bourbon Old Fashioned as an additional drink ($50 each)."));
check("...and kept whole for the client's Yes or No on their page", Array.isArray(ed.unconfirmed_drinks) && (ed.unconfirmed_drinks as { name: string }[]).length === 1 && (ed.unconfirmed_drinks as { name: string }[])[0].name === "Christmas Bourbon Old Fashioned", JSON.stringify(ed.unconfirmed_drinks));
check("...drinks_finalized and extra_drinks_accepted never reach the saved event", !("drinks_finalized" in ed) && !("extra_drinks_accepted" in ed));
check("The admins get one text to follow up on the menu", adminTexts().length === 1 && adminTexts()[0].includes("Drinks not finalized for Sam and Dana Rivers") && adminTexts()[0].includes("Christmas Bourbon Old Fashioned ($50 each)"), adminTexts().join(" | "));
check("...with the event date the chat gave, never null", adminTexts()[0].includes("Dec 11") && !/null/i.test(adminTexts()[0]), adminTexts()[0]);

// A yes on the 4th drink keeps it.
reset();
ai.script.reply = (p) => (p.tool_choice?.type === "tool" ? [ai.toolUse("submit_event_data", { ...PAYLOAD, extra_drinks_accepted: true })] : [{ type: "text", text: CLOSING }]);
await turn(R.slice(0, 66));
check("A clear yes to the extra drink keeps all four", (ED()!.signature_drinks as unknown[]).length === 4 && !String(ED()!.team_notes ?? "").includes("Not confirmed") && !ED()!.unconfirmed_drinks);

// Every drink complete: no flag, no admin text, the plain line.
reset();
const complete = { ...PAYLOAD, drinks_finalized: undefined, signature_drinks: PAYLOAD.signature_drinks.slice(0, 3).map((d) => ({ ...d, ...RECIPE })) };
ai.script.reply = () => [{ type: "text", text: CLOSING }, ai.toolUse("submit_event_data", complete)];
t = await turn(R.slice(0, 66));
check("Complete drinks: submitted with the plain result line, no flag, no admin text", S().status === "submitted" && t.reply.endsWith(plan.SUBMITTED_LINE) && ED()!.drinks_not_finalized === undefined && adminTexts().length === 0, t.reply);

// The final save fails: an honest line, an admin alert, and no confirmation page.
reset();
guards.push((table, op) => (table === "sessions" && op === "update" ? "database is down" : null));
ai.script.reply = () => [{ type: "text", text: CLOSING }, ai.toolUse("submit_event_data", complete)];
t = await turn(R.slice(0, 66));
check("A failed final save: the client is told honestly that our team will follow up", t.reply.endsWith(plan.SAVE_FAILED_LINE) && !t.reply.includes(plan.SUBMITTED_LINE), t.reply);
check("...never sent to the confirmation page", !t.events.includes("complete"));
check("...and the admins get an alert with the session", adminTexts().some((m) => m.includes("could not save") && m.includes("session hp1")), adminTexts().join(" | "));
guards.length = 0;

// The model will not make the call even when forced.
reset();
ai.script.reply = (p) => (p.tool_choice?.type === "tool" ? [{ type: "text", text: "" }] : [{ type: "text", text: CLOSING }]);
t = await turn(R.slice(0, 66));
check("If the forced call brings nothing, the client hears the honest line and the admins are alerted", t.reply.endsWith(plan.SAVE_FAILED_LINE) && S().status === "in_progress" && adminTexts().some((m) => m.includes("session hp1")));

// The live follow up: the closing went out earlier, nothing was saved, the client asks "Is that everything?".
reset();
ai.script.reply = (p) => (p.tool_choice?.type === "tool" ? [ai.toolUse("submit_event_data", PAYLOAD)] : [{ type: "text", text: "Yes, we are all set! Your details have been submitted to our team." }]);
t = await turn([...R.slice(0, 66), { role: "assistant", content: CLOSING }, { role: "user", content: "Ok" }, { role: "user", content: "Is that everything?" }]);
check("After a closing that saved nothing, the next message submits first (no chat turn, no false claim)", S().status === "submitted" && ai.calls.length === 1 && ai.calls[0].tool_choice?.type === "tool");
check("...and the reply is only the real result", t.reply === plan.SUBMITTED_DRINKS_LINE, t.reply);

// The model claims a submission on its own: the sentence never reaches the client.
reset();
ai.script.reply = () => [{ type: "text", text: "Your details have been submitted to our team. Let me get that submitted right now. What colors are you going with?" }];
t = await turn(R.slice(0, 42));
check("A sentence claiming the plan was submitted is dropped while streaming", !/submitted/i.test(t.reply) && t.reply.includes("What colors"), t.reply);
check("Claims are caught in their usual wordings", ["Your details have been submitted to our team.", "Let me get that submitted right now.", "I have sent everything to our team.", "Your plan was submitted to the team."].every(plan.claimsSubmitted) && !plan.claimsSubmitted("Please hang tight while we gather all your details together!") && !plan.claimsSubmitted("You are all set with your 3 signature drinks!"));

// Empty stored replies are never sent back to the model.
reset();
ai.script.reply = () => [{ type: "text", text: "What date is your event?" }];
await turn([R[0], R[1], { role: "assistant", content: "" }, { role: "user", content: "Hello?" }]);
check("An empty stored reply is never sent to the model (the API refuses empty turns)", (ai.calls[0].messages as Msg[]).every((m) => typeof m.content !== "string" || m.content.trim() !== ""));

// The prompt: never claim a submission, never go quiet after the closing.
const P = prompt.buildIntakePrompt(null, new Date("2026-11-21T18:00:00Z"));
check("The prompt no longer says to stay silent after the tool call", !P.includes("do not respond again"));
check("...and says never to claim the plan was submitted", P.includes("Never say the plan was submitted, sent to our team, saved"));
check("...and that every reply ends with the next question", P.includes("EVERY REPLY ENDS WITH THE NEXT QUESTION"));
check("The save tool no longer tells the model to stop after its words", !src("lib/partners/chat.ts").includes("Write your reply text in the same turn.") && pchat.savePlanningRoleTool.description!.includes("end it with the next planning question"));

// Finished but not saved: the closing anywhere in the chat counts.
const tail = (msgs: Msg[]) => ({ session_id: "hp1", client_name: "Sam", status: "in_progress", updated_at: "2026-11-21T21:23:57Z", last: msgs.at(-1)!, closed: unsaved.sentClosing(msgs) });
const live = [...R];
check("Finished but not saved catches a chat that kept going after the closing (both live sessions were missed)", unsaved.finishedNotSaved([tail(live)], [{ id: "hp1", name: "Sam T Rivers", status: "in_progress", event_data: null, event_date: "null" }]).length === 1);
check("...and shows no date instead of the text null", unsaved.finishedNotSaved([tail(live)], [{ id: "hp1", name: "Sam T Rivers", status: "in_progress", event_data: null, event_date: "null" }])[0].eventDate === "no date");

// =====================================================================
// 3. The right questions for this booking
// =====================================================================
check("Event types with a guest of honor get the role question", ["Birthday", "40th Birthday", "Wedding Reception", "Bridal Shower", "Anniversary", "Graduation Party", "Retirement"].every((x) => plan.honoreeFit(x) === "ask"));
check("A holiday party, a corporate event, and a friends gathering never do", ["Christmas Gift Exchange", "It's a friends Christmas gathering", "Corporate Holiday Party", "Company Mixer"].every((x) => plan.honoreeFit(x) === "skip"));
check("A generic booking type (Social Gathering) or none waits for the client", ["Social Gathering", "Party", "Other", "null", ""].every((x) => plan.honoreeFit(x) === "unknown"));

reset();
ai.script.reply = () => [{ type: "text", text: "Hey Sam! What are you celebrating?" }];
await turn(R.slice(0, 2));
const sysOf = (i: number) => ((ai.calls[i].system as { text: string }[])[0]).text;
const sys = sysOf(0);
check("Social Gathering booking: the role question waits until the client says what it is, and only for a guest of honor event", sys.includes("Only if it is an event with a guest of honor (birthday, wedding, shower, anniversary, graduation, retirement)") && !sys.includes("Right after your greeting (and after the OPENING SUMMARY check, if there is one), before any other event question"));
reset({ event_type: "Christmas Party" });
await turn([{ role: "user", content: R[0].content.replace("Social Gathering", "Christmas Party") }, R[1]]);
check("A booking that says Christmas Party: no role question at all, the planner question once", !sysOf(0).includes(pchat.ROLE_QUESTION) && sysOf(0).includes("Are you working with an event planner?"));
reset({ event_type: "Birthday" });
await turn([{ role: "user", content: R[0].content.replace("Social Gathering", "Birthday") }, R[1]]);
check("A birthday booking: the role question right after the opening check", sysOf(0).includes(`Right after your greeting (and after the OPENING SUMMARY check, if there is one), before any other event question, ask exactly: "${pchat.ROLE_QUESTION}"`));
check("The name is only asked when the booking has none", P.includes("Full name (ONLY if the booking did not give it"));
check("A second bar only when two bars serve at once; possibly both asks where the one bar goes", P.includes('"both", "possibly both", "not sure", or "the party is inside and out" does NOT mean two bars') && P.includes("Only when the client clearly asks for two bars serving at the same time"));
check("Premium never gets the bar on site question", P.includes("SKIP this question entirely on Premium Bar: the hand crafted wooden bar is included"));
check("More drinks than included: a yes or no on the extra one before moving on, even when skipping details", P.includes("MORE DRINKS THAN INCLUDED") && P.includes("Never move past this without the answer") && P.includes("If they named more drinks than the package includes, first follow MORE DRINKS THAN INCLUDED"));
check("Skipping the drink details: told plainly we will text them", P.includes('"No problem, we will text you to finish your drink menu."'));

// =====================================================================
// 4. Booking fields: "null" is missing, gaps are logged, the opening confirms
// =====================================================================
check('"null", "undefined", "NULL", blank, and merge tags are missing', ["null", "NULL", "undefined", " ", "", "{{contact.date}}", null, undefined].every(blank.isBlank) && !blank.isBlank("December 11") && !blank.isBlank(0) && !blank.isBlank(false));
const booking = bw.readBooking({ name: "Sam T Rivers", email: "sam@example.com", event_date: "null", package_type: "Premium Bar", guest_count: "60", event_type: "null", promo_code: "NULL", hours_booked: "5" });
check("The booking webhook stores the text null as missing (event date, event type, promo code)", booking.eventDate === null && booking.eventType === null && booking.promoCode === null && booking.packageType === "Premium Bar");
check("Missing expected fields are listed", JSON.stringify(bw.missingBookingFields(booking)) === JSON.stringify(["contact_id", "phone", "event_date", "start_time", "event_type", "bartender_count", "total_price", "city", "state"]), JSON.stringify(bw.missingBookingFields(booking)));
for (const k of Object.keys(db)) delete db[k];
db.sessions = [];
const warned: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(" ")); };
const made = await createSession.POST(new Request("http://plan.test/api/create-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sam T Rivers", email: "sam@example.com", event_date: "null", package_type: "Premium Bar", guest_count: "60", hours_booked: "5" }) }) as never);
console.warn = realWarn;
const madeId = ((await made.json()) as { id: string }).id;
check("Session creation logs every expected field that arrived missing", warned.some((w) => w.includes(`[create-session] session=${madeId}: booking arrived without`) && w.includes("event_date") && w.includes("start_time")), warned.join(" | "));
check("...and never stores the text null", (db.sessions as Record<string, unknown>[]).find((s) => s.id === madeId)!.event_date === null);
check("An old CONTEXT message with Event date: null gives no date", !("Event date" in facts.contextFields(R[0].content)) && facts.contextFields(R[0].content)["Package"] === "Premium Bar");
check("The planner chat context leaves a null date out", !ctxMsg.bookingContextMessage({ name: "Sam", event_date: "null", package_type: "Premium Bar" })!.includes("Event date"));
check("Team pages read a null date as no date", markets.eventData({ event_date: "null", event_data: null }).event_date === undefined && markets.eventData({ event_date: "null", event_data: { event_date: "December 11, 2026" } }).event_date === "December 11, 2026");
reset();
check("getSession reads booking columns holding null text as missing", (await eu.getSession("hp1"))!.event_date === null);
check("bookedEventFrom never carries a null date", eu.bookedEventFrom({ ...SESSION } as never).event_date === undefined);
check("The /s page and the chat page skip null text when passing booking details", src("app/s/page.tsx").includes("if (!isBlank(value))") && src("app/chat/page.tsx").includes("const param = (k: string) => present(searchParams.get(k));"));
check("A migration clears the stored null text", src("supabase/migrations/20261231_booking_null_text.sql").includes("^(null|undefined|none|n/a)?$"));

const known = { name: "Sam T Rivers", packageType: "Premium Bar", guests: 60, hours: 5, eventDate: "null", eventType: "Social Gathering" };
const opening = plan.openingSummarySection(known);
check("The opening confirms what the booking told us in one summary, then asks Is all of that still right?", opening.includes("the Premium Bar for 60 guests, 5 hours of bar service") && opening.includes(`ask exactly: "${plan.OPENING_CHECK}" Ask nothing else in that reply.`));
check("...then asks only for what is missing: the date and what they are celebrating, never the name", opening.includes("starting with: the event date, then what they are celebrating") && !opening.includes("their name"));
check("...and never shows null as a value", !/: null|on null|null\./.test(opening.replace("Never write the word null", "")));
reset();
ai.script.reply = () => [{ type: "text", text: `Hey Sam! I have you down for the Premium Bar for 60 guests, 5 hours of bar service. ${plan.OPENING_CHECK}` }];
await turn(R.slice(0, 2));
check("The chat route gives the model the opening summary for this booking", sysOf(0).includes("OPENING SUMMARY:") && sysOf(0).includes("booked by Sam T Rivers"));

// =====================================================================
// 5. The replay: the live chat, through the real route, ends submitted with no dead ends
// =====================================================================
// The model is scripted with exactly what it said live (the four dead ends
// included, the role saves as tool calls, and the closing without the tool).
// Second turns and regenerates return nothing, so every question added comes
// from the code. History is what the route actually sent back each time.
reset();
const ROLE_SAVES: Record<number, Record<string, unknown>> = { 6: { role: "guest_of_honor" }, 10: { host_name: "Sam and Dana Rivers" }, 12: { role: "guest_of_honor" } };
let liveIndex = 0;
ai.script.reply = (p) => {
  if (p.tool_choice?.type === "tool") return [ai.toolUse("submit_event_data", PAYLOAD)];
  if (p.tool_choice?.type === "none") return [{ type: "text", text: "" }];
  const blocks: ReturnType<typeof ai.toolUse>[] | { type: "text"; text: string }[] = [{ type: "text", text: R[liveIndex].content }];
  const save = ROLE_SAVES[liveIndex];
  return save ? [...(blocks as never[]), ai.toolUse("save_planning_role", save)] : (blocks as never);
};
const history: Msg[] = [R[0]];
const produced: { at: number; reply: string; events: string[] }[] = [];
for (let i = 1; i <= 65; i++) {
  if (R[i].role !== "user") continue;
  history.push(R[i]);
  if (R[i + 1]?.role !== "assistant") continue; // two user messages in a row (none before the closing)
  liveIndex = i + 1;
  const r = await turn(history);
  produced.push({ at: liveIndex, ...r });
  history.push({ role: "assistant", content: r.reply });
}
const beforeClosing = produced.filter((x) => !plan.CLOSING_PATTERN.test(x.reply));
const dead = beforeClosing.filter((x) => !plan.hasQuestion(x.reply));
check("Replay: no reply before the closing ends without a question", dead.length === 0, dead.map((d) => `#${d.at}: ${d.reply.slice(0, 80)}`).join(" | "));
const at = (n: number) => produced.find((x) => x.at === n)!.reply;
check("Replay: after Guest of honor, the concierge asks what they are celebrating", at(6).startsWith("Love it") && at(6).endsWith("What are you celebrating?"), at(6));
check("Replay: after the names, it moves on with a real question (the start time)", at(10).endsWith("What time would you like bar service to start?"), at(10));
check("Replay: after the theme and colors message, it asks the colors", at(42).endsWith("What colors are you going with for your event? We will use these for your cocktail menu design."), at(42));
const closing = produced.at(-1)!;
check("Replay: the closing (sent without the tool live) ends submitted", plan.CLOSING_PATTERN.test(closing.reply) && S().status === "submitted" && closing.events.includes("complete"));
check("Replay: marked Drinks not finalized, with the 4th drink held back", ED()!.drinks_not_finalized === true && (ED()!.signature_drinks as unknown[]).length === 3);
check("Replay: the client is told plainly we will text them to finish the menu", closing.reply.endsWith(plan.SUBMITTED_DRINKS_LINE));
check("Replay: the date the chat gave is saved, not null", ED()!.event_date === "December 11, 2026");
check("Replay: no reply ever claimed a submission the system did not make", produced.every((x) => !plan.claimsSubmitted(x.reply.replace(plan.SUBMITTED_DRINKS_LINE, ""))));
check("Replay: the team got the menu follow up text", adminTexts().some((m) => m.startsWith("Drinks not finalized for Sam and Dana Rivers")));

done("concierge dead ends and final save");
