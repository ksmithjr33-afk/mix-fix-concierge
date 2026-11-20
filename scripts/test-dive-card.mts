// Dive Bar menu card on request (2026-11-20). Dive Bar has no printed menu by
// default. Only when the client asks for a menu can the concierge offer a
// printed card with three classics they pick from the classics Dive Bar allows,
// each additional classic $50 (up to three more, six at most), handled like
// extra signature drinks on Full Bar. The picks replace the set menu, the
// alcohol shopping list does not change, and Menu pickup turns on.
// Real code against the in-memory database.
// Run: node --no-warnings scripts/test-dive-card.mts

import { addDays, check, done, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const dive = await import("../lib/dive-menu.ts");
const { SYSTEM_PROMPT, DRINK_MENU_RULES } = await import("../lib/system-prompt.ts");
const { buildUpdatePrompt } = await import("../lib/update-prompt.ts");
const diff = await import("../lib/event-diff.ts");
const list = await import("../lib/shopping-list.ts");
const { buildEventFields } = await import("../lib/ghl-payload.ts");
const view = await import("../lib/team/event-view.ts");
const updates = await import("../lib/event-updates.ts");
const orderSheet = await import("../lib/order-sheet.ts");
const info = await import("../lib/packages-info.ts");
const pp = await import("../lib/package-prompt.ts");
const time = await import("../lib/team/time.ts");
const { SESSION_ONLY_FIELDS } = await import("../lib/events-row.ts");
const { submitEventDataTool } = await import("../lib/intake-tools.ts");

const names = (ds: unknown) => ((ds as { name: string }[]) ?? []).map((d) => d.name);
const FIVE = ["Margarita", "Old Fashioned", "Cosmopolitan", "Lemon Drop", "Moscow Mule"];
const pick = (...n: string[]) => n.map((name) => ({ name, menu_name: name, base_spirit: "", ingredients: [] }));
const far = diff.computeDeadlines("2027-03-01", new Date("2026-11-20T12:00:00Z"));
const near = diff.computeDeadlines("2026-11-23", new Date("2026-11-20T12:00:00Z"));
const setMenuEvent = (extra: Record<string, unknown> = {}) =>
  dive.applyDiveSetMenu({ package: "Dive Bar", guest_count: 100, signature_drinks: [], ...extra }) as Record<string, unknown>;
const lines = SYSTEM_PROMPT.split("\n");
const flow = lines.find((l) => l.startsWith("Dive Bar Package: LOGISTICS")) ?? "";
const sourcing = lines.find((l) => l.startsWith("DIVE BAR MENU CARD ON REQUEST:")) ?? "";

// ----- 1. Not offered unless the client asks -----
check("The Dive Bar flow never brings up a menu card", flow.includes("Do NOT ask whether they want a signature cocktail menu or a menu card, and never mention a menu card unless the client asks for a menu"));
check("The rule says only if the client asks", sourcing.startsWith("DIVE BAR MENU CARD ON REQUEST: Never bring up a menu or a menu card on Dive Bar yourself. Only if the client asks for a menu, a printed menu, or a menu card, offer one"));
check("The offer is worded exactly", sourcing.includes(`saying exactly: "${dive.DIVE_CARD_OFFER_LINE}"`) && dive.DIVE_CARD_OFFER_LINE === "We can add a printed menu card with three classics you pick. Each additional classic is $50, up to three more.");
check("The set menu line says nothing about a card", !/card/i.test(dive.DIVE_SET_MENU_LINE) && !/card/i.test(dive.DIVE_MENU_SET_MESSAGE));
const upNoCard = buildUpdatePrompt(setMenuEvent() as never, 2, far);
check("Update mode: never brought up, offered only when asked", upNoCard.includes("Never bring up a menu card yourself. The one exception: if the client asks for a menu, a printed menu, or a menu card, say exactly:") && upNoCard.includes(dive.DIVE_CARD_OFFER_LINE));
check("Update mode for other packages has no Dive Bar section", !/^DIVE BAR (MENU CARD|SET MENU):/m.test(buildUpdatePrompt({ package: "Full Bar" } as never, 2, far)));

// ----- 2. Classics only -----
const allowed = dive.diveCardClassics().map((c) => c.name);
const allClassics = dive.classicRecipes().map((c) => c.name);
check("The card list is every classic less the drinks Dive Bar leaves out", allowed.join() === allClassics.filter((n) => !(dive.DIVE_NOT_AVAILABLE as readonly string[]).includes(n)).join() && !dive.DIVE_NOT_AVAILABLE.some((n) => allowed.includes(n)) && FIVE.every((n) => allowed.includes(n)));
check("The planning prompt lists exactly those classics", sourcing.includes(`from this list only: ${dive.diveCardClassicNames()}.`));
check("Update mode lists exactly those classics", upNoCard.includes(`The card holds only these classics: ${dive.diveCardClassicNames()}.`));
check("Called classics for your menu card, never signature or specialty", sourcing.includes('Call them "classics for your menu card", never signature or specialty cocktails') && upNoCard.includes('Call them "classics for your menu card", never signature or specialty cocktails'));
check("Outside the classics: a Full Bar feature with the upgrade offered (planning)", sourcing.includes(`say: "${dive.DIVE_CARD_FULL_BAR_LINE}"`) && dive.DIVE_CARD_FULL_BAR_LINE.startsWith("That is a Full Bar feature.") && /representative reach out about the upgrade to Full Bar/.test(dive.DIVE_CARD_FULL_BAR_LINE));
check("Outside the classics: a Full Bar feature with the package change offered (update mode)", upNoCard.includes("say that is a Full Bar feature and offer to switch the package to Full Bar, which is a PRICE CHANGE"));
const bad = dive.cardPicks([
  { name: "Espresso Martini" },
  { name: "French Martini" }, // craft menu
  { name: "Cucumber Cooler", is_mocktail: true },
  { name: "Grandma's Punch", is_custom: true, ingredients: ["2 oz rum"] },
  { name: "Margarita", is_mocktail: true },
  { name: "Mojito" },
  "Paloma",
]);
check("Specialty, craft, mocktail, custom and excluded drinks are refused", names(bad.drinks).join() === "Paloma" && bad.refused.join() === "Espresso Martini,French Martini,Cucumber Cooler,Grandma's Punch,Margarita,Mojito", JSON.stringify(bad));
const loose = dive.cardPicks([{ name: "moscow mule" }, { name: "Gin & Tonic" }, { name: "My Cosmo", menu_name: "Cosmopolitan" }, { name: "Moscow Mule" }]);
check("Names match loosely, by menu name too, and repeats drop", names(loose.drinks).join() === "Moscow Mule,Gin and Tonic,Cosmopolitan" && loose.refused.length === 0);
const recipe = dive.cardPicks([{ name: "Paloma", ingredients: ["3 oz tequila", "2 oz mezcal"], base_spirit: "mezcal" }]).drinks[0];
check("A card classic always gets its CLASSICS recipe and standard name", recipe.name === "Paloma" && recipe.ingredients.join() === "2 oz tequila,0.5 oz lime juice,top with grapefruit soda" && recipe.base_spirit === "tequila" && recipe.description === "Dive Bar menu card");

// ----- 3. Three accepted with no charge (planning chat submit) -----
const three = setMenuEvent({ dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75") });
check("Three classics at submit become the event's menu", names(three.signature_drinks).join() === "Paloma,Manhattan,French 75" && three.dive_menu_card === true && three.dive_set_menu === false);
check("Three classics are included: no extras", dive.cardExtras(3) === 0 && dive.DIVE_CARD_INCLUDED === 3);
check("No card asked: the set menu, whatever drinks were sent", names(setMenuEvent({ signature_drinks: pick("Paloma") }).signature_drinks).join() === FIVE.join() && setMenuEvent().dive_menu_card === false);
check("A card with only refused picks falls back to the set menu", names(setMenuEvent({ dive_menu_card: true, signature_drinks: pick("Espresso Martini") }).signature_drinks).join() === FIVE.join());
check("The submit tool has dive_menu_card", !!(submitEventDataTool.input_schema.properties as Record<string, unknown>).dive_menu_card && SYSTEM_PROMPT.includes("dive_menu_card (boolean: true only on Dive Bar when the client asked for a menu card and picked its classics"));
check("dive_menu_card is kept on the session only", (SESSION_ONLY_FIELDS as readonly string[]).includes("dive_menu_card"));

// ----- 4. A fourth at $50, like extra signature drinks on Full Bar -----
check("Planning: the fourth is quoted at $50 before it is added", sourcing.includes(`stop and quote it BEFORE adding it, saying "${dive.DIVE_CARD_EXTRA_LINE}" and add it only on a clear yes`) && dive.DIVE_CARD_EXTRA_LINE.includes("Each additional classic is $50"));
check("Planning: worded like the Full Bar heads up", SYSTEM_PROMPT.includes("Just a heads up, your package includes [package count] signature drinks. Each additional drink is $50.") && sourcing.includes("exactly like additional signature drinks on Full Bar"));
const four = setMenuEvent({ dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75", "Gimlet") });
check("Planning: four classics the client said yes to are all recorded, one extra", names(four.signature_drinks).length === 4 && dive.cardExtras(4) === 1 && dive.DIVE_CARD_EXTRA_PRICE === 50);
const cardEvent = setMenuEvent({ dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75") });
const upFour = diff.planUpdate(cardEvent, { dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75", "Gimlet") }, { deadlines: far });
check("Update mode: a fourth is a manager request, exactly like Full Bar", !upFour.applied && !!upFour.requests && String(upFour.requests.changes[0].new).startsWith("Add drinks beyond the package count: Gimlet") && diff.approvalReason(upFour.requests) === "extra drinks");
const fullFour = diff.planUpdate({ package: "Full Bar", signature_drinks: pick("A", "B", "C") }, { signature_drinks: pick("A", "B", "C", "D") }, { deadlines: far });
check("Full Bar's fourth drink goes the same way", !!fullFour.requests && diff.approvalReason(fullFour.requests) === "extra drinks" && !fullFour.applied);
check("Update mode quotes no price for the extra, like Full Bar", upNoCard.includes("A classic past 3 follows MANAGER REQUESTS exactly like additional signature drinks on Full Bar") && upNoCard.includes("including the $50 additional drink price"));
const sixOnFile = setMenuEvent({ dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75", "Gimlet", "Daiquiri", "Mimosa") });
const swapOnSix = diff.planUpdate(sixOnFile, { signature_drinks: pick("Paloma", "Manhattan", "French 75", "Gimlet", "Daiquiri", "Margarita") }, { deadlines: far });
check("A card that already has six keeps them, and a swap saves", !!swapOnSix.applied && !swapOnSix.requests && names(swapOnSix.next.signature_drinks).at(-1) === "Margarita");

// ----- 5. A seventh refused -----
const seven = dive.cardPicks(pick("Paloma", "Manhattan", "French 75", "Gimlet", "Daiquiri", "Mimosa", "Margarita"));
check("Seven picks: six kept, the seventh refused", seven.drinks.length === 6 && seven.overMax.join() === "Margarita" && dive.DIVE_CARD_MAX === 6);
check("At submit a seventh is dropped", names(setMenuEvent({ dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75", "Gimlet", "Daiquiri", "Mimosa", "Margarita") }).signature_drinks).length === 6);
const upSeven = diff.planUpdate(sixOnFile, { signature_drinks: pick("Paloma", "Manhattan", "French 75", "Gimlet", "Daiquiri", "Mimosa", "Margarita") }, { deadlines: far });
check("Update mode: a seventh is refused, not sent to a manager", upSeven.diveCardOverMax.join() === "Margarita" && !upSeven.applied && !upSeven.requests);
check("The prompts refuse a seventh", sourcing.includes(`a seventh is refused, say "${dive.DIVE_CARD_FULL_LINE}"`) && upNoCard.includes(dive.DIVE_CARD_FULL_LINE));
const upBad = diff.planUpdate(cardEvent, { signature_drinks: pick("Paloma", "Manhattan", "Espresso Martini") }, { deadlines: far });
check("Update mode: an excluded drink is refused and the rest saves", upBad.diveCardRefused.join() === "Espresso Martini" && names(upBad.next.signature_drinks).join() === "Paloma,Manhattan");
const chat = src("app/api/chat/route.ts");
check("The chat route tells the bot about refused picks: Full Bar feature, and the six limit", chat.includes("parts.push(...diveCardLines(result));") && chat.includes("Tell the client that is a Full Bar feature") && chat.includes("holds at most ${DIVE_CARD_MAX} classics"));

// ----- 6. The shopping list alcohol does not change -----
const alcohol = (e: Record<string, unknown>) => {
  const out: Record<string, string> = {};
  for (const i of list.generateShoppingList(e as never)) if (i.category === "Spirits" || i.category === "Beer & Wine") out[i.item.toLowerCase()] = i.quantity;
  return JSON.stringify(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};
const cards = [
  pick("Paloma", "Manhattan", "French 75"),
  pick("Paloma", "Manhattan", "French 75", "Gimlet", "Dark and Stormy", "Mimosa"),
  pick("Whiskey Sour", "Kentucky Mule", "Dirty Martini"),
  pick("Ranch Water", "Tequila Sunrise", "Western Chilton", "Pina Colada"),
];
const mismatches: string[] = [];
for (const guests of [30, 75, 100, 150, 250]) {
  for (const [start, end] of [["6:00 PM", "10:00 PM"], ["2:00 PM", "8:00 PM"]]) {
    for (const venue_type of ["venue", "private_residence"]) {
      const base = { guest_count: guests, bar_service_start: start, bar_service_end: end, venue_type, event_type: "birthday", drinking_pace: "moderate" };
      const before = alcohol(setMenuEvent(base));
      for (const c of cards) {
        const now = alcohol(setMenuEvent({ ...base, dive_menu_card: true, signature_drinks: c }));
        if (now !== before) mismatches.push(`${guests} ${start} ${venue_type} ${names(c).join("/")}: ${before} vs ${now}`);
      }
    }
  }
}
check("A menu card never changes the alcohol on the shopping list (80 cases)", mismatches.length === 0, mismatches.slice(0, 2).join("\n"));
check("The card's classics are what the supply list shows", (() => {
  const s = list.generateNatalieSupplyList(three as never);
  return ["Paloma", "Manhattan", "French 75"].every((n) => s.includes(n));
})());

// ----- 7. What the card changes on the pages -----
const v = view.buildStaffEventView({ id: "x", event_data: { ...three, event_date: "2027-03-01" } } as never);
const also = (v.classics ?? []).flatMap((g) => g.drinks.map((d) => d.name));
check("Staff page: the card's classics are the menu, labeled Dive Bar menu card", v.menuCard && !v.setMenu && v.drinks.map((d) => d.name).join() === "Paloma,Manhattan,French 75" && src("app/team/e/[id]/event-details.tsx").includes('v.menuCard ? "Dive Bar menu card"'));
check("Staff page: Also available keeps the other classics, not the picks or the excluded drinks", also.includes("Margarita") && !also.includes("Paloma") && !dive.DIVE_NOT_AVAILABLE.some((n) => also.includes(n)));
const vSet = view.buildStaffEventView({ id: "y", event_data: { ...setMenuEvent(), event_date: "2027-03-01" } } as never);
check("Staff page: no card keeps the set menu", vSet.setMenu && !vSet.menuCard && vSet.drinks.map((d) => d.name).join() === FIVE.join());
check("Order sheet: the card's classics are the recipes", orderSheet.recipes(three as never).map((r) => r.name).join() === "Paloma,Manhattan,French 75");
const summary = src("app/s/event-summary.tsx");
check("Client page: the card's classics, never called signature drinks on Dive Bar", summary.includes('data.dive_menu_card === true ? "Your menu card classics" : "Dive Bar set menu"') && summary.includes("{drinksTitle(data)}"));
console.log = () => {};
const cardFields = buildEventFields({ ...three, client_name: "Jamie Cole", event_date: "2027-03-01" }).fields;
const setFields = buildEventFields({ ...setMenuEvent(), client_name: "Jamie Cole", event_date: "2027-03-01" }).fields;
check("The designer gets the card (a printed menu), and nothing without one", !!cardFields.graphic_designer_brief && cardFields.graphic_designer_brief.includes("French 75") && !setFields.graphic_designer_brief);
check("GHL is told about the card", cardFields.dive_menu_card === true && cardFields.dive_set_menu === false && setFields.dive_menu_card === false && setFields.dive_set_menu === true);
check("Printed menu: on with a card, off without one, untouched on other packages", dive.diveNoPrintedMenu(three) === false && dive.diveNoPrintedMenu(setMenuEvent()) === true && dive.diveNoPrintedMenu({ package: "Full Bar" }) === null && dive.diveNoPrintedMenu({ package: "Dive Bar", dive_menu_requested: true }) === false);

// ----- 8. Real saves: submit, update mode, Menu pickup -----
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const DAY = longDate(addDays(time.chicagoToday(), 40));
const SOON = longDate(addDays(time.chicagoToday(), 3));
function sessionRow(id: string, status: string, ed: Record<string, unknown>, day = DAY) {
  return {
    id, name: "Jamie Cole", email: "jamie@example.com", event_date: day, package_type: String(ed.package ?? "Dive Bar"), guest_count: "100",
    event_name: null, event_type: "Birthday", hours_booked: "4", status, version: status === "submitted" ? 1 : 0,
    submitted_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", booked_price: null, package_extras: {},
    event_data: status === "submitted" ? { client_name: "Jamie Cole", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", hours_booked: 4, guest_count: 100, ...ed } : null,
  };
}
for (const k of Object.keys(db)) delete db[k];
db.sessions = [
  sessionRow("new-card", "active", {}),
  sessionRow("new-plain", "active", {}),
  sessionRow("upd", "submitted", setMenuEvent()),
  sessionRow("soon", "submitted", setMenuEvent({ event_date: SOON }), SOON),
  sessionRow("leave", "submitted", setMenuEvent()),
];
db.event_updates = [];
db.event_menu_pickups = [];
db.event_menu_pickup_log = [];
db.client_list_holds = [];
db.business_settings = [];
const pickup = (id: string) => (db.event_menu_pickups as { session_id: string; not_needed: boolean }[]).find((r) => r.session_id === id);
const ed = (id: string) => (db.sessions.find((s) => s.id === id) as { event_data: Record<string, unknown> }).event_data;

await updates.recordSubmission("new-plain", setMenuEvent({ client_name: "Jamie Cole", event_date: DAY }));
check("Submit with no card: No printed menu for this event is on", pickup("new-plain")?.not_needed === true && (db.event_menu_pickup_log as { action: string; session_id: string }[]).some((l) => l.session_id === "new-plain" && l.action === "not_needed"));
await updates.recordSubmission("new-card", setMenuEvent({ client_name: "Jamie Cole", event_date: DAY, dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75") }));
check("Submit with a card: Menu pickup applies (No printed menu off)", !pickup("new-card")?.not_needed && names(ed("new-card").signature_drinks).join() === "Paloma,Manhattan,French 75");

// Update mode, weeks out: the set menu event asks for a card.
db.event_menu_pickups.push({ session_id: "upd", not_needed: true });
db.event_menu_pickups.push({ session_id: "leave", not_needed: true });
const quote = await updates.quoteEventUpdate("upd", { dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75") });
check("Update mode: a three classic card has no price to quote", !!quote && quote.price === null && !quote.diveMenuSet);
const r1 = await updates.applyEventUpdate("upd", { dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75") }, { requireQuote: true });
check("Update mode: three classics save right away with no charge", !!r1 && r1.rows.length === 1 && r1.rows[0].applied && r1.priceChange === null && names(ed("upd").signature_drinks).join() === "Paloma,Manhattan,French 75" && ed("upd").dive_menu_card === true && ed("upd").dive_set_menu === false);
check("Update mode: Menu pickup turns on", pickup("upd")?.not_needed === false);
const r2 = await updates.applyEventUpdate("upd", { signature_drinks: pick("Paloma", "Manhattan", "French 75", "Gimlet") }, { requireQuote: true });
check("Update mode: a fourth goes to a manager and the card keeps three", !!r2 && r2.rows.length === 1 && !r2.rows[0].applied && diff.approvalReason(r2.rows[0]) === "extra drinks" && names(ed("upd").signature_drinks).length === 3);
const r3 = await updates.applyEventUpdate("upd", { signature_drinks: pick("Paloma", "Manhattan", "Espresso Martini") }, { requireQuote: true });
check("Update mode: an excluded drink is refused", !!r3 && r3.diveCardRefused.join() === "Espresso Martini");
const r4 = await updates.applyEventUpdate("upd", { dive_menu_card: false }, { requireQuote: true });
check("Update mode: no card after all brings the set menu and No printed menu back", !!r4 && names(ed("upd").signature_drinks).join() === FIVE.join() && ed("upd").dive_set_menu === true && ed("upd").dive_menu_card === false && pickup("upd")?.not_needed === true);
const r5 = await updates.applyEventUpdate("upd", { signature_drinks: pick("Paloma") }, { requireQuote: true });
check("Update mode: a drink change with no card is still refused (set menu)", !!r5 && r5.diveMenuSet && r5.rows.length === 0);

// Inside six days: the existing drink change deadline applies.
const r6 = await updates.applyEventUpdate("soon", { dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75") }, { requireQuote: true });
check("Inside six days: a card is a request for approval, not saved", !!r6 && !!r6.held && r6.rows.length === 0 && ed("soon").dive_menu_card !== true && names(ed("soon").signature_drinks).join() === FIVE.join());
const nearPlan = diff.planUpdate(setMenuEvent(), { dive_menu_card: true, signature_drinks: pick("Paloma", "Manhattan", "French 75") }, { deadlines: near });
check("Inside six days: the card changes wait as cutoff changes", nearPlan.cutoffChanges.some((c) => c.field === "dive_menu_card") && !nearPlan.applied);

// Leaving Dive Bar for Full Bar turns the printed menu back on.
await updates.applyEventUpdate("leave", { package: "Full Bar" }, {});
check("Leaving Dive Bar for Full Bar: No printed menu turns off", ed("leave").package === "Full Bar" && pickup("leave")?.not_needed === false, `${ed("leave").package} ${JSON.stringify(pickup("leave"))}`);

// ----- 9. Wording -----
check("Staff package guide line, exactly", info.packageGuide("Dive Bar")?.setup.menu === "Menu card on request only: three classics the client picks, each additional $50." && dive.DIVE_CARD_GUIDE_LINE === info.packageGuide("Dive Bar")?.setup.menu);
const short = JSON.stringify(info.packageShortFor("Dive Bar")) + pp.packageSentence("Dive Bar") + (pp.packageShortSection().split("\n").find((l) => l.startsWith("Dive Bar:")) ?? "MISSING");
check("Not in the short client facing package wording", !/menu card|\$50/i.test(short));
const shown = [dive.DIVE_CARD_OFFER_LINE, dive.DIVE_CARD_EXTRA_LINE, dive.DIVE_CARD_FULL_LINE, dive.DIVE_CARD_FULL_BAR_LINE, dive.DIVE_CARD_GUIDE_LINE, dive.DIVE_CARD_DESCRIPTION, sourcing, upNoCard.split("\n").find((l) => l.startsWith("DIVE BAR SET MENU")) ?? "", buildUpdatePrompt(three as never, 2, far).split("\n").find((l) => l.startsWith("DIVE BAR MENU CARD")) ?? "", "Your menu card classics", "Dive Bar menu card", "These classics are on the printed menu card.", "Dive Bar with no menu card", "Dive Bar menu card", "No longer Dive Bar"];
check("No hyphens in any new wording", shown.every((t) => t && !/[-‐-―]/.test(t)), shown.filter((t) => /[-‐-―]/.test(t)).join(" | "));
check("The card update prompt names the card's classics", buildUpdatePrompt(three as never, 2, far).includes("has a printed menu card with 3 classics"));
check("The CLASSICS section still has every card classic", allowed.every((n) => new RegExp(`^${n}: `, "m").test(DRINK_MENU_RULES)));

done("Dive Bar menu card");
