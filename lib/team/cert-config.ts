// Certifications and onboarding: the config. Edit the text here; the pages read it.
// Pure and client safe: no database, no server imports.

import type { Market } from "@/lib/team/markets";

/** The certification each market requires. */
export const CERT_BY_MARKET: Record<Market, string> = {
  dallas: "TABC",
  austin: "TABC",
  houston: "TABC",
  los_angeles: "California RBS",
};

/** Every bartender keeps a food handler certificate on file too. It never gates shifts. */
export const FOOD_HANDLER = "Food Handler";

export const CERT_TYPES = [...new Set([...Object.values(CERT_BY_MARKET), FOOD_HANDLER])];

/** The certificates a profile shows: the alcohol certificate each market needs, and Food Handler. */
export function profileCertTypes(markets: Market[]): string[] {
  return [...new Set([...markets.map((m) => CERT_BY_MARKET[m]).filter(Boolean), FOOD_HANDLER])];
}

/** Text reminders this many days before expiry (0 is the day it expires). */
export const CERT_REMINDER_DAYS = [30, 7, 0];

export const CERT_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
export const CERT_MAX_BYTES = 10 * 1024 * 1024;

export interface OnboardingItem {
  id: string;
  title: string;
  /** Paragraphs shown on the item's page. */
  body: string[];
  /** The acknowledge button. */
  ack: string;
  /** Optional link shown on the page, such as the certification upload. */
  link?: { href: string; label: string };
}

export const ONBOARDING_TITLE = "Getting started";
export const ONBOARDING_INTRO = "Five short steps. Open each one, read it, and tap the button at the bottom. Nothing here blocks you from working.";

export const ONBOARDING: OnboardingItem[] = [
  {
    id: "name_phone",
    title: "Confirm your name and phone",
    body: [
      "Your first name is what teammates and admins see on events, chats, and shift requests. Your phone number is where every text from The Mix Fix goes: new shifts, assignments, reminders, and sign in codes.",
      "If either one is wrong, text us at 469 754 8512 and we will fix it.",
    ],
    ack: "My name and phone are right",
  },
  {
    id: "certification",
    title: "Upload your certification",
    body: [
      "Every bartender needs a current alcohol server certification for the market they work in: TABC in Dallas, Austin, and Houston, and California RBS in Los Angeles.",
      "Upload a photo or PDF of your certificate with its expiry date. An admin checks it. We text you 30 days and 7 days before it expires, and on the day it expires.",
      "When certifications are enforced, you cannot request shifts in a market without a current certification for it.",
    ],
    ack: "I understand",
    link: { href: "/team/certifications", label: "Upload your certification" },
  },
  {
    id: "who_brings_what",
    title: 'Read "Who brings what"',
    body: [
      "The Mix Fix brings the bar station: tables, tablecloths, coolers, signage, and prep supplies. Those items are on the event checklist under From The Mix Fix. Return them after the event, and report anything broken or missing on the wrap up.",
      "You bring your own tools to every event: shaker tins, jiggers, strainers, a stirring spoon, a muddler, an ice scoop, a wine key, a bar knife, and two bar towels.",
      "The client buys the alcohol, mixers, and ice on the supplies list on the event page unless the package says otherwise. Check off the checklist before you leave, and the supplies list when you get to the event.",
    ],
    ack: "I have read it",
  },
  {
    id: "clock_bar_ready",
    title: "Read the clock in and bar ready rules",
    body: [
      "Clock in from the event page when you arrive. Clock in opens 30 minutes before arrival time. On time means clocked in at or before arrival. Your phone's location is saved with each punch, and a punch far from the event is flagged.",
      "When the bar is set, send the Bar is ready photo from the event page before service starts. Admins hear if it has not come in 30 minutes before service.",
      "Clock out after breakdown, then do the wrap up on the Wrap up tab: how it went, what is left, the equipment, and a photo of the bar broken down and the area cleaned.",
    ],
    ack: "I have read it",
  },
  {
    id: "shifts_handoffs",
    title: "Read the shift request and handoff rules",
    body: [
      "Open shifts in your market show on the Open shifts tab and come by text. Requesting a shift does not give it to you: an admin picks, and you get a text either way.",
      "If you cannot work a shift you accepted, use Give up this shift on the event page. Offer it to a teammate or open it to the market. You stay on the shift until an admin approves the change.",
      "A handoff inside 48 hours of the event is marked urgent. Late drops and urgent handoffs show on your record, so ask early.",
    ],
    ack: "I have read it",
  },
];

export const onboardingItem = (id: string) => ONBOARDING.find((i) => i.id === id) ?? null;
