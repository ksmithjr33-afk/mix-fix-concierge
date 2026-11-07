// Checks the menu text the bot reads and the shopping lines those drinks produce.
// Run: npm run test:menu   (plain node, Node 22.6+ strips the types)
// Exits 1 if any check fails.

import { registerHooks } from "node:module";

// lib/ imports use the "@/" path alias, which plain node does not know.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const url = new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href;
      return nextResolve(url, context);
    }
    return nextResolve(specifier, context);
  },
});

const { DRINK_MENU_RULES, SYSTEM_PROMPT: DRINK_SOURCING_AND_PACKAGE_TEXT } = await import("../lib/system-prompt.ts");
const list = await import("../lib/shopping-list.ts");

let failed = 0;
let total = 0;
function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}

const lines = DRINK_MENU_RULES.split("\n");

/** The lines of a menu section, from its === or plain heading to the next heading. */
function section(start: string, end: string): string[] {
  const from = lines.findIndex((l: string) => l.startsWith(start));
  const to = lines.findIndex((l: string, i: number) => i > from && l.startsWith(end));
  return from < 0 || to < 0 ? [] : lines.slice(from, to);
}

function otherLine(spirit: string, nextSpirit: string, drink: string): string | undefined {
  const s = section(`=== ${spirit} ===`, `=== ${nextSpirit} ===`);
  return s.slice(s.indexOf("OTHER:")).find((l) => l.startsWith(`${drink}:`));
}

// ----- Menu text -----
const classicsRum = section("RUM AND COGNAC", "BUBBLY");
const pina = classicsRum.find((l) => l.startsWith("Pina Colada:")) ?? "";
const daiquiri = classicsRum.find((l) => l.startsWith("Daiquiri:")) ?? "";
check(
  "Pina Colada is in CLASSICS under rum with its recipe",
  pina === "Pina Colada: 2 oz rum, 1.5 oz coconut cream, 2 oz pineapple juice, shaken and served on the rocks, pineapple wedge garnish",
  pina
);
check("Pina Colada recipe says on the rocks", pina.includes("on the rocks"));
check("Daiquiri recipe says on the rocks", daiquiri.includes("0.5 oz simple syrup") && daiquiri.includes("on the rocks"), daiquiri);

const mojito = otherLine("RUM", "GIN", "Mojito") ?? "";
check(
  "Mojito is a rum OTHER drink with its recipe",
  mojito.includes("Recipe: 2 oz rum, 0.75 oz lime juice, 0.5 oz simple syrup, muddled mint, top with soda water") && mojito.includes("mint garnish"),
  mojito
);
const julep = otherLine("WHISKEY", "RUM", "Mint Julep") ?? "";
check(
  "Mint Julep is a whiskey OTHER drink with its recipe",
  julep.includes("Recipe: 2 oz bourbon, 0.5 oz simple syrup, muddled mint, crushed ice") && julep.includes("mint garnish"),
  julep
);
const bloody = otherLine("VODKA", "TEQUILA", "Bloody Mary") ?? "";
check(
  "Bloody Mary is a vodka OTHER drink with its recipe",
  bloody.includes("Recipe: 1.5 oz vodka, 4 oz tomato juice, dash Worcestershire, dash hot sauce, 0.5 oz lemon juice, salt, pepper") && bloody.includes("celery garnish"),
  bloody
);
check("None of the three is listed in CLASSICS", !section("=== CLASSICS", "Only a drink").some((l) => /^(Mojito|Mint Julep|Bloody Mary):/.test(l)));

check("The old exclusion line is gone", !DRINK_MENU_RULES.includes("are NOT classics and are not auto filled"));
check("Only drinks on neither menu are excluded", DRINK_MENU_RULES.includes("Only a drink on neither the craft menu nor the CLASSICS section is excluded."));
check(
  "Mai Tai craft menu rule is kept",
  /Mai Tai are on the craft menu[^\n]*\(Essentials Bar, The Big Day Bar, Full Bar, Premium Bar\)[^\n]*normal menu drink/.test(DRINK_MENU_RULES) &&
    !!otherLine("RUM", "GIN", "Mai Tai")
);

const NOT_ON_DIVE = "That one is not part of the Dive Bar package";
const autoFill = lines.find((l: string) => l.startsWith("AUTO FILL BY PACKAGE:")) ?? "";
for (const drink of ["Espresso Martini", "Mojito", "Mint Julep", "Bloody Mary", "Mai Tai"]) {
  check(`${drink} gets the flat answer on Dive Bar`, new RegExp(`NEVER available on Dive Bar[^.]*\\b${drink}\\b`).test(autoFill), autoFill.slice(0, 200));
}
check("Dive Bar flat answer offers classics and asks for no recipe", autoFill.includes(`"${NOT_ON_DIVE}" and offer drinks from the CLASSICS section instead. Do not ask for a recipe.`));
const neitherLine = lines.find((l: string) => l.startsWith("Only a drink on neither")) ?? "";
check("Exclusion line gives Dive Bar the flat answer", neitherLine.includes(NOT_ON_DIVE) && neitherLine.includes("Do not ask for a recipe."), neitherLine);
check("Exclusion line no longer sends these drinks off list on Dive Bar", !neitherLine.includes("handled as an off list drink"));
check(
  "Dive Bar package flow bars the four from signature picks",
  DRINK_SOURCING_AND_PACKAGE_TEXT.includes("never Espresso Martini, French Connection, Aperol Spritz, Mojito, Mint Julep, Bloody Mary, or Mai Tai")
);

const frozen = lines.find((l: string) => l.startsWith("ON THE ROCKS, NEVER FROZEN:")) ?? "";
check("Frozen rule names both drinks", frozen.includes("Pina Colada and Daiquiri are served on the rocks, never frozen"), frozen);
check("Frozen rule gives the answer", frozen.includes("We serve that one on the rocks, we do not do frozen drinks."));
check("Frozen rule notes special_requests only if the client still wants to discuss it", frozen.includes("unless the client still wants to discuss it"));

// ----- Shopping lines -----
const event = (pkg: string, drinks: object[], guest_count = 100) => ({
  package: pkg,
  guest_count,
  drinking_pace: "moderate",
  beer: false,
  wine: false,
  bar_service_start: "6:00 PM",
  bar_service_end: "10:00 PM",
  event_type: "wedding",
  signature_drinks: drinks,
});

const PINA = { name: "Pina Colada", base_spirit: "rum", ingredients: ["2 oz rum", "1.5 oz coconut cream", "2 oz pineapple juice"], method: "shaken, on the rocks", garnish: "pineapple wedge" };
const MOJITO = { name: "Mojito", base_spirit: "rum", ingredients: ["2 oz rum", "0.75 oz lime juice", "0.5 oz simple syrup", "muddled mint", "top with soda water"], garnish: "mint" };
const JULEP = { name: "Mint Julep", base_spirit: "bourbon", ingredients: ["2 oz bourbon", "0.5 oz simple syrup", "muddled mint", "crushed ice"], garnish: "mint" };
const BLOODY = { name: "Bloody Mary", base_spirit: "vodka", ingredients: ["1.5 oz vodka", "4 oz tomato juice", "dash Worcestershire", "dash hot sauce", "0.5 oz lemon juice", "salt", "pepper"], garnish: "celery" };
// The way the model may write the same drinks: serving notes and garnishes in the ingredients.
const MESSY = [
  { ...PINA, ingredients: [...PINA.ingredients, "shaken", "on the rocks", "pineapple wedge"], garnish: "" },
  { ...BLOODY, ingredients: ["1.5 oz vodka", "4 oz tomato juice", "dash of Worcestershire", "2 dashes hot sauce", "0.5 oz lemon juice", "salt and pepper", "celery garnish"], garnish: "" },
  { ...JULEP, ingredients: ["2 oz bourbon", "0.5 oz simple syrup", "8 mint leaves", "crushed ice", "mint garnish"], garnish: "" },
];

const quiet = console.log;
function lists(e: ReturnType<typeof event>): Record<string, string> {
  console.log = () => {};
  try {
    const items = list.generateShoppingList(e);
    return {
      "supply list": list.generateNatalieSupplyList(e),
      "order email": list.generateOrderTeamEmail(items, e),
    };
  } finally {
    console.log = quiet;
  }
}

const lineWith = (text: string, word: string) =>
  text.split(/<br>|\n/).find((l) => l.toLowerCase().includes(word.toLowerCase())) ?? "";

const full = lists(event("Full Bar", [PINA, MOJITO, BLOODY]));
const expected: [string, RegExp][] = [
  ["coconut cream", /coconut cream — 4 x 16\.9 oz cans/i],
  ["fresh mint", /fresh mint — 4 bunches/i],
  ["tomato juice", /tomato juice — 3 x 46 oz cans/i],
  ["worcestershire", /worcestershire — 1 x 10 oz bottle/i],
  ["hot sauce", /hot sauce — 1 x 5 oz bottle/i],
  ["celery", /celery — 3 bunches/i],
];
for (const [name, text] of Object.entries(full)) {
  for (const [word, pattern] of expected) {
    check(`${name} has ${word}`, pattern.test(text), lineWith(text, word) || "no line");
  }
}

const order = full["order email"];
const storeOf = (word: string) => {
  const before = order.slice(0, order.toLowerCase().indexOf(word));
  return [...before.matchAll(/<b>([^<]+)<\/b>|^([A-Z][^\n:]*):?$/gm)].at(-1)?.[0] ?? "";
};
check("Coconut cream is bought at Specs", /spec/i.test(storeOf("coconut cream")), storeOf("coconut cream"));
for (const word of ["fresh mint", "celery", "worcestershire", "hot sauce"]) {
  check(`${word} is bought at Walmart`, /walmart/i.test(storeOf(word)), storeOf(word));
}

const countBunches = (drinks: object[]) =>
  Number(lineWith(lists(event("Full Bar", drinks, 300))["supply list"], "fresh mint").match(/(\d+) bunches/)?.[1]);
check("Fresh mint grows with the number of mint drinks", countBunches([MOJITO, JULEP, BLOODY]) > countBunches([MOJITO, PINA, BLOODY]));
check(
  "Muddled mint with no garnish still gets a mint line",
  /fresh mint/i.test(lists(event("Full Bar", [{ ...MOJITO, garnish: "" }]))["supply list"])
);

const mintBunches = (drinks: object[]) =>
  Number(lineWith(lists(event("Full Bar", drinks))["supply list"], "fresh mint").match(/(\d+) bunches/)?.[1]);
const GARNISH_MINT = { name: "Garnish only", base_spirit: "rum", ingredients: ["2 oz rum", "0.75 oz lime juice"], garnish: "mint" };
const NO_MINT = { name: "No mint", base_spirit: "gin", ingredients: ["2 oz gin", "0.75 oz lemon juice"], garnish: "" };
check("Mojito for 100 guests at the 3 drink split is 4 to 5 bunches", [4, 5].includes(mintBunches([MOJITO, NO_MINT, BLOODY])), String(mintBunches([MOJITO, NO_MINT, BLOODY])));
check("Garnish only mint stays at the garnish rate", mintBunches([GARNISH_MINT, NO_MINT, BLOODY]) === 3, String(mintBunches([GARNISH_MINT, NO_MINT, BLOODY])));
check("Muddled and garnish mint drinks add up", mintBunches([MOJITO, GARNISH_MINT, BLOODY]) === 6, String(mintBunches([MOJITO, GARNISH_MINT, BLOODY])));

const wrongLine = /(ice|rocks|shaken|wedge|celery|pepper|garnish|mint)[^<\n—]*— \d+ x 1 liter bottle/i;
for (const [name, text] of Object.entries(lists(event("Full Bar", [JULEP, ...MESSY])))) {
  check(`${name} prints no liter bottle of ice, garnish, or serving notes`, !wrongLine.test(text), text.match(wrongLine)?.[0]);
  check(`${name} sizes the dash ingredients when written other ways`, /worcestershire — 1 x 10 oz/i.test(text) && /hot sauce — 1 x 5 oz/i.test(text));
  check(`${name} has mint and celery when written in the ingredients`, /fresh mint —/i.test(text) && /celery —/i.test(text));
}

for (const [name, text] of Object.entries(lists(event("Dive Bar", [])))) {
  check(`Dive Bar no menu ${name} has 1 bottle coconut cream`, /coconut cream — 1 bottle/i.test(text), lineWith(text, "coconut cream") || "no line");
}
check(
  "Dive Bar well stays at 1 bottle coconut cream for a big party",
  /coconut cream — 1 bottle/i.test(lists(event("Dive Bar", [], 300))["supply list"])
);

for (const [guests, whole] of [[25, 1], [50, 1], [100, 2], [300, 6]]) {
  for (const [name, text] of Object.entries(lists(event("Dive Bar", [], guests)))) {
    check(`Dive Bar no menu ${name} has ${whole} pineapple for ${guests} guests`, new RegExp(`pineapple — ${whole} whole`, "i").test(text), lineWith(text, "pineapple —") || "no line");
  }
}
check("Dive Bar with a menu does not get the well pineapple line", !/pineapple — \d+ whole/i.test(lists(event("Dive Bar", [BLOODY]))["supply list"]));

if (failed > 0) {
  console.error(`\n${failed} of ${total} menu checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} menu checks pass.`);
