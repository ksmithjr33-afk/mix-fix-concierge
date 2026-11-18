// The GHL booking webhook (/api/create-session) with the new fields: body
// repair and form bodies, money and tip jar parsing, the package_summary
// parser (with the sample from the spec), dedicated fields winning, the
// 10 minute duplicate guard, booked values filling only what the chatbot left
// blank, the booked city as a geocode fallback, the Booking summary card, and
// the payout tip note.
// Run: node --no-warnings scripts/test-booking-webhook.mts

import { registerHooks } from "node:module";
import { check, done, src, out } from "./team-harness.mts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers" || specifier === "next/navigation") return nextResolve(new URL("./stub-next.mts", import.meta.url).href, context);
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const { db, guards } = await import("./fake-supabase.mts");
const bw = await import("../lib/booking-webhook.ts");
const bwdb = await import("../lib/booking-webhook-db.ts");
const pc = await import("../lib/price-change.ts");
const route = await import("../app/api/create-session/route.ts");
const eu = await import("../lib/event-updates.ts");
const pay = await import("../lib/team/pay.ts");
const payout = await import("../lib/team/payout.ts");
const clockDb = await import("../lib/team/clock-db.ts");
const markets = await import("../lib/team/markets.ts");
const card = await import("../lib/booking-summary.ts");

const SAMPLE = `Full Bar, Social Gathering
18 guests · 4 hours in Prsoper, TX · 1 bartender · bar opens 6:00 PM

What we bring:
• A professional, insured bartender
• Three specialty cocktails designed for your event
• Returning client, 5% off, $41 off (RETURN5)

You provide: all alcohol

Gratuity: No tip jar. A $164 bartender gratuity is included so your team is fully taken care of.`;

const reset = () => {
  for (const k of Object.keys(db)) delete db[k];
  db.sessions = [];
  db.event_updates = [];
  guards.length = 0;
};

async function post(body: string, contentType = "application/json") {
  const res = await route.POST(new Request("http://plan.test/api/create-session", { method: "POST", headers: { host: "plan.test", "content-type": contentType }, body }) as never);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// ---------- body repair ----------

// What GHL actually sends: the summary dropped in with raw line breaks, a tab and quotes.
const quoted = SAMPLE.replace("Three specialty cocktails", 'Three "signature" cocktails') + "\tEnd";
const rawBody = `{"contact_id": "c-123", "name": "Dulari Gandhi", "email": "dulari.g@example.com", "package_summary": "${quoted}", "total_price": "$1,749"}`;
let threw = false;
try { JSON.parse(rawBody); } catch { threw = true; }
check("The raw GHL body is not valid JSON as sent", threw);
const repaired = bw.parseBookingBody(rawBody, "application/json");
check("Repair escapes raw newlines, tabs and stray quotes, then parses", repaired.ok && repaired.how === "repaired");
check("The repaired summary is exact: line breaks, quotes and the tab kept", repaired.ok && repaired.body.package_summary === quoted);
check("Fields after the summary still parse", repaired.ok && repaired.body.total_price === "$1,749" && repaired.body.contact_id === "c-123");
check("Valid JSON is read as is", (() => { const p = bw.parseBookingBody('{"name":"A"}'); return p.ok && p.how === "json"; })());
check("Already escaped newlines are left alone", (() => { const p = bw.parseBookingBody('{"a":"x\\ny"}'); return p.ok && p.body.a === "x\ny"; })());
check("repairJsonBody touches nothing outside strings", bw.repairJsonBody('{\n  "a": "b\nc",\n  "n": 1\n}') === '{\n  "a": "b\\nc",\n  "n": 1\n}');
const form = bw.parseBookingBody(new URLSearchParams({ name: "Dulari Gandhi", package_summary: SAMPLE, tip_jar: "No tip jar" }).toString(), "application/x-www-form-urlencoded");
check("Form encoded bodies are accepted with the same keys", form.ok && form.how === "form" && form.body.name === "Dulari Gandhi" && form.body.package_summary === SAMPLE);
check("A form body with no content type is still read", (() => { const p = bw.parseBookingBody("name=A&email=a%40b.com"); return p.ok && p.how === "form" && p.body.email === "a@b.com"; })());
check("Junk is refused", !bw.parseBookingBody("{not json at all").ok && !bw.parseBookingBody("").ok);

// ---------- money ----------

check("Money: $ and commas to cents", bw.parseMoneyCents("$1,749") === 174900 && bw.parseMoneyCents("$1,749.50") === 174950 && bw.parseMoneyCents(" 164 ") === 16400);
check("Money: numbers are accepted", bw.parseMoneyCents(41) === 4100 && bw.parseMoneyCents(12.5) === 1250);
check("Money: blank, whitespace and merge tags are missing", bw.parseMoneyCents("") === null && bw.parseMoneyCents("   ") === null && bw.parseMoneyCents("{{opportunity.total_price}}") === null && bw.parseMoneyCents(null) === null);
check("Money: text that is not an amount is missing", bw.parseMoneyCents("TBD") === null && bw.parseMoneyCents("$12abc") === null && bw.parseMoneyCents("1.2.3") === null);
check("Money: zero parses as zero (not a valid total later)", bw.parseMoneyCents("$0") === 0);

// ---------- tip jar ----------

const tj = pc.parseTipJar;
check("Tip jar: Yes, No, true, false", tj("Yes") === true && tj("No") === false && tj("true") === true && tj("false") === false && tj(true) === true && tj(false) === false);
check("Tip jar: phrases", tj("No tip jar") === false && tj("No tip jar.") === false && tj("no, thanks") === false && tj("Tip jar") === true && tj("Yes, tip jar please") === true && tj("Without a tip jar") === false);
check("Tip jar: blank, merge tags and unclear text are missing", tj("") === null && tj("  ") === null && tj("{{contact.tip_jar}}") === null && tj("maybe") === null && tj("not sure") === null);
check("The old exact match read \"No tip jar.\" as yes; toBool now uses the new parser", pc.toBool("No tip jar.", true) === false && pc.toBool("", true) === true && pc.toBool("maybe", false) === false);
check("Every tip jar read goes through the new parser", !src("app/api/create-session/route.ts").includes("toBool") && src("lib/manual-event-db.ts").includes("tip_jar: toBool(") && !/\/\^\(no\|false\|0\|off\|no tip jar\|none\)\$\//.test(src("lib/price-change.ts")));

// ---------- start time ----------

check("Start time: \"6:00 PM\" and friends", bw.parseStartTime("6:00 PM") === "6:00 PM" && bw.parseStartTime("6pm") === "6:00 PM" && bw.parseStartTime("6:30 p.m.") === "6:30 PM" && bw.parseStartTime("18:00") === "6:00 PM" && bw.parseStartTime("11:15am") === "11:15 AM");
check("Start time: junk and merge tags are missing", bw.parseStartTime("evening") === null && bw.parseStartTime("13:00 PM") === null && bw.parseStartTime("{{start}}") === null);
check("The saved start time is one the schedule reads", pay.scheduledMinutes({ event_date: "2026-12-12", bar_service_start: bw.parseStartTime("6:00 PM"), bar_service_end: "10:00 PM" }) === 7 * 60);

// ---------- summary parser ----------

const f = bw.parsePackageSummary(SAMPLE);
check("Summary: city and state from the second line, spelled as sent", f.city === "Prsoper" && f.state === "TX", JSON.stringify(f));
check("Summary: promo code and discount from the discount line", f.promoCode === "RETURN5" && f.discountCents === 4100);
check("Summary: tip jar and gratuity from the Gratuity line", f.tipJar === false && f.gratuityCents === 16400);
check("Summary: nothing else (no total field at all)", Object.keys(f).sort().join() === "city,discountCents,gratuityCents,promoCode,state,tipJar");
check("Summary: a city of two words", bw.parsePackageSummary("Full Bar, Wedding\n150 guests · 5 hours in Fort Worth, TX · 3 bartenders").city === "Fort Worth");
check("Summary: city only from the second line", bw.parsePackageSummary("Full Bar in Dallas, TX\nno place here").city === null);
check("Summary: a tip jar line", bw.parsePackageSummary("A\nB\nGratuity: Tip jar welcome. A $80 gratuity is included.").tipJar === true);
check("Summary: blank or a merge tag gives nothing", bw.parsePackageSummary("").city === null && bw.parsePackageSummary("{{opportunity.package_summary}}").promoCode === null);

// ---------- reading a booking ----------

const base = { contact_id: "c-123", name: "Dulari Gandhi", email: "dulari.g@example.com", phone: "(214) 555-0101", event_date: "April 11", start_time: "6:00 PM", package_type: "Full Bar", guest_count: "18", event_name: "Social Gathering", event_type: "Social Gathering", hours_booked: "4", bartender_count: "1", tip_jar: "", promo_code: "", total_price: "$1,749", gratuity: "", tip_per_bartender: "$164", package_summary: SAMPLE };
const b = bw.readBooking(base);
check("event_name that repeats event_type is ignored", b.eventType === "Social Gathering" && b.eventName === null);
check("A real event name is kept", bw.readBooking({ ...base, event_name: "Dulari's 30th" }).eventName === "Dulari's 30th");
check("Phone normalized like staff phones", b.phone === "+12145550101");
check("Blank promo code and tip jar fall back to the summary", b.promoCode === "RETURN5" && b.tipJar === false && b.gratuityCents === 16400 && b.discountCents === 4100);
check("Dedicated fields win over the summary", (() => { const x = bw.readBooking({ ...base, promo_code: "spring10", tip_jar: "Yes", gratuity: "$200" }); return x.promoCode === "SPRING10" && x.tipJar === true && x.gratuityCents === 20000; })());
check("The total is never read from the summary", bw.readBooking({ ...base, total_price: "" }).totalCents === null);
check("total_price wins over the older total; total alone still works", bw.readBooking({ ...base, total: "$999" }).totalCents === 174900 && bw.readBooking({ ...base, total_price: "", total: "$999" }).totalCents === 99900);
check("Merge tags are missing everywhere", (() => { const x = bw.readBooking({ ...base, phone: "{{contact.phone}}", event_type: "{{opportunity.event_type}}", bartender_count: "{{x}}" }); return x.phone === null && x.eventType === null && x.bartenderCount === null; })());
check("Bartender count is a whole number above zero", bw.readBooking({ ...base, bartender_count: "2" }).bartenderCount === 2 && bw.readBooking({ ...base, bartender_count: "0" }).bartenderCount === null);

// ---------- the route ----------

reset();
const r1 = await post(rawBody.replace('"total_price": "$1,749"', `"total_price": "$1,749", "phone": "214.555.0101", "start_time": "6:00 PM", "event_type": "Social Gathering", "event_name": "Social Gathering", "bartender_count": "1", "tip_jar": "", "promo_code": "", "gratuity": "", "tip_per_bartender": "$164"`));
const s1 = db.sessions[0] as Record<string, unknown> & { booked_price: Record<string, unknown> };
check("A repaired body creates the session", r1.status === 200 && db.sessions.length === 1 && s1.id === r1.json.id && String(r1.json.url).endsWith(`/s?id=${s1.id}`));
check("Saved: contact ID, phone, event type, start time, bartenders", s1.ghl_contact_id === "c-123" && s1.phone === "+12145550101" && s1.event_type === "Social Gathering" && s1.event_name === null && s1.bar_service_start === "6:00 PM" && s1.bartender_count === 1);
check("Saved: the raw summary exactly", s1.package_summary === quoted);
check("Saved: tip jar and promo from the summary, city and state", s1.tip_jar === false && s1.promo_code === "RETURN5" && s1.event_city === "Prsoper" && s1.event_state === "TX");
check("Booked price in dollars: total, gratuity, discount, tip per bartender", s1.booked_price.total === 1749 && s1.booked_price.gratuity === 164 && s1.booked_price.discount_amount === 41 && s1.booked_price.tip_per_bartender === 164 && s1.booked_price.bartenders === 1 && s1.booked_price.promo_code === "RETURN5" && s1.booked_price.tip_jar === false);
check("Deposit as today: the default when none is sent", s1.booked_price.deposit_paid === pc.DEFAULT_DEPOSIT);
check("A valid total turns price pending off", s1.price_pending === false);

reset();
await post(JSON.stringify({ ...base, total_price: "$0" }));
check("A zero total is not a booked total, and price pending is not touched", (db.sessions[0].booked_price as Record<string, unknown>).total === null && !("price_pending" in db.sessions[0]));

reset();
await post(JSON.stringify({ name: "A B", email: "ab@example.com", total: "$1,200" }));
check("The older total key still sets the booked total", (db.sessions[0].booked_price as Record<string, unknown>).total === 1200 && db.sessions[0].price_pending === false);

reset();
await post(new URLSearchParams({ name: "Form Client", email: "f@example.com", total_price: "$900", package_summary: SAMPLE }).toString(), "application/x-www-form-urlencoded");
check("A form body creates the session", db.sessions.length === 1 && db.sessions[0].package_summary === SAMPLE && (db.sessions[0].booked_price as Record<string, unknown>).total === 900);

reset();
const errs: unknown[][] = [];
const prevErr = console.error;
console.error = (...a: unknown[]) => { errs.push(a); };
const bad = await post("{this is \"not\" json, nor=form");
console.error = prevErr;
check("A body that cannot be read is refused with 400", bad.status === 400 && db.sessions.length === 0);
check("The raw body is logged on a parse failure", errs.some((a) => a.includes("{this is \"not\" json, nor=form")));

reset();
check("Still needs a name or email", (await post(JSON.stringify({ name: "  ", email: "{{contact.email}}" }))).status === 400);

// ---------- duplicates ----------

reset();
const payload = JSON.stringify(base);
const d1 = await post(payload);
const d2 = await post(payload);
check("An identical payload within 10 minutes returns the same session and inserts nothing", d1.json.id === d2.json.id && d2.json.duplicate === true && db.sessions.length === 1);
db.sessions[0].created_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
const d3 = await post(payload);
check("After 10 minutes the same payload is a new booking", d3.json.id !== d1.json.id && db.sessions.length === 2);

// A repeat client: one contact ID, many events. Never matched by contact alone.
reset();
const e1 = await post(JSON.stringify({ ...base, event_date: "April 11" }));
const e2 = await post(JSON.stringify({ ...base, event_date: "June 6" }));
const e3 = await post(JSON.stringify({ ...base, event_date: "April 11", guest_count: "20" }));
check("Same contact ID, a different booking: a new event every time", new Set([e1.json.id, e2.json.id, e3.json.id]).size === 3 && db.sessions.length === 3 && db.sessions.every((s) => s.ghl_contact_id === "c-123"));
const guardSrc = src("lib/booking-webhook-db.ts");
const lookup = guardSrc.slice(guardSrc.indexOf("export async function recentDuplicate"), guardSrc.indexOf("export function bookedPriceFrom"));
check("The only lookup is by payload hash in the window, never contact, email or date", /\.eq\("booking_payload_hash", hash\)/.test(lookup) && /\.gte\("created_at", since\)/.test(lookup) && (lookup.match(/\.eq\(/g) ?? []).length === 1 && !/ghl_contact_id|email|event_date/.test(lookup));
check("The route never updates a session", !/from\("sessions"\)\s*\.(update|upsert)\(|upsert/.test(src("app/api/create-session/route.ts") + guardSrc) && (guardSrc.match(/from\("sessions"\)/g) ?? []).length === 3);
check("The hash covers every key and value", bwdb.payloadHash({ a: "1", b: "2" }) === bwdb.payloadHash({ b: "2", a: "1" }) && bwdb.payloadHash({ a: "1" }) !== bwdb.payloadHash({ a: "1", c: "" }));

// ---------- before the migration runs ----------

reset();
guards.push((table, op, rows) => (table === "sessions" && op === "insert" && rows.some((r) => "ghl_contact_id" in r) ? "Could not find the 'ghl_contact_id' column of 'sessions' in the schema cache" : null));
const legacy = await post(JSON.stringify(base));
check("Without the new columns the booking is still saved", legacy.status === 200 && db.sessions.length === 1 && db.sessions[0].name === "Dulari Gandhi" && (db.sessions[0].booked_price as Record<string, unknown>).total === 1749);
check("...with the type in event_name as before", db.sessions[0].event_name === "Social Gathering");

// ---------- booked values at submission ----------

async function submit(session: Record<string, unknown>, ed: Record<string, unknown>) {
  reset();
  db.sessions.push({ id: "s1", status: "in_progress", version: 0, event_data: null, hours_booked: "4", ...session });
  await eu.recordSubmission("s1", ed as never);
  return db.sessions[0].event_data as Record<string, unknown>;
}
const booked = { bar_service_start: "6:00 PM", bartender_count: 2, event_type: "Social Gathering", phone: "+12145550101" };
const filled = await submit(booked, { client_name: "Dulari Gandhi", event_date: "2026-04-11", bar_service_end: "10:00 PM" });
check("Booked start, bartenders, type and phone fill what the chatbot left blank", filled.bar_service_start === "6:00 PM" && filled.bartenders === 2 && filled.event_type === "Social Gathering" && filled.client_phone === "+12145550101");
check("So the schedule and pay estimate use the booked start", pay.scheduledMinutes(filled) === 7 * 60);
const won = await submit(booked, { client_name: "Dulari Gandhi", event_date: "2026-04-11", bar_service_start: "7:00 PM", bar_service_end: "11:00 PM", bartenders: 1, event_type: "Birthday", client_phone: "+19725550199" });
check("The chatbot's answers win", won.bar_service_start === "7:00 PM" && won.bartenders === 1 && won.event_type === "Birthday" && won.client_phone === "+19725550199");
check("A session without booking columns is unchanged", Object.keys(bw.bookingFill({ a: 1 }, {})).length === 0);
reset();
db.sessions.push({ id: "s2", status: "submitted", version: 3, event_data: { bar_service_start: "8:00 PM" }, bar_service_start: "6:00 PM" });
await eu.recordSubmission("s2", { bar_service_start: "" } as never);
check("A submitted event (where admin edits live) is never rewritten", (db.sessions[0].event_data as Record<string, unknown>).bar_service_start === "8:00 PM" && db.sessions[0].version === 3);

// ---------- city fallback ----------

reset();
const cityOnly = { id: "g1", status: "submitted", version: 1, event_data: { event_address: "" }, event_city: "Dallas", event_state: "TX" };
db.sessions.push(cityOnly);
const loc = await clockDb.eventLocation(cityOnly as never, { cityFallback: true });
check("No address: the booked city is geocoded for mileage and market", loc !== null && Math.abs(loc.lat - 32.7767) < 0.01 && db.sessions[0].geo_address === "Dallas, TX");
check("Clock in distance never uses the city", (await clockDb.eventLocation({ ...cityOnly, geo_address: null } as never)) === null);
reset();
const typo = { id: "g2", status: "submitted", version: 1, event_data: {}, event_city: "Prsoper", event_state: "TX" };
db.sessions.push(typo);
check("A city that does not geocode: nothing saved, no guess", (await clockDb.eventLocation(typo as never, { cityFallback: true })) === null && db.sessions[0].geo_address === undefined && db.sessions[0].geo_lat === undefined);
check("An address always beats the city", markets.marketAddress({ event_data: { event_address: "1 Main St, Austin, TX" }, event_city: "Dallas" } as never) === "1 Main St, Austin, TX" && markets.marketAddress({ event_data: {}, event_city: "Dallas", event_state: "TX" } as never) === "Dallas, TX");

// ---------- Booking summary card ----------

const summary = card.bookingSummary({ package_summary: SAMPLE, bar_service_start: "6:00 PM", bartender_count: 1, promo_code: "RETURN5", booked_price: { tip_per_bartender: 164 } });
check("The card has the raw summary and the booked start", summary !== null && summary.text === SAMPLE && summary.bookedStart === "6:00 PM" && summary.tipPerBartender === 164);
check("No booking data, no card", card.bookingSummary({}) === null);
const page = src("app/team/admin/e/[id]/page.tsx");
check("The card renders for admins and managers only", page.includes("{isAdminRole(me.role) && bookingSummary(session) && <BookingSummaryCard"));
check("The card keeps line breaks and is titled Booking summary", src("app/team/admin/e/[id]/booking-summary-card.tsx").includes("whitespace-pre-wrap") && src("app/team/admin/e/[id]/booking-summary-card.tsx").includes(">Booking summary</h2>"));
check("Staff pages never read the summary", !src("app/team/e/[id]/page.tsx").includes("package_summary") && !src("lib/team/event-view.ts").includes("package_summary"));
check("The admin title format is untouched", src("lib/team/event-list.ts").includes('const base = [titleName(ed), scrub(ed.event_type)].filter(Boolean).join(" · ");') && src("lib/team/event-list.ts").includes("return host || scrub(ed.client_name);"));

// ---------- payout tip note ----------

check("Tip note: booked $164, split $164: no note", payout.tipMismatchNote(164, 16400) === null && payout.tipMismatchNote(164, 16450) === null);
check("Tip note: more than a dollar apart", payout.tipMismatchNote(164, 8200) === "Booked tip per bartender is $164.00, but the gratuity split is $82.00 each.");
check("Tip note: missing either side, no note", payout.tipMismatchNote(null, 8200) === null && payout.tipMismatchNote(164, null) === null);
check("Tips are still the gratuity split evenly", (() => { const t = pay.tipsShare(164, 2, true); return t.state === "on_file" && t.cents === 8200; })());
check("Both payout cards pass the note", src("app/team/admin/e/[id]/page.tsx").includes("tipNote={payout.tipNote}") && src("app/team/admin/timesheets/page.tsx").includes("tipNote={payout.tipNote}"));

void out;
done("booking webhook");
