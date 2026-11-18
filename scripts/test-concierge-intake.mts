// The intake concierge: what the booking already gave is never asked again,
// the most popular lists are real counts (or the admins' fallback), and the
// recommendation invite shows once with the first menu.
//
// From a live test on 2026-11-17: the booking sent start_time 6:00 PM, the
// greeting said "4 hours of bar service starting at 6:00 PM", and later the
// bot asked "What time would you like bar service to start?" anyway. These
// checks fail if the intake prompt for a booking with a start time still has
// a step that asks for it, and run the real chat route to see the booked start
// reach event_data at submission without the bot asking.
// Run: node --no-warnings scripts/test-concierge-intake.mts

import { registerHooks } from "node:module";
import { check, done, hooks } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@anthropic-ai/sdk") return nextResolve(new URL("./fake-anthropic.mts", import.meta.url).href, context);
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db } = await import("./fake-supabase.mts");
const ai = await import("./fake-anthropic.mts");
const prompt = await import("../lib/system-prompt.ts");
const facts = await import("../lib/booked-facts.ts");
const pop = await import("../lib/popular-drinks.ts");
const popDb = await import("../lib/popular-drinks-db.ts");
const invite = await import("../lib/menu-invite.ts");
const { MENU_COPY } = await import("../lib/menu-markers.ts");
const pay = await import("../lib/team/pay.ts");
const chat = await import("../app/api/chat/route.ts");

const NOW = new Date("2026-11-17T18:00:00Z");
const BOOKED = { startTime: "6:00 PM", hours: 4, bartenders: 1, eventType: "Social Gathering" };
const NONE = facts.NO_BOOKED_FACTS;
const hyphenFree = (s: string) => !/[-‐-―]/.test(s);

/** Any instruction that would have the bot ask the client for the start time. */
function asksForStartTime(p: string): boolean {
  return (
    p.includes(prompt.ASK_START_ITEM) ||
    /What time (they want|would you like) bar service to start/i.test(p) ||
    p.includes("1. Confirm bar service start and end times") ||
    p.includes("Only collect logistics from Phase 1: bar service start time")
  );
}

// ---------- Part A: the prompt ----------

const withStart = prompt.buildIntakePrompt(null, NOW, { booked: { ...NONE, startTime: "6:00 PM", hours: 4 } });
check("With a booked start time the intake never asks for it", !asksForStartTime(withStart));
check("...it says the start is answered and not to ask", withStart.includes("BAR SERVICE START TIME: 6:00 PM, with 4 hours booked, so bar service runs 6:00 PM to 10:00 PM") && withStart.includes("Do NOT ask what time bar service should start"));
check("...and states it once in the greeting", withStart.includes('State it once in your greeting, for example "4 hours of bar service starting at 6:00 PM"'));
check("...a different time from the client wins, with the normal service rules", /their answer wins: work out the new end time and apply BAR SERVICE HOURS VALIDATION, SHORTER SERVICE IS ALLOWED, LONGER SERVICE REQUIRES UPGRADE, and MAX SERVICE HOURS/.test(withStart));
check("...and the booked times go in submit_event_data", withStart.includes("always send bar_service_start and bar_service_end: the booked times, unless the client changed them"));
check("The Beer and Wine list states the booked times instead of asking", withStart.includes("1. State the booked bar service start and end times") && !withStart.includes("1. Confirm bar service start"));

const plain = prompt.buildIntakePrompt(null, NOW);
check("Without booked details (older bookings) the start time is asked exactly as before", plain.includes(prompt.ASK_START_ITEM) && plain.includes("1. Confirm bar service start and end times and explain setup/breakdown"));
check("...with no BOOKED DETAILS section", !plain.includes("BOOKED DETAILS"));
check("...and the event type and celebration questions as before", plain.includes(prompt.ASK_EVENT_TYPE_ITEM) && plain.includes("Ask their name if not available and what they are celebrating."));
check("No booked details is the same prompt as passing none", plain === prompt.buildIntakePrompt(null, NOW, { booked: NONE }));

const all = prompt.buildIntakePrompt(null, NOW, { booked: BOOKED });
check("A booked event type is never asked", !all.includes(prompt.ASK_EVENT_TYPE_ITEM) && all.includes("EVENT TYPE: Social Gathering. Do NOT ask what type of event it is."));
check("...but a broad type may still get what are we celebrating", /broad \(like Social Gathering[^)]*\), you may ask once what specifically they are celebrating/.test(all));
check("...and the greeting does not ask what they are celebrating", !all.includes("Ask their name if not available and what they are celebrating."));
check("Booked bartenders are never asked", all.includes("BARTENDERS BOOKED: 1. Do NOT ask how many bartenders they need."));
check("Only what the booking gave is treated as answered", !prompt.buildIntakePrompt(null, NOW, { booked: { ...NONE, bartenders: 2 } }).includes("BAR SERVICE START TIME"));

// ---------- Part A: reading what the booking gave ----------

const ctx = `${facts.CONTEXT_PREFIX} Client name: Dulari Gandhi, Email: d@example.com, Event date: April 11, Package: Full Bar, Guest count: 18, Event type: Social Gathering, Hours of bar service booked: 4, Bar service start time booked: 6:00 PM, Bartenders booked: 1. Use this info and do not re-ask for it.`;
const fromCtx = facts.bookedFacts(null, [{ role: "user", content: ctx }]);
check("The CONTEXT message gives the booked facts for chats with no session row", fromCtx.startTime === "6:00 PM" && fromCtx.hours === 4 && fromCtx.bartenders === 1 && fromCtx.eventType === "Social Gathering");
const older = facts.bookedFacts(null, [{ role: "user", content: `${facts.CONTEXT_PREFIX} Client name: Ann, Package: Full Bar, Event type: Birthday Party. Use this info and do not re-ask for it.` }]);
check("An older booking (type only, sent in event_name) has no start time or bartenders", older.startTime === null && older.bartenders === null && older.eventType === "Birthday Party");
check("The session row wins over the CONTEXT message", facts.bookedFacts({ bar_service_start: "7:30 PM", bartender_count: 2 }, [{ role: "user", content: ctx }]).startTime === "7:30 PM");

// ---------- Part A: through the real chat route ----------

function resetDb() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [];
  db.conversation_logs = [];
  db.event_updates = [];
  db.events = [];
  db.team_settings = [];
  db.team_hidden_events = [];
  hooks.length = 0;
  popDb.forgetPopularDrinks();
}

type Msg = { role: string; content: string; menus?: string[] };
async function turn(history: Msg[], sessionId: string | null = "dul1"): Promise<{ reply: string; menus: string[] }> {
  const res = await chat.POST(new Request("http://plan.test/api/chat", { method: "POST", body: JSON.stringify({ messages: history, sessionId }) }));
  let reply = "";
  const menus: string[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const ev = JSON.parse(line.slice(6)) as { text?: string; error?: string; event?: string; menu?: string };
    if (ev.error) throw new Error(ev.error);
    if (ev.text) reply += ev.text;
    if (ev.event === "menu" && ev.menu) menus.push(ev.menu);
  }
  return { reply, menus };
}
const lastSystem = () => ((ai.calls[ai.calls.length - 1].system as { text: string }[])[0]).text;

resetDb();
db.sessions.push({ id: "dul1", status: "in_progress", version: 0, event_data: null, name: "Dulari Gandhi", package_type: "Full Bar", guest_count: "18", hours_booked: "4", event_type: "Social Gathering", bar_service_start: "6:00 PM", bartender_count: 1 });
db.conversation_logs.push({ session_id: "dul1", messages: [] });
ai.script.reply = () => [{ type: "text", text: "Hey Dulari! 4 hours of bar service starting at 6:00 PM. Is the event at a venue or a private residence?" }];
await turn([{ role: "user", content: ctx }, { role: "user", content: "Hey! I just booked with The Mix Fix and I am ready to plan my bar service." }]);
check("The chat route gives the bot a prompt that never asks for the booked start time", !asksForStartTime(lastSystem()) && lastSystem().includes("BAR SERVICE START TIME: 6:00 PM"));

// The bot never asked, so it sends no times: the booked start still lands in event_data.
ai.script.reply = () => [
  { type: "text", text: "Thank you so much, Dulari! Please hang tight while we gather all your details together!" },
  ai.toolUse("submit_event_data", { client_name: "Dulari Gandhi", package: "Full Bar", event_date: "2027-04-11", guest_count: 18, signature_drinks: [] }),
];
await turn([{ role: "user", content: ctx }, { role: "user", content: "That is everything." }]);
const ed = db.sessions[0].event_data as Record<string, unknown>;
check("At submission the booked start lands in event_data as bar_service_start", ed?.bar_service_start === "6:00 PM");
check("...with the end from the booked hours", ed?.bar_service_end === "10:00 PM");
check("...so scheduledMinutes and the pay estimate have it (4 PM setup to 11 PM breakdown)", pay.scheduledMinutes(ed) === 7 * 60);
const saved = hooks.find((h) => h.url.endsWith("/api/save-event"))?.body.eventData as Record<string, unknown> | undefined;
const ghl = hooks.find((h) => h.url.endsWith("/api/webhook"))?.body.eventData as Record<string, unknown> | undefined;
check("...and the events row and the GHL webhook get it too", saved?.bar_service_start === "6:00 PM" && ghl?.bar_service_start === "6:00 PM" && ghl?.bar_service_end === "10:00 PM");
check("...with the booked bartenders and event type", ed?.bartenders === 1 && ed?.event_type === "Social Gathering");

resetDb();
db.sessions.push({ id: "dul2", status: "in_progress", version: 0, event_data: null, name: "Dulari Gandhi", package_type: "Full Bar", hours_booked: "4", bar_service_start: "6:00 PM" });
db.conversation_logs.push({ session_id: "dul2", messages: [] });
ai.script.reply = () => [
  { type: "text", text: "Thank you!" },
  ai.toolUse("submit_event_data", { client_name: "Dulari Gandhi", package: "Full Bar", bar_service_start: "7:00 PM", bar_service_end: "11:00 PM", signature_drinks: [] }),
];
await turn([{ role: "user", content: "done" }], "dul2");
const ed2 = db.sessions[0].event_data as Record<string, unknown>;
check("A different time from the client wins over the booked one", ed2?.bar_service_start === "7:00 PM" && ed2?.bar_service_end === "11:00 PM");

// ---------- Part B: the popularity helper ----------

const menu = pop.currentMenu();
const fm = { name: "Raspberry Kiss", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.75 oz raspberry liqueur", "2 oz pineapple juice"], is_mocktail: false };
check("A renamed drink matches the menu by its recipe", pop.matchMenuDrink(fm, menu)?.name === "French Martini");
check("menu_name wins when the concierge sent it", pop.matchMenuDrink({ name: "Gold Rush", menu_name: "Tequila Mucho", ingredients: [] }, menu)?.name === "Tequila Mucho");
check("A kept menu name matches", pop.matchMenuDrink({ name: "old fashioned", ingredients: [] }, menu)?.name === "Old Fashioned");
check("White Lemon Drop is not counted as Lemon Drop", pop.matchMenuDrink({ name: "Snowfall", ingredients: ["2 oz vodka", "1 oz white cranberry juice", "1 oz lemon juice", "0.5 oz triple sec", "0.5 oz simple syrup"] }, menu)?.name === "White Lemon Drop");
check("A drink no longer on the menu is not counted", pop.matchMenuDrink({ name: "Blackberry Whiskey Smash", ingredients: ["2 oz Jack Daniels blackberry", "1 oz lemon juice", "top with ginger beer"] }, menu) === null);
check("A mocktail is never matched to the cocktail menu", pop.matchMenuDrink({ name: "French Martini", is_mocktail: true }, menu) === null);
check("A custom drink only matches by name", pop.matchMenuDrink({ ...fm, is_custom: true }, menu) === null);

const ev = (pkg: string, ...drinks: unknown[]) => ({ package: pkg, signature_drinks: drinks });
const counts = pop.countPicks(
  [
    ev("Full Bar", fm, { name: "Tequila Mucho", ingredients: [] }, { name: "Lavender Lemonade", is_mocktail: true, ingredients: ["2 oz lemonade"] }),
    ev("Premium Bar", fm, { ...fm, name: "Second Raspberry" }),
    ev("Dive Bar", { name: "Margarita", ingredients: [] }, { name: "Old Fashioned", ingredients: [] }),
    ev("Full Bar", { name: "House Special", is_custom: true, ingredients: ["2 oz mezcal"] }),
    ev("The Big Day Bar", { name: "Margarita", ingredients: [] }),
  ],
  menu
);
check("Counts each menu drink once per event", counts.cocktails.find((c) => c.name === "French Martini")?.count === 2);
check("Dive Bar's set menu is not counted as picks", counts.cocktails.find((c) => c.name === "Margarita")?.count === 1 && !counts.cocktails.some((c) => c.name === "Old Fashioned"));
check("Only events with a current menu pick count toward the 20", counts.eventsWithPicks === 3);
check("Most picked first", counts.cocktails[0].name === "French Martini");
check("Mocktails are not counted: there is no mocktail menu", counts.mocktails.length === 0);

// ---------- Part B: the fallback list ----------

const fb = pop.popularDrinks(counts, { cocktails: "Peach Paloma, Blackberry Whiskey Smash, mojito, Peach Paloma", mocktails: "Lavender Lemonade, Virgin Mule" }, menu);
check("Fewer than 20 events with picks uses the admins' fallback list", fb.cocktailSource === "fallback" && fb.eventsWithPicks === 3);
check("...keeping only drinks on the current menu, spelled as the menu spells them", JSON.stringify(fb.cocktails.map((d) => d.name)) === JSON.stringify(["Peach Paloma", "Mojito"]));
check("...and the mocktail list as written", JSON.stringify(fb.mocktails.map((d) => d.name)) === JSON.stringify(["Lavender Lemonade", "Virgin Mule"]) && fb.mocktailSource === "fallback");
const many = pop.countPicks(Array.from({ length: 20 }, (_, i) => ev("Full Bar", i < 12 ? fm : { name: "Peach Paloma", ingredients: [] }, i % 2 ? { name: "Mojito", ingredients: [] } : { name: "Gin Saint", ingredients: [] })), menu);
const real = pop.popularDrinks(many, { cocktails: "Peach Paloma", mocktails: "" }, menu);
check("At 20 events with picks the counts are used, top five", real.cocktailSource === "counts" && real.cocktails.length === 4 && real.cocktails[0].name === "French Martini" && real.cocktails[0].count === 12);
check("An empty mocktail fallback gives an empty list", real.mocktails.length === 0);
check("The admin status line says where the list comes from", pop.popularStatusLine(fb, "cocktails").includes("3 of 20 events") && pop.popularStatusLine(real, "cocktails").startsWith("In use now: counts from 20 events: French Martini (12)"));

// From the database: submitted, not hidden events, and the team settings fallback.
resetDb();
db.sessions.push(
  { id: "e1", status: "submitted", package_type: "Full Bar", event_data: { package: "Full Bar", signature_drinks: [fm] } },
  { id: "e2", status: "submitted", package_type: "Full Bar", event_data: { package: "Full Bar", signature_drinks: [fm] } },
  { id: "e3", status: "in_progress", package_type: "Full Bar", event_data: null },
  { id: "e4", status: "submitted", package_type: "Full Bar", event_data: { package: "Full Bar", signature_drinks: [{ name: "Gin Saint", ingredients: [] }] } }
);
db.team_hidden_events.push({ session_id: "e4" });
db.team_settings.push({ key: "popular_mocktails_fallback", value: "Cucumber Cooler" });
const fromDb = await popDb.currentPopularDrinks({ fresh: true });
const dbCounts = await popDb.pickCounts();
check("The database count skips hidden and unsubmitted events", dbCounts.eventsWithPicks === 2 && dbCounts.cocktails.length === 1 && dbCounts.cocktails[0].count === 2);
check("With no saved cocktail list the default fallback is used", fromDb.cocktailSource === "fallback" && JSON.stringify(fromDb.cocktails.map((d) => d.name)) === JSON.stringify(["French Martini", "Whiskey Smash", "Tequila Mucho"]));
check("The saved mocktail list is used", fromDb.mocktails[0]?.name === "Cucumber Cooler");

// The concierge gets the lists, and answers from them only.
const withPop = prompt.buildIntakePrompt(null, NOW, { popular: { cocktails: ["Peach Paloma", "Mojito"], mocktails: [] } });
check("The concierge gets the top five in its prompt", withPop.includes("MOST POPULAR COCKTAILS: 1. Peach Paloma, 2. Mojito") && withPop.includes("MOST POPULAR MOCKTAILS: none on file yet"));
check("...answers popularity from that list only and never invents it", withPop.includes("answer ONLY from these lists") && withPop.includes("Never call any other drink popular") && !/French Martini \(vodka\)\n2\. Blackberry Whiskey Smash/.test(withPop) && !withPop.includes("top 3 best sellers"));
check("...and recommends two or three menu drinks fitted to what it knows, respecting allergies", /suggest two or three drinks/.test(withPop) && /never anything off the menu/.test(withPop) && /the spirit they named if any, the event type, the theme or colors, and the season/.test(withPop) && /one short reason for each/.test(withPop) && /allergies or ingredients to avoid/.test(withPop));

// ---------- Part B: the invite line ----------

check("The invite wording has no hyphens", hyphenFree(invite.MENU_INVITE) && invite.MENU_INVITE === "Not sure where to start? Ask me for a recommendation or what is most popular and I will point you in the right direction.");
check("The client facing booked greeting example has no hyphens", hyphenFree("4 hours of bar service starting at 6:00 PM") && hyphenFree(prompt.MENU_INVITE));
check("The prompt asks for the invite after the menu line, once", withPop.split(invite.MENU_INVITE).length === 2 && withPop.includes(`right after "${MENU_COPY}" and before the markers`) && withPop.includes("Do not repeat it for the second or third drink"));

resetDb();
db.sessions.push({ id: "dul3", status: "in_progress", version: 0, event_data: null, name: "Dulari Gandhi", package_type: "Full Bar", hours_booked: "4" });
db.conversation_logs.push({ session_id: "dul3", messages: [] });
const step1 = `Let us start building your signature drink menu! For your first drink, would you like a cocktail or a mocktail? ${MENU_COPY}\n[MENU:specialty]\n[MENU:classics]`;
const occurrences = (s: string) => s.split(invite.MENU_INVITE).length - 1;

ai.script.reply = () => [{ type: "text", text: step1 }];
const first = await turn([{ role: "user", content: "Theme is disco." }], "dul3");
check("The first menu reply gets the invite when the bot leaves it out", occurrences(first.reply) === 1 && first.menus.length === 2 && first.reply.indexOf(invite.MENU_INVITE) > first.reply.indexOf(MENU_COPY));

ai.script.reply = () => [{ type: "text", text: step1.replace(MENU_COPY, `${MENU_COPY} ${invite.MENU_INVITE}`) }];
const firstWith = await turn([{ role: "user", content: "Theme is disco." }], "dul3");
check("...and is not doubled when the bot includes it", occurrences(firstWith.reply) === 1);

const history: Msg[] = [
  { role: "user", content: "Theme is disco." },
  { role: "assistant", content: `${MENU_COPY} ${invite.MENU_INVITE}`, menus: ["specialty", "classics"] },
  { role: "user", content: "French Martini please." },
];
ai.script.reply = () => [{ type: "text", text: `Love it! Now, for your second drink, would you like a cocktail or a mocktail? ${invite.MENU_INVITE}` }];
const second = await turn(history, "dul3");
check("The second drink never repeats the invite", occurrences(second.reply) === 0 && second.reply.includes("for your second drink"));
ai.script.reply = () => [{ type: "text", text: `Here it is again. ${MENU_COPY} ${invite.MENU_INVITE}\n[MENU:specialty]` }];
const again = await turn([...history, { role: "user", content: "Can I see the menu again?" }], "dul3");
check("Showing the menu again does not repeat the invite", occurrences(again.reply) === 0 && again.menus.length === 1);
const shownBefore = [{ role: "assistant", content: MENU_COPY, menus: ["specialty"] }];
check("Once an earlier reply showed a menu, the invite is not added", invite.inviteToAdd(invite.inviteUsed(shownBefore), 1, MENU_COPY) === "");

done("concierge intake");
