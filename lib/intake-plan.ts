// The intake concierge's plan, worked out in code. Pure, no database.
//
// - nextPlanStep: the next unanswered planning item, from what the booking and
//   the session already have and what the transcript covers (a question asked
//   and answered). The chat route asks it when a reply would end without a
//   question (a dead end the client has to answer with "Yes" or "What's next").
// - Event types with a guest of honor: only these get the opening role question.
// - The opening summary: everything the booking already told us, confirmed once.
// - The final save: the client is only told the plan was submitted when the save
//   really succeeded, in our words (never the model's). Claims the model makes
//   on its own are dropped. Skipped drink details still submit, marked
//   "Drinks not finalized", and an extra drink nobody said yes to is held back.

import { isBlank, present } from "@/lib/blank";
import { packageDrinkCount } from "@/lib/event-diff";
import { CLOSING_PATTERN } from "@/lib/unsaved-sessions";
import { UNCONFIRMED_DRINKS, hasRecipe, notConfirmedNote, notFinalizedNote, withTeamNotes } from "@/lib/team-notes";
import { boClassicsNote, guardClassicsOnly } from "@/lib/bartender-only-drinks";
import { BO_BEER_WINE_LINE } from "@/lib/bartender-only";
import { guardMocktails, isMocktailFollowup, mocktailNotes, mocktailsAllowed } from "@/lib/mocktail-menu";

export { CLOSING_PATTERN };

type Msg = { role: string; content: unknown };
const textOf = (m: Msg | undefined) => (typeof m?.content === "string" ? m.content : "");

// ---------- Event types ----------

/**
 * The event types that have a guest of honor, so the opening role question
 * ("Are you the guest of honor, hosting this for someone else, or a planner?")
 * makes sense. Matched loosely, ignoring case, spaces, and punctuation.
 */
export const HONOREE_EVENT_TYPES: readonly { type: string; alsoCalled: readonly string[] }[] = [
  { type: "birthday", alsoCalled: ["bday", "quinceanera", "sweet 16", "sweet sixteen"] },
  { type: "wedding", alsoCalled: ["reception", "rehearsal dinner", "engagement", "elopement", "vow renewal"] },
  { type: "shower", alsoCalled: ["baby shower", "bridal shower", "wedding shower", "gender reveal"] },
  { type: "anniversary", alsoCalled: [] },
  { type: "graduation", alsoCalled: ["grad party"] },
  { type: "retirement", alsoCalled: [] },
];

/** Types the booking uses that say nothing about the occasion. */
const GENERIC_TYPES = ["social gathering", "gathering", "celebration", "party", "private party", "get together", "event", "private event", "other"];

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/** ask: an event with a guest of honor; skip: any other occasion; unknown: no type yet, or only a generic one like Social Gathering. */
export function honoreeFit(eventType: unknown): "ask" | "skip" | "unknown" {
  const t = present(eventType);
  if (!t) return "unknown";
  const s = squash(t);
  if (HONOREE_EVENT_TYPES.some((e) => [e.type, ...e.alsoCalled].some((w) => s.includes(squash(w))))) return "ask";
  if (GENERIC_TYPES.some((g) => squash(g) === s)) return "unknown";
  return "skip";
}

/** True when the booked type names the occasion (not Social Gathering, Party, Other, or missing). */
export const specificEventType = (eventType: unknown): boolean => {
  const t = present(eventType);
  return !!t && !GENERIC_TYPES.some((g) => squash(g) === squash(t));
};

// ---------- What the booking already told us ----------

export interface KnownBooking {
  name?: unknown;
  eventDate?: unknown;
  packageType?: unknown;
  guests?: number | null;
  hours?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  bartenders?: number | null;
  eventType?: unknown;
  city?: unknown;
  state?: unknown;
}

/** "Premium Bar for 60 guests, 5 hours of bar service", every known detail as plain words. Missing ones are left out, never "null". */
export function knownDetails(k: KnownBooking): string[] {
  const out: string[] = [];
  const pkg = present(k.packageType);
  if (pkg) out.push(k.guests ? `the ${pkg} for ${k.guests} guests` : `the ${pkg}`);
  else if (k.guests) out.push(`${k.guests} guests`);
  if (k.hours) out.push(`${k.hours} hour${k.hours === 1 ? "" : "s"} of bar service${k.startTime ? ` starting at ${k.startTime}${k.endTime ? ` (until ${k.endTime})` : ""}` : ""}`);
  else if (k.startTime) out.push(`bar service starting at ${k.startTime}`);
  if (k.bartenders) out.push(`${k.bartenders} bartender${k.bartenders === 1 ? "" : "s"}`);
  const date = present(k.eventDate);
  if (date) out.push(`on ${date}`);
  if (specificEventType(k.eventType)) out.push(`a ${present(k.eventType)}`);
  const city = present(k.city);
  if (city) out.push(`in ${city}${present(k.state) ? `, ${present(k.state)}` : ""}`);
  return out;
}

export const OPENING_CHECK = "Is all of that still right?";

/** The OPENING SUMMARY prompt section: confirm what we know in one short summary, then ask only what is missing. */
export function openingSummarySection(k: KnownBooking): string {
  const known = knownDetails(k);
  const name = present(k.name);
  const missing = [
    !name ? "their name" : "",
    !present(k.eventDate) ? "the event date" : "",
    !specificEventType(k.eventType) ? "what they are celebrating" : "",
  ].filter(Boolean);
  if (known.length === 0) return "";
  return [
    "OPENING SUMMARY:",
    `What the booking already told us: ${known.join(", ")}${name ? `, booked by ${name}` : ""}.`,
    `In your FIRST reply, after the greeting, confirm all of it in ONE short sentence (for example "I have you down for ${known.join(", ")}."), then ask exactly: "${OPENING_CHECK}" Ask nothing else in that reply.`,
    "If they say yes, never ask for any of those details again. If they correct something, use their answer.",
    missing.length
      ? `Then ask only for what is missing, one question at a time, starting with: ${missing.join(", then ")}.`
      : "Nothing basic is missing, so go straight on to the next planning question after they confirm.",
    "Never write the word null, undefined, or a blank for a detail: a detail we do not have is simply missing, so ask for it.",
  ].join("\n");
}

// ---------- The next unanswered item ----------

export interface PlanContext {
  packageType: unknown;
  booking: KnownBooking;
  planningRole?: string | null; // saved on the session
  plannerAsked?: boolean; // saved on the session, or a planner holds the booking
  noPayment?: boolean; // a planner who cannot see money
  classicsOnly?: boolean; // the new Bartender Only (service fee model): classics only, and beer and wine only skips the drinks
}

export interface PlanStep {
  id: string;
  label: string; // what it is, for the regenerate instruction
  question: string; // the question asked when the model does not ask one
}

interface StepRule extends PlanStep {
  asked: RegExp; // an assistant message that asks it
  skip?: (c: PlanContext, eventType: string | null, messages: Msg[]) => boolean;
  known?: (c: PlanContext) => boolean;
}

const pkgKind = (p: unknown) => {
  const s = String(p ?? "").toLowerCase();
  if (s.includes("dive")) return "dive";
  if (s.includes("beer") && s.includes("wine") && !s.includes("full") && !s.includes("premium") && !s.includes("essentials")) return "beer_wine";
  if (s.includes("premium")) return "premium";
  return "full";
};
const noDrinks = (c: PlanContext) => ["dive", "beer_wine"].includes(pkgKind(c.packageType));
/** The new Bartender Only, and the concierge confirmed the client is serving only beer and wine. */
const beerWineOnly = (c: PlanContext, m: Msg[]) => !!c.classicsOnly && m.some((x) => x.role === "assistant" && textOf(x).includes(BO_BEER_WINE_LINE));
/** The first drink question on the new Bartender Only: classics only, no mocktail. */
export const CLASSICS_FIRST_DRINK = "For your first signature drink, which spirit are you thinking? Our classics cover whiskey, vodka, tequila, gin, rum, and more.";

const STEPS: StepRule[] = [
  // Only the opening: once the chat has moved past the first reply, it is never asked late.
  { id: "confirm_booking", label: "confirming the booking details", question: OPENING_CHECK, asked: /is all of that (still )?right/i, skip: (c, _t, m) => knownDetails(c.booking).length === 0 || m.filter((x) => x.role === "assistant").length > 1 },
  { id: "name", label: "their name", question: "What is your full name?", asked: /\b(your|the) (full )?name\b/i, known: (c) => !!present(c.booking.name) },
  { id: "event_date", label: "the event date", question: "What date is your event?", asked: /\bwhat date\b|\bevent date\b|\bdate (is|are) you planning\b/i, known: (c) => !!present(c.booking.eventDate) },
  { id: "event_type", label: "what they are celebrating", question: "What are you celebrating?", asked: /celebrating|what kind of (event|party)|what type of event|the occasion/i, known: (c) => specificEventType(c.booking.eventType) },
  {
    id: "role",
    label: "who is planning",
    question: "Are you the guest of honor, hosting this for someone else, or a planner booking for a client?",
    asked: /guest of honor/i,
    known: (c) => !!c.planningRole,
    skip: (_c, type) => honoreeFit(type) !== "ask",
  },
  { id: "start_time", label: "the bar service start time", question: "What time would you like bar service to start?", asked: /what time .*(start|begin)|bar (service )?(to )?start/i, known: (c) => !!c.booking.startTime },
  { id: "venue_type", label: "venue or private residence", question: "Will your event be at a venue or a private residence?", asked: /venue or (a )?private residence/i },
  { id: "address", label: "the event address", question: "What is the full address for the event, including street, city, state, and zip code?", asked: /\baddress\b/i },
  { id: "bar_location", label: "where the bar goes", question: "Where should the bar be set up, indoors or outdoors?", asked: /indoors?|outdoors?|where (should|will) the bar/i },
  { id: "floor", label: "the floor the bar is on", question: "Will the bar be on the ground floor, or will it need to go upstairs?", asked: /ground floor|upstairs|downstairs/i },
  { id: "bar_on_site", label: "whether there is a bar on site", question: "Will there be a bar on site, or should we bring our portable bar?", asked: /bar on site|portable bar/i, skip: (c) => pkgKind(c.packageType) === "premium" },
  { id: "parking", label: "parking", question: "What is the parking situation for our team?", asked: /\bpark/i },
  { id: "guests", label: "the guest count", question: "How many guests are you expecting?", asked: /\bguests\b.*\?|how many guests/i },
  { id: "pace", label: "the drinking pace", question: "What drinking pace are you expecting for your crowd: Light, Moderate, Heavy, or Mixed?", asked: /drinking pace/i, skip: noDrinks },
  { id: "planner", label: "whether they are working with a planner", question: "Are you working with an event planner? If so, I can give them access to help with your bar planning.", asked: /event planner/i, known: (c) => !!c.plannerAsked || c.planningRole === "planner" },
  { id: "theme", label: "the theme", question: "Do you have a theme for your event?", asked: /\btheme\b/i, skip: noDrinks },
  { id: "colors", label: "the colors", question: "What colors are you going with for your event? We will use these for your cocktail menu design.", asked: /colou?rs?\b|palette/i, skip: (c, _t, m) => noDrinks(c) || beerWineOnly(c, m) },
  { id: "allergies", label: "allergies", question: "Do you have any allergies or ingredients to avoid that we should know about?", asked: /allerg/i },
  { id: "day_of_contact", label: "the day of contact", question: "Who will be the day of contact on event day, and what is the best phone number to reach them?", asked: /day of contact/i },
  { id: "drinks", label: "the signature drinks", question: "For your first signature drink, would you like a cocktail or a mocktail?", asked: /first (signature )?(drink|cocktail)|signature (cocktail|drink) menu|which drinks/i, skip: (c, _t, m) => noDrinks(c) || beerWineOnly(c, m) },
  { id: "beer_wine", label: "beer and wine", question: "Would you like beer and wine available for your guests as well?", asked: /beer and wine/i, skip: (c) => noDrinks(c) },
  { id: "add_ons", label: "add ons", question: "We also have add ons like custom cups, a coffee station, and more. Want me to send the full list?", asked: /add ons?\b/i },
  { id: "payment", label: "the remaining balance", question: "How would you like to handle your remaining balance, which is due two weeks before your event?", asked: /remaining balance/i, skip: (c) => !!c.noPayment },
  { id: "wrap_up", label: "the wrap up", question: "Do you have any more questions, or is there anything you would like to change before we wrap up?", asked: /before we wrap up|anything you would like to change/i },
];

/** The event type the client gave: the booking's when specific, else their answer to "what are you celebrating". */
export function eventTypeSoFar(c: PlanContext, messages: Msg[]): string | null {
  if (specificEventType(c.booking.eventType)) return present(c.booking.eventType);
  const asked = STEPS.find((s) => s.id === "event_type")!.asked;
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === "assistant" && asked.test(textOf(messages[i]))) {
      const answer = messages.slice(i + 1).find((m) => m.role === "user");
      if (answer && textOf(answer).trim()) return textOf(answer).trim();
    }
  }
  return null;
}

/** The step an assistant message asked and the client then answered (any later user message counts). */
function covered(step: StepRule, messages: Msg[]): boolean {
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "assistant" || !step.asked.test(textOf(messages[i]))) continue;
    if (messages.slice(i + 1).some((m) => m.role === "user" && textOf(m).trim())) return true;
  }
  return false;
}

/**
 * The next planning item nobody has answered yet, in the order the concierge
 * goes, or null when everything is covered (time for the closing) or the
 * code cannot tell. `messages` is the whole chat so far.
 */
export function nextPlanStep(c: PlanContext, messages: Msg[]): PlanStep | null {
  const type = eventTypeSoFar(c, messages);
  for (const s of STEPS) {
    if (s.skip?.(c, type, messages)) continue;
    if (s.known?.(c)) continue;
    if (covered(s, messages)) continue;
    return { id: s.id, label: s.label, question: s.id === "drinks" && c.classicsOnly ? CLASSICS_FIRST_DRINK : s.question };
  }
  return null;
}

/** Used only when the code truly cannot tell what is next. */
export const GENERIC_NEXT = "What would you like to plan next?";

export const hasQuestion = (text: string): boolean => /\?/.test(text);

/** The instruction for the regenerate turn when a reply ended without a question. */
export function regenerateInstruction(next: PlanStep | null): string {
  const what = next ? `The next unanswered item is ${next.label}. For example: "${next.question}"` : `If you cannot tell what is next, ask: "${GENERIC_NEXT}"`;
  return `NEXT QUESTION CHECK (from our system, not the client): your reply above ended without a question, so the client has nothing to answer. Write ONLY the next planning question now, in one or two short sentences, with no recap and no greeting. ${what} If that item was already answered in this chat, ask the next one that was not.`;
}

// ---------- The closing and the final save ----------

/** An earlier assistant message already sent the closing line. */
export const closedEarlier = (messages: Msg[]): boolean => messages.some((m) => m.role === "assistant" && CLOSING_PATTERN.test(textOf(m)));

export const FORCE_SUBMIT_INSTRUCTION =
  "FINAL SAVE (from our system, not the client): the client has finished planning. Call submit_event_data now with everything collected in this chat. If they skipped the drink details, send the drink names they gave with drinks_finalized false. Send extra_drinks_accepted true only if they clearly said yes to paying for the extra drink.";

/**
 * A sentence that says the plan was submitted, sent, or saved for the team.
 * Only the system says that, from the real result (SUBMITTED_LINE and friends).
 */
const CLAIM =
  /\b(been|was|were|is|are|got|gets)\s+(all\s+)?(submitted|sent (over )?to (our|the) team|handed (off|over) to (our|the) team)\b|\b(i|we)('ve| have| just)\s+(submitted|sent (it|them|everything|your (details|plan|info))( over)? to (our|the) team)\b|\b(get|getting)\s+(that|it|this|everything|your (details|plan))\s+submitted\b|\bsubmitted to (our|the) team\b/i;

export const claimsSubmitted = (sentence: string): boolean => CLAIM.test(sentence);

/** Drops sentences that claim the plan was submitted, while streaming. */
export function createClaimFilter(push: (text: string) => void) {
  let buf = "";
  let dropped = 0;
  const emit = (sentence: string) => {
    if (claimsSubmitted(sentence)) {
      dropped++;
      return;
    }
    push(sentence);
  };
  return {
    push(text: string) {
      buf += text;
      for (;;) {
        const m = /[.!?](?:["')\]]*)(\s+)/.exec(buf);
        if (!m) break;
        const end = m.index + m[0].length;
        emit(buf.slice(0, end));
        buf = buf.slice(end);
      }
    },
    finish() {
      if (buf) emit(buf);
      buf = "";
    },
    dropped: () => dropped,
  };
}

export const SUBMITTED_LINE = "Your plan is in with our team. We cannot wait to celebrate with you!";
export const SUBMITTED_DRINKS_LINE = "Your plan is in with our team. Your drink menu is not finished yet, so we will text you to finish it.";
export const SAVE_FAILED_LINE = "Something went wrong saving your plan on our end. Our team has your answers and will follow up with you.";

export type SaveOutcome = "saved" | "already_submitted" | "failed";

/** What the client is told, from the real result of the final save. */
export function resultLine(outcome: SaveOutcome, drinksNotFinalized: boolean): string {
  if (outcome === "failed") return SAVE_FAILED_LINE;
  return drinksNotFinalized ? SUBMITTED_DRINKS_LINE : SUBMITTED_LINE;
}

// ---------- Drinks ----------

export interface DrinkCheck {
  data: Record<string, unknown>;
  notFinalized: boolean;
  unconfirmed: string[]; // extra drinks past the package count nobody said yes to
  named: string[]; // every drink name the client gave
}

const drinkName = (d: unknown) => present((d as { name?: unknown })?.name) ?? present((d as { menu_name?: unknown })?.menu_name) ?? "";

/**
 * Skipped drink details still submit: the event is marked drinks_not_finalized
 * with a "Drinks not finalized: ..." line in team_notes (never special_requests,
 * which the client sees). Drinks past the package count are kept only when
 * extra_drinks_accepted is true; otherwise they are held back whole in
 * unconfirmed_drinks, listed for the team, and asked on the client page. drinks_finalized and
 * extra_drinks_accepted are taken off the saved event.
 */
export function checkDrinks(input: Record<string, unknown>, packageType: unknown, opts: { classicsOnly?: boolean } = {}): DrinkCheck {
  const { drinks_finalized: finalizedFlag, extra_drinks_accepted: extrasFlag, beer_wine_only: beerWineOnly, ...data } = input;
  const kind = pkgKind(packageType ?? data.package);
  const cardOnly = kind === "dive" && data.dive_menu_card !== true;
  if (kind === "beer_wine" || cardOnly) return { data, notFinalized: false, unconfirmed: [], named: [] };
  const included = kind === "dive" ? 3 : packageDrinkCount(packageType ?? data.package);
  let drinks = Array.isArray(data.signature_drinks) ? (data.signature_drinks as unknown[]) : [];
  // The new Bartender Only is the classics only: a craft drink, a mocktail or a
  // custom drink is left off, with a team note, and each classic gets its CLASSICS recipe.
  if (opts.classicsOnly) {
    const g = guardClassicsOnly(drinks);
    if (g.refused.length) {
      console.warn(`[bartender-only] not classics, left off: ${g.refused.join(", ")}`);
      Object.assign(data, withTeamNotes(data, [boClassicsNote(g.refused)]));
    }
    drinks = g.drinks;
    // Serving only beer and wine: no cocktail menu on purpose, so nothing is unfinished.
    // Kept only while there are no drinks; any classic means they wanted cocktails after all.
    if (beerWineOnly === true && drinks.length === 0) return { data: { ...data, signature_drinks: [], beer_wine_only: true }, notFinalized: false, unconfirmed: [], named: [] };
  }
  // The concierge never creates a drink: a mocktail not on a loaded mocktail menu
  // becomes a follow up that holds its drink spot (no recipe, no ingredients).
  const mock = guardMocktails(drinks, { allowsMocktails: mocktailsAllowed(packageType ?? data.package) });
  if (mock.replaced.length) console.warn(`[mocktails] a mocktail with no menu was turned into a follow up: ${mock.replaced.join(", ")}`);
  drinks = mock.drinks;
  Object.assign(data, mocktailNotes(data, mock));
  const named = drinks.map(drinkName).filter(Boolean);
  let unconfirmed: string[] = [];
  let held: unknown[] = [];
  if (drinks.length > included && extrasFlag !== true) {
    // Kept whole, so the client can say yes on their page and the drink is added as it was built.
    held = drinks.slice(included).filter((d) => drinkName(d) !== "");
    unconfirmed = held.map(drinkName);
    drinks = drinks.slice(0, included);
  }
  // A mocktail follow up is our team's to finish, not the client's: it never marks the drinks not finalized.
  const notFinalized = finalizedFlag === false || drinks.length === 0 || drinks.some((d) => !hasRecipe(d) && !isMocktailFollowup(d));
  const notes: string[] = [];
  if (notFinalized) notes.push(notFinalizedNote(named));
  if (unconfirmed.length) notes.push(notConfirmedNote(unconfirmed));
  // Team notes never go in special_requests: the client page shows special_requests.
  let out: Record<string, unknown> = { ...data, signature_drinks: drinks };
  if (notes.length) out = withTeamNotes(out, notes);
  if (held.length) out[UNCONFIRMED_DRINKS] = held;
  if (notFinalized) out.drinks_not_finalized = true;
  return { data: out, notFinalized, unconfirmed, named };
}

/** The admins' text when the drinks need a follow up. */
export function drinksAlertText(o: { client: string; date: string; check: DrinkCheck; link: string }): string {
  const parts = [`Drinks not finalized for ${o.client || "a client"}${o.date ? `, ${o.date}` : ""}.`];
  if (o.check.notFinalized) parts.push(o.check.named.length ? `They named ${o.check.named.join(", ")}. Text them to finish the menu.` : "No drinks picked yet. Text them to finish the menu.");
  if (o.check.unconfirmed.length) parts.push(`Not confirmed as a paid extra: ${o.check.unconfirmed.join(", ")} ($50 each).`);
  parts.push(o.link);
  return parts.join(" ");
}

/** The admins' text when the final save failed. */
export function saveFailedAlertText(o: { client: string; sessionId: string; link: string }): string {
  return `The concierge could not save ${o.client || "a client"}'s plan (session ${o.sessionId}). They finished the chat and were told our team will follow up. It is listed under Finished but not saved. ${o.link}`;
}
