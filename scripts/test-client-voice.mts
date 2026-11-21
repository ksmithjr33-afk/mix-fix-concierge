// The client's event page (app/s) speaks only to the client. Team notes the
// system writes ("Drinks not finalized: the client named ... Text them to
// finish the menu.", "Not confirmed: ... Ask the client before adding.") live
// in event_data.team_notes, which the client page never reads; the client gets
// their own version instead ("Your drink menu is not finished yet." with
// "Finish my drink menu", and "You named a 4th drink ... Add it for $50?" with
// Yes and No). The page's real components are compiled and rendered here, and
// the test fails if any text on it says "the client", "ask the client", "text
// them", or anything from the team notes.
// Run: node --no-warnings scripts/test-client-voice.mts

import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { check, done, src } from "./team-harness.mts";

// The page's .tsx components: "@/app/..." and "./x" resolve to .tsx, compiled with TypeScript.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation") return { url: "data:text/javascript,export const useRouter=()=>({refresh(){},push(){}});export const redirect=()=>{};", shortCircuit: true };
    const base = specifier.startsWith("@/") ? new URL(`../${specifier.slice(2)}`, import.meta.url) : specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL) : null;
    if (base && !/\.[cm]?[jt]sx?$/.test(base.pathname) && existsSync(fileURLToPath(base) + ".tsx") && !existsSync(fileURLToPath(base) + ".ts")) {
      return { url: base.href + ".tsx", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const out = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  },
});

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const notes = await import("../lib/team-notes.ts");
const plan = await import("../lib/intake-plan.ts");
const diff = await import("../lib/event-diff.ts");
const eu = await import("../lib/event-updates.ts");
const info = await import("../lib/packages-info.ts");
const UpdateMode = (await import("../app/s/update-mode.tsx")).default;
const EventSummary = (await import("../app/s/event-summary.tsx")).default;
const PlannersCard = (await import("../app/s/planners-card.tsx")).default;

const BANNED = [/the client/i, /ask the client/i, /text them/i, /client's/i];
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, "\n")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

// ---------------------------------------------------------------------------
// The live case: a Premium Bar Christmas party, drinks skipped, a 4th drink nobody said yes to.
// ---------------------------------------------------------------------------
const PAYLOAD = {
  client_name: "Sam and Dana Rivers",
  event_name: "2nd Annual Christmas Gift Exchange",
  event_type: "Christmas party",
  event_date: "December 11, 2026",
  package: "Premium Bar",
  guest_count: 60,
  bar_service_start: "6:30 PM",
  bar_service_end: "11:30 PM",
  special_requests: "Bar faces the tree",
  drinks_finalized: false,
  signature_drinks: [
    { name: "Mistletoe Mojito", base_spirit: "rum" },
    { name: "White Christmas Margarita", base_spirit: "tequila" },
    { name: "North Pole Espresso Martini", base_spirit: "vodka" },
    { name: "Christmas Bourbon Old Fashioned", base_spirit: "bourbon", ingredients: ["2 oz bourbon", "0.25 oz cinnamon syrup"] },
  ],
};
const checked = plan.checkDrinks(PAYLOAD, "Premium Bar");
// A concierge submission since 2026-11-21: its special requests are written to the client.
const saved = notes.withClientVoice(checked.data);
const teamNotes = String(saved.team_notes ?? "").split("\n").filter(Boolean);

check("Intake: the team notes go in team_notes", teamNotes.length === 2 && teamNotes[0].startsWith("Drinks not finalized: the client named") && teamNotes[1].startsWith("Not confirmed: Christmas Bourbon Old Fashioned"), JSON.stringify(saved.team_notes));
check("Intake: special requests keep only what the client asked for", saved.special_requests === "Bar faces the tree", String(saved.special_requests));
check("Intake: the 4th drink is held back whole, recipe and all", (saved.signature_drinks as unknown[]).length === 3 && JSON.stringify(saved.unconfirmed_drinks) === JSON.stringify([PAYLOAD.signature_drinks[3]]));
check("The admin submit script writes team notes the same way (it saves checkDrinks' result)", src("scripts/admin-submit-session.mts").includes("checkDrinks(raw, pkg)") && !src("lib/intake-plan.ts").includes("out.special_requests ="));

// The team side: exactly as before, special requests and team notes together.
const teamText = notes.teamRequestsText(saved);
check("Team side: special requests and team notes read together, as before", teamText === ["Bar faces the tree", ...teamNotes].join("\n"), teamText);
check("Team side: the event view, events row and GHL all use the joined text", src("lib/team/event-view.ts").includes("scrub(teamRequestsText(ed))") && src("lib/events-row.ts").includes("teamEventData(input)") && src("lib/ghl-payload.ts").includes("teamEventData(raw)") && src("app/api/webhook/route.ts").includes("teamEventData(body.eventData)"));
const ghl = notes.teamEventData(saved);
check("GHL and the events row get no new keys, and the same special_requests as before", !("team_notes" in ghl) && !("unconfirmed_drinks" in ghl) && ghl.special_requests === teamText);
const row = (await import("../lib/events-row.ts")).eventsInsertRow(saved).row;
check("The events row keeps the team notes in its special_requests column", row.special_requests === teamText && !("team_notes" in row));

// ---------------------------------------------------------------------------
// The client page, rendered.
// ---------------------------------------------------------------------------
const clientData = notes.clientEventData(saved);
const asks = notes.clientAsks(saved, diff.packageDrinkCount(saved.package));
check("The browser never gets the internal fields", !("team_notes" in clientData) && !("unconfirmed_drinks" in clientData) && !JSON.stringify(clientData).includes("Text them"));
check("The page passes only clientEventData and clientAsks", src("app/s/page.tsx").includes("initialEventData={clientEventData(data.event_data)}") && src("app/s/page.tsx").includes("initialAsks={clientAsks(data.event_data"));
check("The chat never sends team notes to the browser", src("app/api/chat/route.ts").includes("eventData: clientEventData(result.eventData)") && src("app/api/chat/route.ts").includes("eventData: clientEventData(completeData"));
check("The update concierge never sees the team notes", src("lib/update-prompt.ts").includes("JSON.stringify(clientEventData(eventData), null, 2)"));

const page = (data: Record<string, unknown>, a: typeof asks | null) =>
  textOf(
    renderToStaticMarkup(
      React.createElement(UpdateMode, {
        sessionId: "s1",
        clientName: String(data.client_name ?? ""),
        initialEventData: data,
        initialAsks: a,
        initialVersion: 1,
        initialUpdatedAt: "2026-11-21T18:00:00Z",
        initialMessages: [],
        showList: true,
        menu: null,
        extra: React.createElement(PlannersCard, { sessionId: "s1", planners: [{ id: "p1", name: "Riley", company: "Riley Events" }], pricingOn: false, activity: [] }),
      })
    )
  );

const text = page(clientData, asks);
const hits = (t: string) => [...BANNED.filter((re) => re.test(t)).map(String), ...teamNotes.filter((n) => t.includes(n)), ...teamNotes.flatMap((n) => n.split(/(?<=\.)\s/)).filter((part) => part.length > 20 && t.includes(part))];
check("No text on the client page says the client, ask the client, text them, or anything from the team notes", hits(text).length === 0, hits(text).join(" | "));
check("The client sees: Your drink menu is not finished yet.", text.includes("Your drink menu is not finished yet."));
check("...with the button Finish my drink menu", text.includes("Finish my drink menu"));
check("The client sees the extra drink question, written to them", text.includes("You named a 4th drink: Christmas Bourbon Old Fashioned. Your package includes 3. Add it for $50?"), text);
check("...with Yes and No", /\nYes\n/.test(`\n${text}\n`) && /\nNo\n/.test(`\n${text}\n`));
check("Special requests show only what the client asked for", text.includes("Bar faces the tree"));
check("The label is Name, never Client", text.includes("\nName\n") && !/\nClient\n/.test(text));
check("You provide the alcohol", text.includes("You provide the alcohol."), text);
check("A drink's name and its spirit are separate lines, never run together", text.includes("Mistletoe Mojito\nrum") && !text.includes("Mistletoe Mojitorum"));
check("A drink with no recipe says so plainly", text.includes("Recipe not finished yet"));

// An older event whose notes were still inside special_requests: hidden all the same.
const legacy = { ...PAYLOAD, signature_drinks: PAYLOAD.signature_drinks.slice(0, 3), special_requests: ["Bar faces the tree", ...teamNotes].join("\n") };
delete (legacy as Record<string, unknown>).drinks_finalized;
const legacyText = page(notes.clientEventData(notes.withClientVoice(legacy)), null);
check("An event not moved yet: the old lines in special requests never show", hits(legacyText).length === 0 && legacyText.includes("Bar faces the tree"), hits(legacyText).join(" | "));
const summaryRaw = textOf(renderToStaticMarkup(React.createElement(EventSummary, { data: notes.withClientVoice(legacy) })));
check("The summary filters them out even if handed the raw event", hits(summaryRaw).length === 0 && summaryRaw.includes("Bar faces the tree"), hits(summaryRaw).join(" | "));

// Every package, in the client's voice.
for (const g of info.PACKAGE_GUIDES) {
  const t = page(notes.clientEventData({ ...PAYLOAD, package: g.name, signature_drinks: [], drinks_finalized: undefined, client_providing_beer_wine: true }), null);
  check(`${g.name}: the client page speaks to the client`, hits(t).length === 0 && !/\bthey\b|\btheir\b/i.test(t), hits(t).join(" | "));
}
check("packageShortFor has a client voice and a team voice", info.packageShortFor("Full Bar", {}, "client")!.provides === "You provide the alcohol." && info.packageShortFor("Full Bar")!.provides === "The client provides the alcohol." && info.packageShortFor("Full Bar", {}, "team")!.provides === "The client provides the alcohol.");
check("The client page uses the client voice", src("app/s/event-summary.tsx").includes('}, "client");'));

// ---------------------------------------------------------------------------
// Moving the notes on existing sessions.
// ---------------------------------------------------------------------------
const moved = notes.moveTeamNotes(legacy)!;
check("Move: the lines leave special requests for team_notes", moved.special_requests === "Bar faces the tree" && moved.team_notes === teamNotes.join("\n"));
check("Move: an older Not confirmed line becomes the client's Yes or No question", JSON.stringify(moved.unconfirmed_drinks) === JSON.stringify([{ name: "Christmas Bourbon Old Fashioned" }]));
check("Move: the team side reads the same before and after", notes.teamRequestsText(moved) === notes.teamRequestsText(legacy));
check("Move: nothing to do when there are no team lines", notes.moveTeamNotes({ special_requests: "Extra limes" }) === null);
check("Move: names from a two drink line", JSON.stringify(notes.namesInNotConfirmed("Not confirmed: A Drink, B Drink as additional drinks ($50 each). Ask the client before adding.")) === JSON.stringify(["A Drink", "B Drink"]));

// ---------------------------------------------------------------------------
// Yes adds it as a priced change, the normal way; No drops it.
// ---------------------------------------------------------------------------
const deadlines = { withinSixDays: false } as never;
const three = PAYLOAD.signature_drinks.slice(0, 3).map((d) => ({ ...d, ingredients: ["2 oz spirit"] }));
const yes = diff.planUpdate({ ...saved, signature_drinks: three }, { signature_drinks: [...three, PAYLOAD.signature_drinks[3]], [notes.ACCEPT_EXTRA_DRINKS]: true }, { deadlines });
check("Yes: the 4th drink is added, not turned into a manager request", (yes.next.signature_drinks as unknown[]).length === 4 && !yes.requests && yes.acceptedExtras.length === 1);
check("Yes: with every recipe in, the menu is finished and its team note comes off", yes.next.drinks_not_finalized === undefined && !String(yes.next.team_notes ?? "").includes("Drinks not finalized"));
const noFlag = diff.planUpdate({ ...saved, signature_drinks: three }, { signature_drinks: [...three, PAYLOAD.signature_drinks[3]] }, { deadlines });
check("Without the client's Yes a 4th drink is still a manager request", (noFlag.next.signature_drinks as unknown[]).length === 3 && !!noFlag.requests);
check("The concierge can never send the Yes itself", src("app/api/chat/route.ts").includes("const input = updateToolInput(eventData, toolUse.input") && !(notes.ACCEPT_EXTRA_DRINKS in notes.updateToolInput({}, { [notes.ACCEPT_EXTRA_DRINKS]: true, guest_count: 80 })));
const booked = { total: 2400, package_price: 2000, gratuity: 400, deposit_paid: 150 } as never;
const p = eu.extraDrinksPrice([{ name: "Christmas Bourbon Old Fashioned" }], null, booked, { pending: false, version: 1 });
check("Yes: priced at $50, the booked total moves from $2,400 to $2,450", p.amount === 50 && p.new_total === 2450 && p.package_price === 2050 && p.gratuity === 400 && p.booked_total === 2400, JSON.stringify(p));
check("Yes: the price text the team and GHL see", p.price_text === "The difference is $50, which brings your new total to $2,450." && p.summary.includes("Christmas Bourbon Old Fashioned ($50 each)"));
const unknown = eu.extraDrinksPrice([{ name: "X" }], null, null, { pending: false });
check("Yes with no booked total: saved with the price pending, our team confirms it", unknown.amount === null && unknown.new_total === null);
check("Inside six days a Yes stays a Yes when an admin approves the request", eu.requestParts(saved, { signature_drinks: [], [notes.ACCEPT_EXTRA_DRINKS]: true }, [], [{ field: "signature_drinks[3]", old: null, new: {} }])?.partial[notes.ACCEPT_EXTRA_DRINKS] === true);
const cleared = notes.clearUnconfirmed(saved, "Client said no to the additional drink: Christmas Bourbon Old Fashioned.");
check("No: the drink and its Not confirmed note come off, the team note says what they answered", !cleared.unconfirmed_drinks && !String(cleared.team_notes).includes("Not confirmed") && String(cleared.team_notes).includes("Client said no") && String(cleared.team_notes).includes("Drinks not finalized"));
check("...and after answering, the question is gone from the page", !page(notes.clientEventData(cleared), notes.clientAsks(cleared, 3)).includes("Add it for $50?"));

// ---------------------------------------------------------------------------
// Events submitted before 2026-11-21: special requests written for our team stay hidden.
// ---------------------------------------------------------------------------
const OLD = {
  ...PAYLOAD,
  package: "Full Bar",
  drinks_finalized: undefined,
  signature_drinks: three,
  special_requests: "Client claims they were promised a 1:1 ratio drink. Bartender should avoid soda water. Please have Diet Coke and Sprite.",
};
const oldClient = notes.clientEventData(OLD);
check("Older event: the free text never reaches the browser", !("special_requests" in oldClient) && !JSON.stringify(oldClient).includes("promised"));
check("Older event: nothing is deleted, the team side reads it as before", notes.teamRequestsText(OLD) === OLD.special_requests && notes.teamEventData(OLD).special_requests === OLD.special_requests);
const cl = await import("../lib/client-list.ts");
check("Older event: the sodas it asked for stay on the client's shopping list", JSON.stringify(cl.clientList(oldClient)) === JSON.stringify(cl.clientList(OLD)) && JSON.stringify(oldClient.extra_sodas) === JSON.stringify((await import("../lib/extra-sodas.ts")).parseExtraSodas(OLD.special_requests)) && (oldClient.extra_sodas as string[]).includes("Sprite"));
const oldText = page(oldClient, null);
check("Older event: the page shows none of it, and no Requests line saying None", !/promised|Bartender should|Diet Coke and Sprite/.test(oldText) && !oldText.includes("\nRequests\n") && hits(oldText).length === 0, hits(oldText).join(" | "));
check("New event: its requests, written to the client, show", text.includes("\nRequests\nBar faces the tree"));
check("The marker never goes to GHL or the events row", !("requests_voice" in notes.teamEventData(saved)) && !("requests_voice" in row));
check("Only the intake concierge marks a submission as written to the client", src("app/api/chat/route.ts").includes("const input = withClientVoice(drinks.data);") && !src("scripts/admin-submit-session.mts").includes("withClientVoice") && !src("lib/manual-event.ts").includes("withClientVoice"));

// ---------------------------------------------------------------------------
// Both concierge prompts: client requests to the client, team things in team notes.
// ---------------------------------------------------------------------------
const sp = await import("../lib/system-prompt.ts");
const up = await import("../lib/update-prompt.ts");
const tools = await import("../lib/intake-tools.ts");
const intakePrompt = sp.buildIntakePrompt(null);
check("Intake prompt: the special requests and team notes rule", intakePrompt.includes(sp.REQUESTS_AND_NOTES_RULE) && sp.REQUESTS_AND_NOTES_RULE.includes('Never write "the client"') && sp.REQUESTS_AND_NOTES_RULE.includes("team_notes"));
check("Intake prompt: no instruction left that writes team wording into special requests", !intakePrompt.includes('"Client requested dual bar setup') && !intakePrompt.includes("the team needs to follow up, then move on") && !intakePrompt.includes("placeholder note in special_requests"));
const submitProps = (tools.submitEventDataTool.input_schema as { properties: Record<string, { description?: string }> }).properties;
check("The submit tool takes team_notes, and says special requests are written to the client", !!submitProps.team_notes && /written to them/.test(submitProps.special_requests.description ?? ""));
const dl = diff.computeDeadlines("December 11, 2026", new Date("2026-11-21T12:00:00Z"));
const newPrompt = up.buildUpdatePrompt(saved, 1, dl);
const oldPrompt = up.buildUpdatePrompt(OLD, 1, dl);
check("Update prompt: the same rule, and a team note is one at a time", newPrompt.includes(sp.REQUESTS_AND_NOTES_RULE) && newPrompt.includes("team_note on update_event_data"));
check("Update prompt, new event: send the complete special requests text", newPrompt.includes("send the COMPLETE special_requests text"));
check("Update prompt, older event: the earlier text is not shown, send only the new line", oldPrompt.includes("send ONLY the new line") && !oldPrompt.includes("promised a 1:1"));
check("Update prompt: no team notes in it", !newPrompt.includes("Text them to finish") && !newPrompt.includes(teamNotes[0]));
const chatSrc = src("app/api/chat/route.ts");
check("Update tool: team_note, never the whole team_notes", chatSrc.includes("team_note: {") && chatSrc.includes('UPDATABLE_FIELDS.filter((field) => field !== "team_notes")'));
const added = notes.updateToolInput(saved, { team_note: "Manager to confirm the cinnamon syrup.", team_notes: "wiped" });
check("A team note is added to the notes on file, never replacing them", added.team_notes === [...teamNotes, "Manager to confirm the cinnamon syrup."].join("\n"));
check("Older event: a new request is added to the earlier text, nothing lost", notes.updateToolInput(OLD, { special_requests: "You will provide your own cups." }).special_requests === `${OLD.special_requests}\nYou will provide your own cups.`);
check("New event: the complete text replaces it, as before", notes.updateToolInput(saved, { special_requests: "Bar faces the window" }).special_requests === "Bar faces the window");
const noteRow = diff.planUpdate(saved, { team_notes: added.team_notes }, { deadlines });
check("A team note is a saved change, so the team and GHL hear about it", !!noteRow.applied && noteRow.applied.changes.some((c) => c.field === "team_notes"));
check("...but it is never read back to the client in the recap", diff.recapLines(noteRow.applied!.changes).length === 0 && diff.recapLines(noteRow.applied!.changes, { team: true }).length === 1);

// ---------------------------------------------------------------------------
// The event home: every new section speaks to the client, shows no team or
// money detail it should not, and the payment never guesses a balance.
// ---------------------------------------------------------------------------
const home = await import("../lib/event-home.ts");
const money = (o: Partial<Parameters<typeof home.paymentView>[0]>) =>
  home.paymentView({ money: home.ALL_MONEY, total: 2400, pricePending: false, eventDay: "2026-12-11", payments: [], preference: "Zelle", ...o });
const noPays = money({})!;
check("Payment: the package total and the due date always", noPays.total === "$2,400" && noPays.due === "Friday, November 27, 2026", JSON.stringify(noPays));
check("Payment: with no payments recorded, no paid or balance number, and no invitation to text", noPays.paid === "" && noPays.balance === "" && !JSON.stringify(noPays).includes("Text us"));
const paid = money({ payments: [{ cents: 15000 }, { cents: 50000 }] })!;
check("Payment: with payments recorded, paid and balance from them", paid.paid === "$650" && paid.balance === "$1,750");
check("Payment: a total being confirmed shows no total and no balance, only what is known", (() => { const p = money({ pricePending: true, payments: [{ cents: 15000 }] })!; return p.total === "" && p.balance === "" && p.paid === "$150" && p.due !== ""; })());
check("Payment: no booked total and no payments shows only the due date and how they chose to pay", (() => { const p = money({ total: null })!; return p.total === "" && p.balance === "" && p.paid === "" && p.due === "Friday, November 27, 2026" && p.preference === "Zelle" && !JSON.stringify(p).includes("Text us"); })());
check("Payment: knowing neither the due date nor how they chose to pay leaves the section out", money({ total: null, eventDay: null, preference: "" }) === null);
check("Payment: the page never invites a text for the total or balance", !/Text us for your (package total|current balance)/.test(src("lib/event-home.ts") + src("app/_event-home/sections.tsx")));
check("Payment: a planner without pricing sees no payment section at all", home.paymentView({ money: home.NO_MONEY, total: 2400, pricePending: false, eventDay: "2026-12-11", payments: [{ cents: 15000 }], preference: "" }) === null);
check("Payment: a host with Host can see pricing sees the total and due date only", (() => { const p = home.paymentView({ money: { ...home.NO_MONEY, total: true }, total: 2400, pricePending: false, eventDay: "2026-12-11", payments: [{ cents: 15000 }], preference: "Zelle" })!; return p.total === "$2,400" && p.balance === "" && p.paid === "" && p.preference === ""; })());
check("Payment: the planner page never falls back to the deposit", !src("lib/partners/event-page.ts").includes("|| Number(s.booked_price?.deposit_paid") && !src("lib/event-home-db.ts").includes("deposit_paid"));

const todo = home.buildTodo(clientData, { asks, balance: { amount: 1750, due: "Friday, November 27, 2026" }, past: false });
check("Checklist: finish drinks, the extra drink, day of contact, guest count, balance", ["drinks", "extra_drink", "day_of_contact", "guest_count", "balance"].every((k) => todo.some((t) => t.key === k)), todo.map((t) => t.key).join());
check("Checklist: only what is missing is open", todo.find((t) => t.key === "drinks")!.done === false && todo.find((t) => t.key === "guest_count")!.done === false);
check("Checklist: no balance item without recorded payments", !home.buildTodo(clientData, { asks, balance: null, past: false }).some((t) => t.key === "balance"));
check("Checklist: nothing after the event", home.buildTodo(clientData, { asks, balance: null, past: true }).length === 0);
const confirmed = { ...clientData, guest_count: 60, [home.GUEST_CONFIRMED_FIELD]: { count: "60", at: "x" } };
check("Guest count: confirmed while the count is unchanged, open again after a change", home.guestCountConfirmed(confirmed) && !home.guestCountConfirmed({ ...confirmed, guest_count: 75 }));
check("Status line: things left, all set, and past", home.statusLine(3, 20) === "3 things left to do" && home.statusLine(0, 20) === "You are all set." && home.countdown(20) === "20 days to go" && home.countdown(0) === "Today");
check("Guest count confirm touches nothing else: no texts, no GHL, no new version", (() => { const r = src("app/api/client-guest-count/route.ts").replace(/^\s*\/\/.*$/gm, ""); return r.includes("setInternal(") && !/sendSms|textClient|ghl|deliverEventUpdates|applyEventUpdate/i.test(r); })());

const HOME = {
  date: "Friday, December 11, 2026",
  daysUntil: 20,
  past: false,
  team: [{ name: "Taylor", role: "" }, { name: "Jordan", role: "" }],
  payment: noPays,
  paymentLines: [],
  balance: null,
  agreements: [{ id: "a1", label: "Signed agreement", typeLabel: "PDF" }],
  listTiming: "review" as const,
  requests: [{ summary: "Guest count: from 60 to 75", status: home.REQUEST_STATUS.pending, when: "November 20, 2026" }],
};
const homePage = (h: typeof HOME, showList = false) =>
  textOf(
    renderToStaticMarkup(
      React.createElement(UpdateMode, {
        sessionId: "s1",
        clientName: String(clientData.client_name ?? ""),
        initialEventData: clientData,
        initialAsks: asks,
        initialVersion: 1,
        initialUpdatedAt: "2026-11-21T18:00:00Z",
        initialMessages: [],
        showList,
        menu: null,
        home: h,
        extra: React.createElement(PlannersCard, { sessionId: "s1", planners: [{ id: "p1", name: "Riley", company: "Riley Events" }], pricingOn: false, activity: [] }),
      })
    )
  );
const ht = homePage(HOME);
check("Home: no text says the client, ask the client, text them, or anything from the team notes", hits(ht).length === 0, hits(ht).join(" | "));
check("Home top: the event, the date, the countdown and the status line", ht.includes("2nd Annual Christmas Gift Exchange") && ht.includes("Friday, December 11, 2026") && ht.includes("20 days to go") && /\d things? left to do/.test(ht));
check("Home top: one always visible button, Change something or ask a question", ht.includes("Change something or ask a question"));
check("Home: What we need from you, written to the client", ht.includes("What we need from you") && ht.includes("Your drink menu is not finished yet.") && ht.includes("Give us a day of contact") && ht.includes("Confirm your final guest count: 60 guests.") && ht.includes("Yes, 60 is final"));
check("Home: Your day in plain words", ht.includes("Your day") && ht.includes("Our team arrives to set up") && ht.includes("Bar service starts") && ht.includes("Breakdown finishes"));
check("Home: Your plan with a Change button on each part", ht.includes("Your plan") && (ht.match(/\nChange\n/g) ?? []).length >= 7);
check("Home: Your requests, with where each one stands", ht.includes("Your requests") && ht.includes("Guest count: from 60 to 75") && ht.includes("Waiting for our team's approval"));
check("Home: the shopping list says when to expect it", ht.includes("We are checking the recipes you gave us."));
check("Home: Your bar team, first names only, and never Bartender for everyone", ht.includes("Your bar team") && ht.includes("Taylor") && ht.includes("Jordan") && !/Bartender/.test(ht.slice(ht.indexOf("Your bar team"), ht.indexOf("Payment"))));
check("Home: an empty team reads plainly", homePage({ ...HOME, team: [] }).includes(home.TEAM_LATER));
check("Home: Payment with the total and due date, and no balance number or text invitation without payments", ht.includes("Package total") && ht.includes("$2,400") && ht.includes("Balance due by") && !ht.includes("Text us for your") && !ht.includes("Paid so far"));
const htPaid = homePage({ ...HOME, payment: paid, paymentLines: [{ amount: "$150", on: "October 1, 2026" }] });
check("Home: with payments recorded, paid and balance show", htPaid.includes("Paid so far") && htPaid.includes("$650") && htPaid.includes("$1,750"));
check("Home: Your agreement with view and download", ht.includes("Your agreement") && ht.includes("Signed agreement") && ht.includes("View (PDF)"));
check("Home: planners after the agreement, help at the very bottom", ht.indexOf("Riley") > ht.indexOf("Your agreement") && ht.trimEnd().endsWith("Text us 469 754 8512"));
check("Home: the order is top, checklist, your day, plan, menu, list, team, payment, agreement, planners, help", (() => {
  const at = ["Change something or ask a question", "What we need from you", "Your day", "Your plan", "Your shopping list", "Your bar team", "Payment", "Your agreement", "Riley", "Text us 469 754 8512"].map((t) => ht.indexOf(t));
  return at.every((n, i) => n >= 0 && (i === 0 || n > at[i - 1]));
})());
check("Home: the chat is closed until a button opens it", src("app/s/update-mode.tsx").includes("useState(false)") && src("app/s/update-mode.tsx").includes('chatOpen ? "flex" : "hidden"'));
check("Home data reads no internal fields, pay, notes, phones or suppliers", (() => { const d = src("lib/event-home-db.ts"); return !/team_notes|pay_rate|hourly|ratings|supplier|\.note\b|created_by_name|recordedBy|phone/.test(d.replace(/^\s*\/\/.*$/gm, "")); })());
check("Home: the agreement route opens current agreements only, behind the client link check", (() => { const r = src("app/api/agreement/route.ts"); return r.includes("clientLinkBlocked(") && src("lib/event-home-db.ts").includes('.eq("status", "current")'); })());
check("Planner page: the same home sections, money by moneyAccess", (() => { const p = src("app/partners/e/[key]/page.tsx"); return p.includes("eventHome(access.session, money)") && p.includes("v.money.total") && p.includes("<PaymentCard") && p.includes("<BarTeam") && p.includes("<Checklist"); })());
check("Planner page: the extra drink price only for a planner who sees the total", src("app/partners/e/[key]/page.tsx").includes("asks && !money.total ? { ...asks, extraDrinks: [] } : asks"));

// ---------------------------------------------------------------------------
// Older events' other free text fields, the payment with nothing known, and
// the team side's guest count confirmation.
// ---------------------------------------------------------------------------
const OLD_FIELDS = {
  ...OLD,
  beer_and_wine_details: "Client provides all beer and wine at the venue",
  bar_details: "Bar will be set up downstairs near the patio.",
  parking_info: "Client says they can park in the driveway.",
  bar_on_site: "Yes, a built in bar",
};
const oldFieldsClient = notes.clientEventData(OLD_FIELDS);
check("Older event: a field written about the client is hidden on the client page", !("beer_and_wine_details" in oldFieldsClient) && !("parking_info" in oldFieldsClient));
check("Older event: a field written plainly still shows", oldFieldsClient.bar_details === OLD_FIELDS.bar_details && oldFieldsClient.bar_on_site === OLD_FIELDS.bar_on_site);
check("New event: every field shows, the concierge writes it to the client", (() => { const n = notes.clientEventData(notes.withClientVoice({ beer_and_wine_details: "Client provides the beer" })); return n.beer_and_wine_details === "Client provides the beer"; })());
check("The team side, GHL and the events row keep every field as is", (() => { const t = notes.teamEventData(OLD_FIELDS); return t.beer_and_wine_details === OLD_FIELDS.beer_and_wine_details && t.parking_info === OLD_FIELDS.parking_info; })());
const oldFieldsPage = textOf(renderToStaticMarkup(React.createElement(EventSummary, { data: oldFieldsClient })));
check("Older event page: no field text about the client", !/Client provides|Client says/.test(oldFieldsPage) && oldFieldsPage.includes("Bar will be set up downstairs"));
const fieldEdit = notes.updateToolInput(OLD_FIELDS, { beer_and_wine_details: "You will bring the beer and wine." });
check("A hidden field the client changes keeps the earlier text as a team note, nothing lost", fieldEdit.beer_and_wine_details === "You will bring the beer and wine." && String(fieldEdit.team_notes).includes("Earlier beer and wine details: Client provides all beer and wine at the venue"));
check("...and the new text, written to the client, shows on their page", notes.clientEventData({ ...OLD_FIELDS, ...fieldEdit }).beer_and_wine_details === "You will bring the beer and wine.");
const oldFieldsPrompt = up.buildUpdatePrompt(OLD_FIELDS, 1, dl);
check("Update prompt, older event: the hidden fields are named, their text is not in it", oldFieldsPrompt.includes("beer and wine details (beer_and_wine_details)") && !oldFieldsPrompt.includes("Client provides all beer and wine"));

const nothingKnown = textOf(renderToStaticMarkup(React.createElement(UpdateMode, { sessionId: "s1", clientName: "", initialEventData: clientData, initialAsks: asks, initialVersion: 1, initialUpdatedAt: null, initialMessages: [], home: { ...HOME, payment: home.paymentView({ money: home.ALL_MONEY, total: null, pricePending: false, eventDay: null, payments: [], preference: "" }) } })));
check("Home: with nothing known about the payment, the Payment section is left out", !nothingKnown.includes("Payment") && !nothingKnown.includes("Text us for your"));
check("Planner page: the same payment rule (the shared paymentView and PaymentCard)", src("app/partners/e/[key]/page.tsx").includes("<PaymentCard payment={home.payment}") && src("lib/event-home-db.ts").includes("paymentView("));

const ev = await import("../lib/team/event-view.ts");
const confirmedSession = { id: "x", event_date: "2026-12-11", event_data: { ...saved, guest_count: 60, [home.GUEST_CONFIRMED_FIELD]: { count: "60", at: "2026-11-21T18:00:00Z" } } };
check("Team Details: Guest count confirmed by client, with the date", ev.buildStaffEventView(confirmedSession as never).guestCountConfirmed === "November 21, 2026" && src("app/team/e/[id]/event-details.tsx").includes('label="Guest count confirmed by client"'));
check("Team Details: nothing once the count changes after", ev.buildStaffEventView({ ...confirmedSession, event_data: { ...confirmedSession.event_data, guest_count: 75 } } as never).guestCountConfirmed === "");

done("client voice");
