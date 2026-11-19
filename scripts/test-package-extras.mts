// Package changes: Full Bar no longer includes custom cups over 100 guests
// (Premium keeps them; the two older bookings flagged by the migration keep
// theirs), the Full Bar wedding barback is on by default and can be removed
// (and added back) through the normal price change flow by the client or an
// admin, the Big Day Bar and Premium keep a barback that cannot be removed,
// and every client facing package description comes from the short wording.
// Real code against the in-memory database.
// Run: node --no-warnings scripts/test-package-extras.mts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { addDays, check, done, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const pricing = await import("../lib/pricing.ts");
const pc = await import("../lib/price-change.ts");
const info = await import("../lib/packages-info.ts");
const extras = await import("../lib/package-extras.ts");
const pp = await import("../lib/package-prompt.ts");
const updates = await import("../lib/event-updates.ts");
const editDb = await import("../lib/team/admin-edit-db.ts");
const intakeBb = await import("../lib/intake-barback.ts");
const prompt = await import("../lib/system-prompt.ts");
const upPrompt = await import("../lib/update-prompt.ts");
const time = await import("../lib/team/time.ts");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const DAY = longDate(addDays(time.chicagoToday(), 40));
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };

function sessionRow(id: string, pkg: string, eventType: string, guests = 100) {
  return {
    id,
    name: "Jamie Cole",
    email: "jamie@example.com",
    event_date: DAY,
    package_type: pkg,
    guest_count: String(guests),
    event_name: null,
    event_type: eventType,
    hours_booked: "5",
    status: "submitted",
    version: 1,
    submitted_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    booked_price: null,
    package_extras: {},
    event_data: {
      client_name: "Jamie Cole",
      email: "jamie@example.com",
      event_type: eventType,
      event_date: DAY,
      bar_service_start: "5:00pm",
      bar_service_end: "10:00pm",
      hours_booked: 5,
      guest_count: guests,
      package: pkg,
      event_address: "123 Elm St, Dallas, TX 75201",
      signature_drinks: [],
    },
  };
}
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [
    sessionRow("fw", "Full Bar", "Wedding"),
    sessionRow("fb", "Full Bar", "Birthday"),
    sessionRow("bd", "The Big Day Bar", "Wedding"),
    sessionRow("pr", "Premium Bar", "Wedding"),
  ];
  db.event_updates = [];
  db.staff = [admin];
  db.event_assignments = [];
}
reset();
type Row = ReturnType<typeof sessionRow> & { event_data: Record<string, unknown>; package_extras: Record<string, unknown> };
const row = (id: string) => db.sessions.find((s) => s.id === id) as unknown as Row;

// ===== 1. Custom cups =====
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const sources = [...walk("app"), ...walk("lib")].filter((f) => f !== join("lib", "package-extras.ts") && f !== join("lib", "package-prompt.ts"));
const cupsOver100 = sources.filter((f) => /cups[^.\n]{0,40}(over|above|more than) 100|free on Full Bar/i.test(readFileSync(f, "utf8")));
check("Cups: no Full Bar custom cups over 100 guests anywhere in app or lib", cupsOver100.length === 0, cupsOver100.join(", "));
check("Cups: the Full guide and short wording have no cups", !info.packageGuide("Full Bar")!.weBring.some((w) => /cups/i.test(w)) && !info.packageShortFor("Full Bar")!.bullets.some((b) => /cups/i.test(b)));
check("Cups: the concierge add on line is a paid add on, free only with Premium", prompt.ADD_ONS_RULES.includes("Custom cups, $2.50 per guest, 30 guest minimum, included free with Premium\n") && !/Full Bar events over 100/.test(prompt.ADD_ONS_RULES));
check("Cups: Premium still has custom cups", info.packageShortFor("Premium Bar")!.bullets.includes("Custom cups and napkins") && info.packageGuide("Premium Bar")!.weBring.some((w) => /cups/i.test(w)) && extras.cupsIncluded({ event_data: { package: "Premium Bar" } }));
check("Cups: a Full Bar event over 100 guests without the flag has no cups", !extras.cupsIncluded(row("fw")) && !extras.bookingShortOf(row("fw")).cups);

// ===== 3. The flagged events keep their cups =====
const mig = readFileSync("supabase/migrations/20261227_package_extras.sql", "utf8");
check("Flag: the migration adds package_extras and flags exactly the two events by id", /add column if not exists package_extras jsonb not null default '\{\}'/.test(mig) && mig.includes("where id in ('02f9e4fb', '37bc6434')") && /'cups_included', true/.test(mig) && /not \(package_extras \? 'cups_included'\)/.test(mig));
const flagged = { ...row("fw"), package_extras: { cups_included: true, cups_set_by: "Cutover" } };
check("Flag: a flagged event still shows custom cups on its Package card", info.packageShortFor("Full Bar", extras.bookingShortOf(flagged))!.bullets.includes(info.CUPS_WITH_BOOKING) && extras.cupsIncluded(flagged));
check("Flag: the concierge is told this booking includes cups at no charge", /CUSTOM CUPS: this booking was made when Full Bar included custom cups/.test(pp.bookingPackageSection(flagged, "Full Bar", [], "update")));
check("Flag: the client page shows it too", src("app/s/page.tsx").includes("cups={extrasOf(data).cups_included === true}") && src("app/s/event-summary.tsx").includes("cups,"));

// ===== 2. The Full Bar wedding barback =====
const base = { package: "full", guests: 100, hours: 5, isWedding: true, bartenders: 2, tipJar: true };
const withBb = pricing.priceEvent(base)!;
const without = pricing.priceEvent({ ...base, barback: false })!;
check("Engine: a Full Bar wedding prices the barback in by default", withBb.total > without.total && pricing.priceEvent({ ...base, barback: true })!.total === withBb.total);
check("Engine: removing it only matters on a Full Bar wedding", pricing.priceEvent({ ...base, isWedding: false })!.total === pricing.priceEvent({ ...base, isWedding: false, barback: false })!.total);
check("Engine: Premium and the Big Day Bar ignore it", ["premium", "wedding"].every((p) => pricing.priceEvent({ ...base, package: p })!.total === pricing.priceEvent({ ...base, package: p, barback: false })!.total));
check("Basis: an event with no barback field is on, Removed is off", pc.basisFromEvent(row("fw").event_data as never, row("fw") as never, { tipJar: true }).barback === true && pc.basisFromEvent({ ...row("fw").event_data, barback: "Removed" } as never, row("fw") as never, { tipJar: true }).barback === false);
check("Status: every Full Bar wedding starts with the barback on, existing and new", extras.barbackStatus(row("fw")).on && extras.barbackStatus(row("fw")).removable && extras.barbackStatus(row("fw")).line === "Barback: included");
check("Status: a Full Bar birthday has no barback", !extras.barbackStatus(row("fb")).applies);
check("Wording: A barback at weddings (optional, you can remove it)", info.packageShortFor("Full Bar")!.bullets.includes("A barback at weddings (optional, you can remove it).") && !sources.some((f) => /recommended \(add on\)/i.test(readFileSync(f, "utf8"))));
check("Wording: the Full card for a wedding shows the barback line, a birthday does not", info.packageShortFor("Full Bar", extras.bookingShortOf(row("fw")))!.bullets.includes(info.BARBACK_AT_WEDDINGS) && !info.packageShortFor("Full Bar", extras.bookingShortOf(row("fb")))!.bullets.some((b) => /barback/i.test(b)));

// The concierge: the recommendation once, then what the client decides.
const sec = pp.bookingPackageSection(row("fw"), "Full Bar", [], "update");
check("Concierge: asked to remove it, it recommends keeping it once, in one sentence", sec.includes(`First say once, in one sentence, exactly: "${pp.BARBACK_KEEP_LINE}"`) && pp.BARBACK_KEEP_LINE === "We recommend keeping the barback so your bartenders never have to leave the bar.");
check("...then quotes the removal with the price change flow", sec.includes('call quote_price_change with barback "Removed"') && sec.includes('update_event_data with barback "Removed" and quoted_new_total'));
const after = pp.bookingPackageSection(row("fw"), "Full Bar", [{ role: "assistant", content: `${pp.BARBACK_KEEP_LINE} Would you still like to remove it?` }], "update");
check("...and never says the recommendation a second time", !after.includes("First say once") && after.includes("Do not say it again."));
check("Concierge: it never brings up removing it on its own", sec.includes("Do not bring up removing it yourself."));
check("Concierge: the update tool and quote tool take barback", src("app/api/chat/route.ts").includes('packageSection: bookingPackageSection(session, String(eventData.package ?? ""), messages, approvalOnly ? "approval" : "update")') && (updates as unknown as object) !== null);

// Client removes it in update mode: a credit through the normal flow.
const quote = await updates.quoteEventUpdate("fw", { barback: "Removed" });
const credit = quote?.price?.amount ?? 0;
check("Update mode: removing it is quoted as a credit", !!quote?.price && credit < 0, JSON.stringify(quote?.price));
const applied = await updates.applyEventUpdate("fw", { barback: "Removed" }, { requireQuote: true, quotedNewTotal: quote!.price!.new_total! });
check("Update mode: on a yes it saves, with the change order and the lower total", !!applied && applied.rows.some((r) => r.applied) && row("fw").event_data.barback === "Removed" && (row("fw").booked_price as { total: number }).total === quote!.price!.new_total);
check("...recorded as removed by the client, with when", row("fw").package_extras.barback_by === "client" && !!row("fw").package_extras.barback_at && extras.barbackStatus(row("fw")).line === "Barback: removed by client");
check("...and no barback is needed for staffing", !extras.barbackStatus(row("fw")).on);
check("...the Package card says it was removed", info.packageShortFor("Full Bar", extras.bookingShortOf(row("fw")))!.bullets.includes(info.BARBACK_REMOVED_LINE));
const removedSec = pp.bookingPackageSection(row("fw"), "Full Bar", [], "update");
check("...and the concierge can add it back at the same price", removedSec.includes('quote_price_change with barback "Included"') && removedSec.includes("same price as before"));
const back = await updates.quoteEventUpdate("fw", { barback: "Included" });
check("Adding it back costs the same amount the removal credited", back?.price?.amount === -credit, `${back?.price?.amount} vs ${credit}`);

// An admin on the Booking card.
reset();
const preview = await editDb.previewAdminEdit("fw", { barback: "Removed" });
check("Admin: the Booking card shows the engine's credit first", preview.ok && preview.preview.priced && (preview.preview.engineAmount ?? 0) < 0);
const saved = await editDb.saveAdminEdit({ sessionId: "fw", admin, changes: { barback: "Removed" }, price: { mode: "engine" }, expectedVersion: 1, origin: "https://plan.test" });
check("Admin: removing it saves through the price change flow", saved.ok && row("fw").event_data.barback === "Removed" && db.event_updates.some((u) => (u as { source: string }).source === "manager"));
check("...the Team tab says removed by the admin's name", extras.barbackStatus(row("fw")).line === "Barback: removed by Kenneth");
const again = await editDb.saveAdminEdit({ sessionId: "fw", admin, changes: { barback: "Included" }, price: { mode: "engine" }, expectedVersion: row("fw").version, origin: "https://plan.test" });
check("Admin: adding it back works the same way", again.ok && extras.barbackStatus(row("fw")).on && extras.barbackStatus(row("fw")).line === "Barback: included");
check("Booking card and Team tab use it", src("app/team/admin/e/[id]/booking-card.tsx").includes("<BarbackControl sessionId={sessionId} data={barback} />") && src("app/team/admin/e/[id]/page.tsx").includes("{barback.line}") && src("app/team/admin/e/[id]/page.tsx").includes("(barbackNeeded ? 1 : 0)"));

// Intake: the price for removing it is in the prompt, and it is applied after the final save.
reset();
const iq = intakeBb.intakeBarbackQuote(row("fw") as never);
check("Intake: the engine's credit for removing it is worked out for the prompt", !!iq && iq.amount < 0);
const isec = pp.bookingPackageSection(row("fw"), "Full Bar", [], "intake", iq);
check("Intake: the concierge states that credit and the new total, then sends barback Removed", isec.includes("credit of $") && isec.includes('send barback "Removed" in submit_event_data'));
const split = intakeBb.splitBarback(row("fw") as never, { package: "Full Bar", event_type: "Wedding", barback: "Removed" });
check("Intake: the request is taken off the final save and applied after it", split.barback === "Removed" && !("barback" in split.data));
check("Intake: a Big Day or Premium request is ignored", intakeBb.splitBarback(row("bd") as never, { package: "The Big Day Bar", barback: "Removed" }).barback === null);
const ib = await intakeBb.applyIntakeBarback("fw", "Removed");
check("Intake: applied as a priced update", !!ib && ib.rows.some((r) => r.applied) && row("fw").event_data.barback === "Removed");
check("Intake: a planner who does not hold the booking cannot change it", pp.bookingPackageSection(row("bd"), "Full Bar", [], "approval") !== "" && pp.bookingPackageSection({ ...row("fw"), event_data: { ...row("fw").event_data, barback: undefined } }, "Full Bar", [], "approval").includes("the person who holds the booking has to approve"));

// ===== Big Day Bar and Premium keep theirs =====
reset();
for (const id of ["bd", "pr"]) {
  const s = extras.barbackStatus(row(id));
  check(`${id === "bd" ? "Big Day Bar" : "Premium"}: the barback is included and cannot be removed`, s.applies && s.on && !s.removable && s.line === "Barback: included");
  const r = await editDb.saveAdminEdit({ sessionId: id, admin, changes: { barback: "Removed" }, price: { mode: "engine" }, expectedVersion: 1, origin: "https://plan.test" });
  check(`...an admin cannot remove it`, !r.ok && row(id).event_data.barback === undefined);
  check(`...the concierge says it is part of the package`, pp.bookingPackageSection(row(id), row(id).package_type, [], "update").includes("cannot be removed"));
}

// ===== 4. Every client facing description comes from the short wording =====
const P = prompt.buildIntakePrompt(null);
const U = upPrompt.buildUpdatePrompt(row("fw").event_data as never, 1, { eventDay: null, withinSixDays: false, daysUntil: null, lastDrinkChangeDay: null } as never);
check("Short wording: both prompts have HOW TO DESCRIBE EACH PACKAGE built from it", [P, U].every((t) => t.includes("HOW TO DESCRIBE EACH PACKAGE") && info.PACKAGE_GUIDES.every((g) => t.includes(`${g.name}${g.legacy ? " (legacy)" : ""}: ${pp.packageSentence(g.name)}`))));
check("Short wording: the long descriptions are for detailed questions only", P.includes("PACKAGES (details for detailed questions only"));
check("Short wording: the mention once notes are built from it", P.includes(`"Just a quick note on what is included with The Big Day Bar: two specialty cocktails for the couple, the classics, bottled water, and a dedicated barback through cocktail hour."`) && P.includes("Premium includes everything in Full Bar, plus the wooden bar, decor styled to the theme, custom cups and napkins, cocktail tables, and a dedicated barback."));
check("Short wording: this booking's package is described from it", sec.startsWith(`THIS BOOKING'S PACKAGE (Full Bar): when you describe it, use exactly this: "${pp.packageSentence("Full Bar", extras.bookingShortOf(row("fw")))}"`));
check("Short wording: the admin, staff, planner and client pages all use packageShortFor", src("app/team/package-card.tsx").includes("packageShortFor(") && src("lib/partners/event-page.ts").includes("packageShortFor(") && src("app/s/event-summary.tsx").includes("packageShortFor(data.package"));
check("Short wording: never more than five bullets", info.PACKAGE_GUIDES.every((g) => info.packageShortFor(g.name, { wedding: true, barback: "removed", cups: true })!.bullets.length <= info.MAX_PACKAGE_BULLETS));
const receiptsRules = await import("../lib/team/receipts.ts");
const iceRules = await import("../lib/team/ice-pickup.ts");
const wording = [
  ...info.PACKAGE_GUIDES.flatMap((g) => { const s = info.packageShortFor(g.name, { wedding: true, barback: "removed", cups: true })!; return [s.line, ...s.bullets, s.provides]; }),
  info.BARBACK_AT_WEDDINGS, info.BARBACK_REMOVED_LINE, info.CUPS_WITH_BOOKING, pp.BARBACK_KEEP_LINE,
  extras.barbackStatus(row("fw")).line, "Barback: removed by client", "Part of this package. It cannot be removed.", "Remove the barback", "Add the barback back",
  receiptsRules.RECEIPTS_ADMIN_PREVIEW, receiptsRules.RECEIPTS_NOT_SET_UP,
  iceRules.ICE_BACKUP_LINE, iceRules.ICE_MACHINE_NO_PICKUP, iceRules.ICE_MACHINE_BACKUP,
  "Pricing...", "Saving...", "Apply", "Cancel", "Remove the barback.", "Add the barback back.",
];
const hyph = wording.filter((w) => /[A-Za-z]-[A-Za-z]|\s-\s/.test(w));
check("No hyphens in the new wording on screen", hyph.length === 0, hyph.join(" | "));

done("package extras");
