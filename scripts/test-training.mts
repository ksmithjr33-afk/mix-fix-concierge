// The Package card (manager and bartender Details, from lib/packages-info.ts,
// no prices, legacy and unknown packages), the concierge brought in line on
// the four points, and the Training page: Getting started moved unchanged,
// one Packages entry per package with Mark as read and its own count, the
// header link and badge, the deep link from the Package card, and progress
// on the staff list and profile.
// Run: node --no-warnings scripts/test-training.mts

import { check, done, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const pk = await import("../lib/packages-info.ts");
const tr = await import("../lib/team/training.ts");
const certsDb = await import("../lib/team/certs-db.ts");
const cfg = await import("../lib/team/cert-config.ts");
const nav = await import("../lib/team/header-nav.ts");
const menu = await import("../lib/menu-catalog.ts");
const prompt = await import("../lib/system-prompt.ts");

// ===== Item 8: the package guide =====
const names: [string, string][] = [
  ["Beer & Wine", "beer-wine"],
  ["Beer and Wine", "beer-wine"],
  ["Dive Bar", "dive"],
  ["Full Bar", "full"],
  ["Premium Bar", "premium"],
  ["The Big Day Bar", "big-day"],
  ["Essentials Bar", "essentials"],
  ["Tailored Bar", "tailored"],
  ["Bartender Only", "bartender-only"],
];
check("Every package name in use finds its guide", names.every(([n, k]) => pk.packageGuide(n)?.key === k), names.map(([n]) => `${n}:${pk.packageGuide(n)?.key}`).join(", "));
check("An unknown package has no guide", pk.packageGuide("Mystery Bar") === null && pk.packageGuide("") === null);
check("Every package name the Add event form offers has a guide", (await import("../lib/manual-event.ts")).MANUAL_PACKAGES.every((p: string) => pk.packageGuide(p) !== null));
const legacy = pk.PACKAGE_GUIDES.filter((g) => g.legacy).map((g) => g.name);
check("Essentials, Tailored and Bartender Only are the legacy packages", legacy.join() === "Essentials Bar,Tailored Bar,Bartender Only");
// One price by the owner's wording: the Dive Bar menu card line. Nothing else.
const DIVE_CARD_LINE = "Menu card on request only: three classics the client picks, each additional $50.";
check("The guide has no prices anywhere but the Dive Bar menu card line", !/\$\s?\d/.test(JSON.stringify(pk.PACKAGE_GUIDES).replace(DIVE_CARD_LINE, "")) && !/\$\s?\d/.test(JSON.stringify(pk.ALL_PACKAGES)) && pk.packageGuide("Dive Bar")?.setup.menu === DIVE_CARD_LINE);
const g = (k: string) => pk.guideByKey(k)!;
check("Beer and Wine: beer and wine only, no cocktails, no mixers; client brings beer, wine, cups and napkins", g("beer-wine").notIncluded.includes("Cocktails") && g("beer-wine").notIncluded.includes("Mixers") && ["The beer", "The wine", "Cups", "Napkins"].every((x) => g("beer-wine").clientProvides.includes(x)) && g("beer-wine").weBring.includes("One cooler per bartender"));
check("Dive Bar: the five, classics on request, no espresso martini, no mocktails or tasting", ["Margarita", "Old Fashioned", "Cosmopolitan", "Lemon Drop", "Moscow Mule"].every((d) => g("dive").summary.includes(d)) && g("dive").notIncluded.some((x) => /Espresso martinis/.test(x)) && g("dive").notIncluded.includes("Mocktails") && g("dive").notIncluded.includes("A menu tasting"));
check("Full: three specialty cocktails, bar tables, menu card, no custom cups, barback at weddings that can be removed", /Three specialty cocktails/.test(g("full").summary) && g("full").setup.bar === "Bar tables" && !g("full").weBring.some((w: string) => /cups/i.test(w)) && g("full").weBring.includes("A barback at weddings (optional, you can remove it)") && g("full").setup.barback === "Barback at weddings (optional, the client can remove it)");
check("Premium: the wooden bar, cocktail tables, dedicated barback", g("premium").setup.bar === "The handcrafted wooden bar" && g("premium").weBring.includes("Cocktail tables with printed menus") && g("premium").setup.barback === "Dedicated barback");
check("The Big Day Bar: weddings only, two specialty cocktails or two mocktails, barback through cocktail hour", g("big-day").note === "Weddings only" && g("big-day").summary.startsWith("Two specialty cocktails or two mocktails") && g("big-day").setup.barback === "Barback through cocktail hour");
check("Every package: champagne tower, no frozen drinks, ice is for the bar", pk.ALL_PACKAGES.some((l) => /Champagne tower/.test(l)) && pk.ALL_PACKAGES.some((l) => /pina coladas and daiquiris are served on the rocks/i.test(l)) && pk.ALL_PACKAGES.some((l) => /client chills their own beer and wine, except on Beer and Wine/.test(l)));
check("Each package has how service runs, what to say, and setup (bar, menu, barback)", pk.PACKAGE_GUIDES.every((x) => x.service.length > 0 && x.guestAsks.length > 0 && !!x.setup.bar && !!x.setup.menu && !!x.setup.barback));

const card = src("app/team/package-card.tsx");
check("The card shows Legacy package and Confirm details with a manager", card.includes("{g.legacy && <span") && card.includes("{LEGACY_LABEL}") && card.includes("{LEGACY_NOTE}") && pk.LEGACY_LABEL === "Legacy package" && pk.LEGACY_NOTE === "Confirm details with a manager");
check("An unknown package shows its name and No package guide yet", card.includes("{NO_GUIDE}") && card.includes("Package{packageName ? `: ${packageName}` : \"\"}") && pk.NO_GUIDE === "No package guide yet");
check("The card links to that package on the Training page", card.includes("href={trainingHref(g.key)}") && card.includes("Full package guide") && pk.trainingHref("full") === "/team/training#package-full");
check("The card is on manager Details and bartender Details", src("app/team/admin/e/[id]/page.tsx").includes("<PackageCard packageName={v.package} booking={bookingShortOf(session)} />") && src("app/team/e/[id]/event-tabs.tsx").includes("<PackageCard packageName={view.package} booking={packageBooking ?? undefined} />"));
check("The card has no price on either view", !/\$\s?\d|booked_price|\.total\b/.test(card));

// ----- The concierge, brought in line -----
const P = prompt.SYSTEM_PROMPT;
check("(a) Essentials is legacy in the concierge, specialty menu only, no classics, two draped tables", /LEGACY PACKAGES[^]*Essentials Bar Package: Specialty menu only, no classics\.[^\n]*two draped tables/.test(P) && !/CURRENT PACKAGES[^]*Essentials Bar Package[^]*LEGACY PACKAGES/.test(P));
check("(a) New clients are not offered Essentials", P.includes('Which one did you book: Beer and Wine, Dive Bar, The Big Day Bar, Full Bar, or Premium Bar?"'));
check("(b) On Beer and Wine the concierge says our ice and cooler keep the beer and wine cold, matching the policy", P.includes("8. When confirming ice, state once that we bring the ice and 1 cooler per bartender, and that they keep the beer and wine cold. Never ask about extra coolers.") && P.includes("except on Beer and Wine, where our ice and cooler are what keep the beer and wine cold"));
check("The Big Day intro names the classics, from the short wording", P.includes("Just a quick note on what is included with The Big Day Bar: two specialty cocktails for the couple, the classics, bottled water, and a dedicated barback through cocktail hour."));
check("(b) Ice and coolers are for the bar; the client chills beer and wine except on Beer and Wine", P.includes("Our ice and coolers are for the bar. The client chills their own beer and wine, except on Beer and Wine") && !P.includes("the ice for chilling beer, wine, and sodas"));
check("(c) The menu tasting is included in Full", /Full Bar Package: The full bar experience\.[^\n]*A menu tasting is included\./.test(P) && P.includes("included with Full Bar, a private tasting included with Premium") && !P.includes("$60 for one hour on Essentials, The Big Day Bar, and Full Bar"));
check("(d) The Big Day Bar offers two specialty cocktails or two mocktails", P.includes("The Big Day Bar offers two specialty cocktails or two mocktails") && P.includes("Mocktails are only available on Full Bar, Premium Bar, and The Big Day Bar") && !/On Dive Bar, Essentials Bar, and The Big Day Bar, never offer or create mocktails/.test(P));
check("(d) The Add event form follows: mocktails on Big Day, never on Essentials or Dive", menu.allowsMocktails("The Big Day Bar") && !menu.allowsMocktails("Essentials Bar") && !menu.allowsMocktails("Dive Bar") && menu.allowsMocktails("Full Bar"));
check("The update chat reads the same rules", src("lib/update-prompt.ts").includes("DRINK SOURCING BY PACKAGE"));

// ----- Big Day: classics on request, sized like Full -----
const sl = await import("../lib/shopping-list.ts");
const cl = await import("../lib/client-list.ts");
const withClassic = [
  { name: "French Martini", base_spirit: "vodka", ingredients: ["2 oz vodka", "0.75 oz raspberry liqueur", "2 oz pineapple juice"] },
  { name: "Old Fashioned", base_spirit: "whiskey", ingredients: ["2 oz whiskey", "0.25 oz simple syrup", "2 dashes bitters"] },
];
const ev = (pkg: string) => ({ package: pkg, guest_count: 120, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_type: "Wedding", signature_drinks: withClassic, beer: true, wine: true });
const alcohol = (pkg: string) => JSON.stringify(sl.generateShoppingList(ev(pkg) as never).filter((i) => i.category !== "Supplies"));
check("Big Day sizes the alcohol for a classic exactly like Full", alcohol("The Big Day Bar") === alcohol("Full Bar") && alcohol("Full Bar").includes("hiskey"), alcohol("The Big Day Bar"));
const sections = (pkg: string) => JSON.stringify(cl.clientList(ev(pkg) as never).sections.filter((x: { title?: string }) => !/supplies|soda|water/i.test(String(x.title ?? ""))));
check("The client shopping list's alcohol matches Full on Big Day", sections("The Big Day Bar").replace(/The Big Day Bar/g, "") === sections("Full Bar").replace(/Full Bar/g, ""));
check("Big Day offers classics on request in the concierge, like Full", /The Big Day Bar: CRAFT MENU FIRST, CLASSICS ON REQUEST/.test(prompt.SYSTEM_PROMPT) && !/Essentials Bar and The Big Day Bar: CRAFT MENU ONLY/.test(prompt.SYSTEM_PROMPT));
check("The client sees both menu pictures on Big Day, like Full", (await import("../lib/menu-markers.ts")).allowedMenus("The Big Day Bar").join() === "specialty,classics");
check("The Add event form lets Big Day pick classics", menu.menuPool("The Big Day Bar") === "craft_classics" && menu.menuPool("Essentials Bar") === "craft" && menu.drinksFor("The Big Day Bar").some((d) => d.key.startsWith("classic:")));

// ----- Champagne tower: included on request, never priced -----
check("The champagne tower is off the add ons list and never priced", !/Champagne tower, starts at/i.test(prompt.SYSTEM_PROMPT) && !/champagne tower[^\n.]*\$\d/i.test(prompt.SYSTEM_PROMPT) && !/add ons like[^"]*champagne/i.test(prompt.SYSTEM_PROMPT));
check("The concierge says it is included on request and the client provides the champagne", /CHAMPAGNE TOWER: [^\n]*included in the service on every package[^\n]*on request[^\n]*client provides the champagne/i.test(prompt.SYSTEM_PROMPT));
check("The update chat no longer treats it as an add on", !/Add ons, including the champagne tower/i.test(src("lib/update-prompt.ts")) && /champagne tower is included/i.test(src("lib/update-prompt.ts")));

// ===== Item 9: Training =====
check("Two sections: Getting started, then Packages", tr.TRAINING_SECTIONS.map((s) => s.title).join() === "Getting started,Packages");
const gs = tr.TRAINING_SECTIONS[0];
check("Getting started is the five onboarding steps, same ids and pages", gs.items.length === 5 && gs.items.every((i, n) => i.ackId === cfg.ONBOARDING[n].id && i.href === `/team/onboarding/${cfg.ONBOARDING[n].id}`) && gs.intro === cfg.ONBOARDING_INTRO);
const pkgs = tr.TRAINING_SECTIONS[1];
check("Packages: one entry per package, Legacy grouped at the bottom", pkgs.items.length === pk.PACKAGE_GUIDES.length && pkgs.items.slice(-3).every((i) => i.group === "Legacy packages") && pkgs.items.slice(0, -3).every((i) => !i.group));
check("Each package entry has its anchor for the deep link", pkgs.items.every((i) => /^package-/.test(i.anchor ?? "")));

db.staff = [{ id: "b1", name: "Taylor Brooks", phone: "+12145550111", role: "bartender", active: true }, { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin", active: true }];
db.staff_onboarding = [];
const taylor = db.staff[0] as never;
check("Nothing read: the badge counts everything", (await certsDb.trainingUnreadFor("b1")) === 5 + pk.PACKAGE_GUIDES.length);
await certsDb.acknowledgeItem(taylor, "name_phone");
await certsDb.acknowledgeItem(taylor, "certification");
check("Getting started acks work as before and count X of 5 done", (await certsDb.onboardingProgress(["b1"])).get("b1") === 2 && tr.trainingProgress(await certsDb.onboardingDone("b1"))[0].text === "2 of 5 done");
const r1 = await certsDb.acknowledgeTraining(taylor, tr.packageAckId("full"));
check("Mark as read saves a package", r1.ok && db.staff_onboarding.some((r) => r.staff_id === "b1" && r.item_id === "package:full"));
check("Unknown items cannot be marked", !(await certsDb.acknowledgeTraining(taylor, "package:nope")).ok && !(await certsDb.acknowledgeTraining(taylor, "anything")).ok);
const prog = tr.trainingProgress(await certsDb.onboardingDone("b1"));
check("Packages has its own X of Y read, separate from Getting started", prog[1].text === `1 of ${pk.PACKAGE_GUIDES.length} read` && prog[0].text === "2 of 5 done");
check("Package reads never count toward the old onboarding count", (await certsDb.onboardingProgress(["b1"])).get("b1") === 2);
check("The badge drops as things are read", (await certsDb.trainingUnreadFor("b1")) === 3 + pk.PACKAGE_GUIDES.length - 1);
const many = await certsDb.trainingProgressFor(["b1", "a1"]);
check("Progress for the staff list and profile, both sections", tr.progressLine(many.get("b1")!) === `Getting started 2 of 5 · Packages 1 of ${pk.PACKAGE_GUIDES.length}` && tr.progressLine(many.get("a1")!) === `Getting started 0 of 5 · Packages 0 of ${pk.PACKAGE_GUIDES.length}`);

// The header.
const bar = nav.headerLinks(false, { unreadNews: 0, training: 4 });
const adm = nav.headerLinks(true, { unreadNews: 0, training: 0 });
check("Everyone else: Events, Training, News, Me", bar.map((l) => l.label).join() === "Events,Training,News,Me");
check("Admins and managers: Training after News", adm.map((l) => l.label).join() === "Staffing,Staff,Clients,Partners,Time,Scorecard,News,Training,Me");
check("The Training row has a count badge for anything unread", bar.find((l) => l.label === "Training")!.badge === 4 && nav.menuHasBadge(bar) && adm.find((l) => l.label === "Training")!.badge === 0);
check("Training is the current page on the Training page and on old onboarding pages", nav.currentHref(bar, "/team/training") === "/team/training" && nav.currentHref(bar, "/team/onboarding/tabc") === "/team/training");
check("The header reads the Training count", src("app/team/team-header.tsx").includes("trainingUnreadFor(viewed.id)"));
check("The Me page keeps a Training link to the same page", src("app/team/me/page.tsx").includes('{ href: "/team/training", title: "Training"'));

// The pages.
check("/team/onboarding redirects to Training, so old links and texts still work", src("app/team/onboarding/page.tsx").includes("redirect(`${TRAINING_PATH}#getting-started`)"));
check("A Getting started step comes back to Training", src("app/team/onboarding/[item]/ack-button.tsx").includes('router.push("/team/training")') && src("app/team/onboarding/[item]/page.tsx").includes('{ href: "/team/training", label: "Training" }'));
const page = src("app/team/training/page.tsx");
check("The Training page renders every section from the list, so more can be added", page.includes("TRAINING_SECTIONS.map((s) =>") && page.includes("progress.get(s.id)?.text"));
const entries = src("app/team/training/package-entries.tsx");
check("Each package expands, with Mark as read", entries.includes("<details id={trainingAnchor(g.key)}") && entries.includes(': MARK_READ}') && entries.includes('fetch("/api/team/training"'));
check("Each entry covers how service runs, what to say, and setup", entries.includes('"How service runs"') && entries.includes("When a guest asks for something not included") && entries.includes("Barback: "));
check("A Full package guide link opens that entry", entries.includes("el.open = true") && entries.includes('addEventListener("hashchange", open)'));
check("Legacy packages are their own group at the bottom", entries.indexOf("current.map") < entries.indexOf("Legacy packages</h3>"));
check("The route is signed in only and saves for the person themselves", src("app/api/team/training/route.ts").includes("acknowledgeTraining(staff, ackId)") && src("app/api/team/training/route.ts").includes("status: 401"));
check("The staff list shows Training for everyone", src("app/team/admin/staff/page.tsx").includes("add(s.id, `Training: ${progressLine(onboard.get(s.id) ?? [])}`);"));
check("Each staff profile shows both sections item by item", src("app/team/admin/staff/[id]/page.tsx").includes('aria-label="Training"') && src("app/team/admin/staff/[id]/page.tsx").includes("TRAINING_SECTIONS.map((s) =>"));

// ----- The short package section (admin, staff and planner event pages) -----
{
  const sh = (k: string) => g(k).short;
  const all = (k: string) => [sh(k).line, ...sh(k).bullets, sh(k).provides].join(" ");
  check("Beer and Wine: the new wording", sh("beer-wine").line === "Beer and wine service only." && all("beer-wine").includes("We bring the bartender, ice, and one cooler per bartender, plus a bar table if needed.") && sh("beer-wine").provides === "The client provides the beer, wine, and cups.");
  check("Dive Bar: the new wording", sh("dive").line === "The dive bar experience." && all("dive").includes("A set menu of five classics (margarita, old fashioned, cosmo, lemon drop, Moscow mule)") && all("dive").includes("Plus just about any classic a guest asks for.") && all("dive").includes("We bring the bartender, bar tables, tools, mixers, garnishes, cups, napkins, straws, ice, and coolers."));
  check("Full Bar: the new wording", sh("full").line === "Three specialty cocktails designed for the event, just about any classic, and mocktails, sodas, and water for kids and guests who do not drink." && sh("full").bullets.join("|") === "We bring the full stock, bar tables, and a printed menu card.|A barback at weddings (optional, you can remove it).");
  check("Premium: the new wording, the wooden bar kept", sh("premium").line === "Everything in Full Bar, plus:" && sh("premium").bullets.join("|") === "The wooden bar|Decor styled to the theme|Custom cups and napkins|Cocktail tables|A dedicated barback");
  check("The Big Day Bar: the new wording", sh("big-day").line === "Weddings only." && sh("big-day").bullets.join("|") === "Two specialty cocktails for the couple|The classics|Bottled water|A dedicated barback through cocktail hour");
  check("Bartender Only: the new wording", sh("bartender-only").line === "Just the bartender." && sh("bartender-only").bullets.length === 0 && sh("bartender-only").provides === "The client provides everything else.");
  check("Every package: one short line and at most five short bullets", pk.PACKAGE_GUIDES.every((x) => !!x.short.line && x.short.bullets.length <= pk.MAX_PACKAGE_BULLETS && x.short.bullets.every((b) => b.length <= 110)));
  check("What the client provides stays its own short line", pk.PACKAGE_GUIDES.every((x) => x.short.provides.startsWith("The client provides")));
  check("The short wording has no hyphens", pk.PACKAGE_GUIDES.every((x) => !/[-‐-―]/.test([x.short.line, ...x.short.bullets, x.short.provides].join(" "))));
  const cardNow = src("app/team/package-card.tsx");
  check("The admin and staff Package card shows only the short section", cardNow.includes("packageShortFor(packageName, booking ?? {})") && cardNow.includes("{short!.line}") && cardNow.includes("short!.bullets.map") && cardNow.includes("{short!.provides}") && !cardNow.includes("g.weBring") && !cardNow.includes("ALL_PACKAGES") && !cardNow.includes("notIncluded"));
  const plannerPage = src("app/partners/e/[key]/page.tsx");
  check("The planner event page shows the same short section", src("lib/partners/event-page.ts").includes("packageShortFor(v.package, bookingShortOf(s))") && src("lib/partners/event-page.ts").includes("packageLine: short ? short.line") && plannerPage.includes("{v.packageLine}") && plannerPage.includes("v.packageBullets.map") && plannerPage.includes("{v.packageProvides}") && !plannerPage.includes("packageIncludes"));
}

// ----- Bar tables, not steel bar -----
{
  const { execSync } = await import("node:child_process");
  const hits = execSync("grep -rIil 'steel bar' app lib || true", { encoding: "utf8" }).trim();
  check('No "steel bar" anywhere in app or lib', hits === "", hits);
  check("Full Bar brings bar tables; the Premium wooden bar stays", g("full").weBring.includes("Bar tables") && g("full").setup.bar === "Bar tables" && g("premium").setup.bar === "The handcrafted wooden bar");
}

done("training and package");
