// The staff package guide: what each package includes, what the client
// provides, how service runs, what to say when a guest asks for something the
// package does not include, and the setup differences. One source for the
// Package card (manager and bartender Details) and the Packages section of the
// Training page. Pure, no database. No prices here: the bartender view never
// shows any.
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
      "A printed menu, only if the client asks",
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
    setup: { bar: "Our bar", menu: "Printed menu only if the client asked for one", barback: "No barback" },
  },
  {
    key: "full",
    name: "Full Bar",
    legacy: false,
    summary: "Three specialty cocktails designed for the event, classics on request, and mocktails.",
    weBring: [
      "The steel bar",
      "A printed menu card",
      "A full stock of mixers, garnishes, syrups, purees and juices",
      "Sodas and water for kids and guests who do not drink",
      "Custom cups over 100 guests",
      "A barback at weddings",
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
    setup: { bar: "The steel bar", menu: "Printed menu card", barback: "Barback at weddings" },
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
