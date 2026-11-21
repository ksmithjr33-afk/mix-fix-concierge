// The staff package guide: what each package includes, what the client
// provides, how service runs, what to say when a guest asks for something the
// package does not include, and the setup differences. One source for the
// Package card (manager and bartender Details) and the Packages section of the
// Training page. Pure, no database. No prices here: the bartender view never
// shows any, except the Dive Bar menu card line the owner asked for.
//
// The wording comes from the owner's package text (2026-11). The client facing
// concierge (lib/system-prompt.ts) was brought in line on the points that
// differed: Essentials is legacy, ice and coolers are for the bar (except on
// Beer and Wine), the menu tasting is included in Full, The Big Day Bar offers
// two specialty cocktails or two mocktails with classics on request, and the
// champagne tower is included on request with the client's champagne.

export interface PackageSetup {
  bar: string; // which bar
  menu: string; // menu card or not
  barback: string; // barback or not
}

export interface PackageGuide {
  key: string; // "full", used in Training links: /team/training#package-full
  name: string; // "Full Bar"
  legacy: boolean;
  summary: string; // one line
  weBring: string[];
  clientProvides: string[];
  notIncluded: string[];
  service: string[]; // how service runs
  guestAsks: { ask: string; say: string }[]; // what to say when a guest asks for something not included
  setup: PackageSetup;
  note?: string; // "Weddings only"
  short: PackageShort; // the event pages (admin, staff, planner): one line, at most five bullets
}

/** The short package section on the event pages. The full guide stays on the Training page. */
export interface PackageShort {
  line: string;
  bullets: string[]; // at most five
  provides: string; // what the client provides, one short line ("" when nothing)
}

export const MAX_PACKAGE_BULLETS = 5;

/** The Full Bar barback line: on by default at weddings, and the client can remove it. */
export const BARBACK_AT_WEDDINGS = "A barback at weddings (optional, you can remove it).";
export const CUPS_WITH_BOOKING = "Custom cups (included with your booking).";
export const BARBACK_REMOVED_LINE = "No barback (removed from this booking).";

/** What one booking adds to or takes from the package's short wording. */
export interface BookingShort {
  wedding?: boolean; // the event is a wedding (the Full Bar barback line only shows at weddings)
  barback?: "on" | "removed" | "none"; // Full Bar weddings; none: a barback was never part of this booking, so no line at all
  cups?: boolean; // custom cups promised on an older Full Bar booking
}

/**
 * The short package wording for one booking: the package's line, bullets and
 * client provides line, with this booking's barback and cups. With no booking
 * (a package described in general) it is the package's own wording. Every
 * page and both concierge prompts describe a package with this, so a package
 * reads the same everywhere. Never more than five bullets.
 */
export function packageShortFor(name: unknown, booking?: BookingShort, voice: PackageVoice = "team"): PackageShort | null {
  const s = packageShortTeam(name, booking);
  return s && voice === "client" ? clientVoiceShort(s) : s;
}

/**
 * Who reads the wording. "team" (admin, staff, planner pages, the concierge
 * prompts): "The client provides the alcohol." "client" (the client's own
 * event page): "You provide the alcohol."
 */
export type PackageVoice = "team" | "client";

/** One line of the package wording, spoken to the client. */
export function toClientVoice(line: string): string {
  return line
    .replace(/\bThe client provides\b/g, "You provide")
    .replace(/\bthe client provides\b/g, "you provide")
    .replace(/\bThe client's\b/g, "Your")
    .replace(/\bthe client's\b/g, "your")
    .replace(/\bThe client\b/g, "You")
    .replace(/\bthe client\b/g, "you")
    .replace(/\bfor the couple\b/g, "for the two of you")
    .replace(/\bif they want\b/g, "if you want")
    .replace(/\btheir own\b/g, "your own")
    .replace(/\bThey\b/g, "You")
    .replace(/\bthey\b/g, "you")
    .replace(/\btheir\b/g, "your")
    .replace(/\bTheir\b/g, "Your");
}

function clientVoiceShort(s: PackageShort): PackageShort {
  return { line: toClientVoice(s.line), bullets: s.bullets.map(toClientVoice), provides: toClientVoice(s.provides) };
}

function packageShortTeam(name: unknown, booking?: BookingShort): PackageShort | null {
  const g = packageGuide(name);
  if (!g) return null;
  if (!booking) return { ...g.short, bullets: g.short.bullets.slice(0, MAX_PACKAGE_BULLETS) };
  let bullets = [...g.short.bullets];
  if (g.key === "full") {
    bullets = bullets.filter((b) => b !== BARBACK_AT_WEDDINGS);
    if (booking.wedding && booking.barback !== "none") bullets.push(booking.barback === "removed" ? BARBACK_REMOVED_LINE : BARBACK_AT_WEDDINGS);
    if (booking.cups) bullets.push(CUPS_WITH_BOOKING);
  }
  return { ...g.short, bullets: bullets.slice(0, MAX_PACKAGE_BULLETS) };
}

export const LEGACY_LABEL = "Legacy package";
export const LEGACY_NOTE = "Confirm details with a manager";
export const NO_GUIDE = "No package guide yet";
export const ALL_PACKAGES_TITLE = "Every package";

/** True on every package. */
export const ALL_PACKAGES: string[] = [
  "Champagne tower on request. The client provides the champagne.",
  "No frozen or blended drinks. Pina coladas and daiquiris are served on the rocks.",
  "Our ice and coolers are for the bar. The client chills their own beer and wine, except on Beer and Wine.",
];

const DIVE_SET = ["Margarita", "Old Fashioned", "Cosmopolitan", "Lemon Drop", "Moscow Mule"];

export const PACKAGE_GUIDES: PackageGuide[] = [
  {
    key: "beer-wine",
    name: "Beer and Wine",
    legacy: false,
    summary: "Beer and wine only. No cocktails, no mixers.",
    weBring: ["The bartender", "Ice", "One cooler per bartender", "A bar table if needed"],
    clientProvides: ["The beer", "The wine", "Cups", "Napkins"],
    notIncluded: ["Cocktails", "Mixers"],
    service: [
      "Pour and serve the beer and wine the client provides. Nothing else is served.",
      "Our ice and cooler keep the beer and wine cold on this package.",
    ],
    guestAsks: [
      { ask: "A cocktail or a mixed drink", say: "Tonight is a beer and wine bar, so no cocktails. Can I get you a beer or a glass of wine?" },
      { ask: "A soda or a mixer", say: "We are serving beer and wine only tonight. The host may have other drinks out for guests." },
    ],
    setup: { bar: "A bar table if needed", menu: "No menu card", barback: "No barback" },
    short: {
      line: "Beer and wine service only.",
      bullets: ["We bring the bartender, ice, and one cooler per bartender, plus a bar table if needed."],
      provides: "The client provides the beer, wine, and cups.",
    },
  },
  {
    key: "dive",
    name: "Dive Bar",
    legacy: false,
    summary: `A set menu of ${DIVE_SET.join(", ")}, plus just about any typical classic a guest asks for.`,
    weBring: [
      "The bar and tools",
      "Baseline mixers, sodas and juices",
      "Lemon, lime and orange garnish",
      "Bottled water",
      "Cups, napkins and straws",
      "Ice",
      "One cooler per bartender",
      "A printed menu card, only if the client asks",
    ],
    clientProvides: ["The alcohol", "Beer and wine, if they want them served"],
    notIncluded: ["Specialty cocktails", "Mocktails", "A menu tasting", "Espresso martinis (never a Dive classic)"],
    service: [
      `The set menu is ${DIVE_SET.join(", ")}.`,
      "Make just about any typical classic a guest asks for, with what is on the bar.",
      "Serve beer and wine if the client provides them.",
    ],
    guestAsks: [
      { ask: "An espresso martini", say: "Espresso martinis are not on the Dive Bar menu. I can make you a classic instead. How about an Old Fashioned or a Cosmo?" },
      { ask: "A specialty or signature cocktail", say: "Tonight is our Dive Bar menu: the classics, done right. What are you in the mood for?" },
      { ask: "A mocktail", say: "We do not have mocktails on tonight's menu. I can get you a soda, a juice or a bottled water." },
    ],
    // The one price in the guide, by the owner's wording (2026-11-20). Kept off the short client wording.
    setup: { bar: "Our bar", menu: "Menu card on request only: three classics the client picks, each additional $50.", barback: "No barback" },
    short: {
      line: "The dive bar experience.",
      bullets: [
        "A set menu of five classics (margarita, old fashioned, cosmo, lemon drop, Moscow mule).",
        "Plus just about any classic a guest asks for.",
        "We bring the bartender, bar tables, tools, mixers, garnishes, cups, napkins, straws, ice, and coolers.",
      ],
      provides: "The client provides the alcohol, and beer and wine if they want them served.",
    },
  },
  {
    key: "full",
    name: "Full Bar",
    legacy: false,
    summary: "Three specialty cocktails designed for the event, classics on request, and mocktails.",
    weBring: [
      "Bar tables",
      "A printed menu card",
      "A full stock of mixers, garnishes, syrups, purees and juices",
      "Sodas and water for kids and guests who do not drink",
      "A barback at weddings (optional, you can remove it)",
    ],
    clientProvides: ["The alcohol"],
    notIncluded: [],
    service: [
      "Lead with the three specialty cocktails on the menu card.",
      "Make classics on request.",
      "Offer mocktails, sodas and water to kids and guests who do not drink.",
      "A menu tasting is included for the client before the event.",
    ],
    guestAsks: [
      { ask: "A drink that is not on the menu", say: "Happy to make a classic. What do you like? If it is something we do not have the ingredients for tonight, I will suggest the closest thing." },
    ],
    setup: { bar: "Bar tables", menu: "Printed menu card", barback: "Barback at weddings (optional, the client can remove it)" },
    short: {
      line: "Three specialty cocktails designed for the event, just about any classic, and mocktails, sodas, and water for kids and guests who do not drink.",
      bullets: ["We bring the full stock, bar tables, and a printed menu card.", BARBACK_AT_WEDDINGS],
      provides: "The client provides the alcohol.",
    },
  },
  {
    key: "premium",
    name: "Premium Bar",
    legacy: false,
    summary: "Everything in Full, plus the handcrafted wooden bar, themed decor, cocktail tables and a dedicated barback.",
    weBring: [
      "Everything in Full",
      "The handcrafted wooden bar",
      "Decor styled to the theme",
      "Cocktail tables with printed menus",
      "Custom cups and napkins at any size",
      "A dedicated barback",
    ],
    clientProvides: ["The alcohol"],
    notIncluded: [],
    service: [
      "Service runs like Full: specialty cocktails first, classics on request, mocktails for anyone who wants one.",
      "A private tasting is included for the client before the event.",
      "This is the showpiece. Keep the bar, the decor and the cocktail tables looking styled all night.",
    ],
    guestAsks: [
      { ask: "A drink that is not on the menu", say: "Happy to make a classic. What do you like? If it is something we do not have the ingredients for tonight, I will suggest the closest thing." },
    ],
    setup: { bar: "The handcrafted wooden bar", menu: "Printed menus on the cocktail tables", barback: "Dedicated barback" },
    short: {
      line: "Everything in Full Bar, plus:",
      bullets: ["The wooden bar", "Decor styled to the theme", "Custom cups and napkins", "Cocktail tables", "A dedicated barback"],
      provides: "The client provides the alcohol.",
    },
  },
  {
    key: "big-day",
    name: "The Big Day Bar",
    legacy: false,
    note: "Weddings only",
    summary: "Two specialty cocktails or two mocktails, classics on request, and beer and wine service.",
    weBring: ["Bottled water for every guest", "A barback through cocktail hour"],
    clientProvides: ["The alcohol", "The beer and wine"],
    notIncluded: [],
    service: [
      "Lead with the couple's two specialty cocktails or mocktails.",
      "Make classics on request.",
      "Serve the beer and wine.",
      "Bottled water for every guest.",
      "The barback works through cocktail hour.",
    ],
    guestAsks: [
      { ask: "A drink that is not on the menu", say: "The couple picked these two for tonight, and I can make you a classic too. What do you like?" },
    ],
    setup: { bar: "Our bar", menu: "Confirm with a manager", barback: "Barback through cocktail hour" },
    short: {
      line: "Weddings only.",
      bullets: ["Two specialty cocktails for the couple", "The classics", "Bottled water", "A dedicated barback through cocktail hour"],
      provides: "The client provides the alcohol, beer, and wine.",
    },
  },
  {
    key: "essentials",
    name: "Essentials Bar",
    legacy: true,
    summary: "Specialty menu only, no classics, two draped tables.",
    weBring: ["The specialty menu", "Two draped tables"],
    clientProvides: ["The alcohol"],
    notIncluded: ["Classics"],
    service: ["Serve the specialty menu only. No classics."],
    guestAsks: [{ ask: "A classic", say: "Tonight's bar is the specialty menu the host picked. Can I make you one of these?" }],
    setup: { bar: "Two draped tables", menu: "Specialty menu", barback: "Confirm with a manager" },
    short: { line: "Specialty menu only, no classics, two draped tables.", bullets: [], provides: "The client provides the alcohol." },
  },
  {
    key: "tailored",
    name: "Tailored Bar",
    legacy: true,
    summary: "Bartender, bar setup, tools, specialty menu and shopping list. No ice from us.",
    weBring: ["The bartender", "Bar setup", "Tools", "The specialty menu", "The shopping list"],
    clientProvides: ["Everything on the shopping list", "Ice"],
    notIncluded: ["Ice"],
    service: ["Serve the specialty menu with what the client bought from the shopping list."],
    guestAsks: [{ ask: "Something the client did not buy", say: "We are working with what the host stocked tonight. Here is what I can make." }],
    setup: { bar: "Bar setup", menu: "Specialty menu", barback: "Confirm with a manager" },
    short: { line: "Bartender, bar setup, tools, specialty menu and shopping list. No ice from us.", bullets: [], provides: "The client provides everything on the shopping list, and the ice." },
  },
  {
    key: "bartender-only",
    name: "Bartender Only",
    legacy: true,
    summary: "Bartender only. The client supplies alcohol, mixers, cups, ice and the bar surface.",
    weBring: ["The bartender"],
    clientProvides: ["Alcohol", "Mixers", "Cups", "Ice", "The bar surface"],
    notIncluded: ["Ice", "Mixers", "Cups", "A bar"],
    service: ["Make drinks with what the client supplies."],
    guestAsks: [{ ask: "Something the client did not supply", say: "We are working with what the host stocked tonight. Here is what I can make." }],
    setup: { bar: "The client's bar surface", menu: "Confirm with a manager", barback: "No barback" },
    short: { line: "Just the bartender.", bullets: [], provides: "The client provides everything else." },
  },
];

/** The guide for a booking's package name, or null when none matches. */
export function packageGuide(name: unknown): PackageGuide | null {
  const p = String(name ?? "").toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim();
  if (!p) return null;
  const key =
    /beer and wine|beer\/wine/.test(p) ? "beer-wine"
    : /\bdive\b/.test(p) ? "dive"
    : /premium/.test(p) ? "premium"
    : /big day|wedding bar/.test(p) ? "big-day"
    : /essentials/.test(p) ? "essentials"
    : /tailored/.test(p) ? "tailored"
    : /bartender only/.test(p) ? "bartender-only"
    : /\bfull\b/.test(p) ? "full"
    : null;
  return key ? (PACKAGE_GUIDES.find((g) => g.key === key) ?? null) : null;
}

export const guideByKey = (key: string): PackageGuide | null => PACKAGE_GUIDES.find((g) => g.key === key) ?? null;
export const currentGuides = () => PACKAGE_GUIDES.filter((g) => !g.legacy);
export const legacyGuides = () => PACKAGE_GUIDES.filter((g) => g.legacy);

/** The Training page entry for a package: /team/training#package-full */
export const trainingHref = (key: string) => `/team/training#package-${key}`;
export const trainingAnchor = (key: string) => `package-${key}`;
