// Driving miles from the Google Routes API: called once when a person is put
// on an event, straight line fallback, recalculate, and the one time upgrade.
// The Routes call is stubbed. Run: node --no-warnings scripts/test-driving-miles.mts

import { addDays, check, done, event, src } from "./team-harness.mts";

const { db } = await import("./fake-supabase.mts");
const time = await import("../lib/team/time.ts");
const pay = await import("../lib/team/pay.ts");
const payDb = await import("../lib/team/pay-db.ts");
const routes = await import("../lib/team/routes.ts");
const profileDb = await import("../lib/team/profile-db.ts");
const asgDb = await import("../lib/team/assignments-db.ts");
const geocode = await import("../lib/team/geocode.ts");
const clockDb = await import("../lib/team/clock-db.ts");

// ----- The Routes stub, layered over the harness fetch -----
type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };
const calls: Call[] = [];
let reply: () => Response | Promise<Response> = () => new Response(JSON.stringify({ routes: [{ distanceMeters: 0 }] }), { status: 200 });
const meters = (miles: number) => () => new Response(JSON.stringify({ routes: [{ distanceMeters: Math.round(miles * 1609.344) }] }), { status: 200 });
const googleGeo: string[] = [];
const osm: string[] = [];
const GOOGLE_PLACES: Record<string, { lat: number; lng: number }> = { "77 Hidden Ranch Rd": { lat: 33.1, lng: -96.6 }, Dallas: { lat: 32.78, lng: -96.8 } };
const googleFinds = (address: string) => {
  const hit = Object.entries(GOOGLE_PLACES).find(([name]) => address.includes(name));
  return new Response(JSON.stringify(hit ? { status: "OK", results: [{ geometry: { location: hit[1] } }] } : { status: "ZERO_RESULTS", results: [] }), { status: 200 });
};
let geoReply: (address: string) => Response | Promise<Response> = googleFinds;
const harnessFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("maps.googleapis.com/maps/api/geocode")) {
    googleGeo.push(url);
    return geoReply(decodeURIComponent(new URL(url).searchParams.get("address") ?? ""));
  }
  if (url.includes("nominatim.openstreetmap.org")) osm.push(url);
  if (url.includes("routes.googleapis.com") || url.includes("distancematrix") || url.includes("maps/api/directions")) {
    calls.push({ url, method: String(init?.method ?? "GET"), headers: { ...(init?.headers as Record<string, string>) }, body: JSON.parse(String(init?.body ?? "{}")) });
    return reply();
  }
  return harnessFetch(input, init);
}) as typeof fetch;
const KEY = "test-key";
const withKey = () => (process.env.GOOGLE_MAPS_API_KEY = KEY);
const noKey = () => delete process.env.GOOGLE_MAPS_API_KEY;

const A = { lat: 32.7767, lng: -96.797 };
const B = { lat: 33.5, lng: -96.797 };

// ----- 1. The call itself -----
noKey();
calls.length = 0;
check("No key: no call, null", (await routes.drivingMiles(A, B)) === null && calls.length === 0);
withKey();
reply = meters(57.3);
const m = await routes.drivingMiles(A, B);
const c = calls[0];
check("One call, to computeRoutes, by POST", calls.length === 1 && c.url === "https://routes.googleapis.com/directions/v2:computeRoutes" && c.method === "POST", JSON.stringify(c));
check("Field mask asks only for routes.distanceMeters", c.headers["X-Goog-FieldMask"] === "routes.distanceMeters");
check("Key in the header, not the URL", c.headers["X-Goog-Api-Key"] === KEY && !c.url.includes(KEY));
check("Origin and destination by coordinates, driving", JSON.stringify(c.body.origin) === JSON.stringify({ location: { latLng: { latitude: A.lat, longitude: A.lng } } }) && JSON.stringify(c.body.destination) === JSON.stringify({ location: { latLng: { latitude: B.lat, longitude: B.lng } } }) && c.body.travelMode === "DRIVE");
check("Meters to one way miles, to a tenth", m === 57.3, String(m));
reply = () => new Response('{"error":{"code":403}}', { status: 403 });
check("An error status: null", (await routes.drivingMiles(A, B)) === null);
reply = () => new Response("{}", { status: 200 });
check("No route: null", (await routes.drivingMiles(A, B)) === null);
reply = () => new Response(JSON.stringify({ routes: [{}] }), { status: 200 });
check("Zero meters is left out of the response: 0 miles", (await routes.drivingMiles(A, B)) === 0);
reply = () => Promise.reject(new Error("network down"));
check("A network failure: null, never throws", (await routes.drivingMiles(A, B)) === null);

// ----- Setup -----
const today = time.todayIn("America/Chicago");
const admin = { id: "a1", name: "Kenneth Smith", phone: "+12145550100", role: "admin" as const, active: true };
const mgr = { id: "m1", name: "Pat Manager", phone: "+12145550101", role: "manager" as const, active: true };
const b1 = { id: "b1", name: "Jordan Lee", phone: "+12145550111", role: "bartender" as const, active: true };
const b2 = { id: "b2", name: "Sam Diaz", phone: "+12145550112", role: "bartender" as const, active: true };
const b3 = { id: "b3", name: "Riley Fox", phone: "+12145550113", role: "bartender" as const, active: true };
const EVENT = { lat: 32.7767, lng: -96.797 };
const north = (miles: number) => ({ lat: EVENT.lat + miles / 69.0933, lng: EVENT.lng });
const ADDR = "1 Elm St, Dallas, TX";
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  const geo = { geo_address: ADDR, geo_lat: EVENT.lat, geo_lng: EVENT.lng, team_market: "dallas" };
  db.sessions = [
    event("f1", addDays(today, 5), ADDR, {}, { ...geo, booked_price: { total: 1800, gratuity: 300, bartenders: 2 } }),
    event("f2", addDays(today, 9), ADDR, {}, geo),
    event("past", addDays(today, -3), ADDR, {}, geo),
  ];
  db.staff = [admin, mgr, b1, b2, b3].map((s) => ({ ...s, markets: ["dallas"] }));
  db.staff_pay_rates = [];
  db.staff_profiles = [
    { staff_id: "b1", home_address: "50 miles north", home_lat: north(50).lat, home_lng: north(50).lng },
    { staff_id: "b2", home_address: "30 miles north", home_lat: north(30).lat, home_lng: north(30).lng },
    { staff_id: "b3", home_address: "Nowhere" },
  ];
  db.event_assignments = [
    { id: "x1", session_id: "f1", staff_id: "b1", status: "offered" },
    { id: "x2", session_id: "f1", staff_id: "b2", status: "accepted" },
    { id: "x3", session_id: "f2", staff_id: "b1", status: "accepted" },
    { id: "x4", session_id: "past", staff_id: "b1", status: "accepted" },
    { id: "x5", session_id: "f2", staff_id: "b2", status: "accepted" },
    { id: "x6", session_id: "f2", staff_id: "b3", status: "offered" },
  ];
  db.team_settings = [];
  db.assignment_mileage = [];
  db.shift_posts = [{ id: "post1", session_id: "f2", market: "dallas", kind: "open", status: "posted" }];
}
reset();
const s = (id: string) => db.sessions.find((x) => x.id === id) as never;
const row = (id: string) => db.assignment_mileage.find((r) => r.assignment_id === id);

// ----- 2. Page views never call it -----
withKey();
reply = meters(62);
calls.length = 0;
const offer = await payDb.myPayEstimate("b1", s("f1"));
await payDb.myPayEstimateForPost("b3", "post1");
await payDb.crewEstimates(mgr as never, s("f1"));
await profileDb.distancesToEvent(s("f1"), ["b1", "b2"]);
check("Estimates, open shifts, the payout sheet and the assign panel make no Routes call", calls.length === 0, `${calls.length} calls`);
check("Before accepting: straight line, labeled approximate", offer.mileage.state === "paid" && offer.mileage.source === "straight_line" && !offer.mileage.locked && pay.mileageText(offer.mileage).includes("straight line, approximate"), offer.mileage.state === "paid" ? pay.mileageText(offer.mileage) : offer.mileage.state);

// ----- 3. Accepting stores driving miles, one call -----
calls.length = 0;
await asgDb.respondToAssignment("f1", b1 as never, "accept", "https://plan.test");
check("Accepting makes exactly one Routes call", calls.length === 1, `${calls.length} calls`);
check("Home to event coordinates", JSON.stringify(calls[0]?.body.origin) === JSON.stringify({ location: { latLng: { latitude: north(50).lat, longitude: north(50).lng } } }) && JSON.stringify(calls[0]?.body.destination) === JSON.stringify({ location: { latLng: { latitude: EVENT.lat, longitude: EVENT.lng } } }));
check("Stores one way driving miles, source driving", row("x1")?.one_way_miles === 62 && row("x1")?.miles_source === "driving" && !!row("x1")?.locked_at, JSON.stringify(row("x1")));
calls.length = 0;
const accepted = await payDb.myPayEstimate("b1", s("f1"));
check("Once accepted, the estimate reads stored driving miles with no call", calls.length === 0 && accepted.mileage.state === "paid" && accepted.mileage.oneWayMiles === 62 && accepted.mileage.paidMiles === 104 && pay.mileageText(accepted.mileage).includes("62 one way, driving") && !pay.mileageText(accepted.mileage).includes("approximate"));
await payDb.lockMileage("f1", "b1");
check("Locking again makes no call and keeps the first number", calls.length === 0 && row("x1")?.one_way_miles === 62);

// Fallbacks.
reset();
withKey();
reply = () => new Response("{}", { status: 500 });
await asgDb.respondToAssignment("f1", b1 as never, "accept", "https://plan.test");
check("A failed call falls back to straight line, and says so", row("x1")?.one_way_miles === 50 && row("x1")?.miles_source === "straight_line" && pay.MILES_SOURCE_LABEL.straight_line === "straight line", JSON.stringify(row("x1")));
const fb = await payDb.myPayEstimate("b1", s("f1"));
check("Stored straight line is labeled straight line, not approximate", fb.mileage.state === "paid" && fb.mileage.locked && pay.mileageText(fb.mileage).includes("50 one way, straight line") && !pay.mileageText(fb.mileage).includes("approximate"));
reset();
noKey();
calls.length = 0;
await asgDb.respondToAssignment("f1", b1 as never, "accept", "https://plan.test");
check("No key: no call, straight line stored", calls.length === 0 && row("x1")?.miles_source === "straight_line" && row("x1")?.one_way_miles === 50);
reset();
withKey();
calls.length = 0;
await asgDb.respondToAssignment("f2", b3 as never, "accept", "https://plan.test");
check("Home not on the map: no call, stored as not found", calls.length === 0 && row("x6")?.miles_reason === "not_found" && row("x6")?.one_way_miles === null);

// ----- 4. Recalculate miles, one person -----
reset();
withKey();
db.assignment_mileage = [
  { assignment_id: "x2", session_id: "f1", staff_id: "b2", one_way_miles: 30, miles_reason: null, miles_source: "straight_line", locked_at: "2026-11-01T00:00:00Z", override_miles: null, override_cents: 900, override_note: "Flat", override_by: "a1", override_by_name: "Kenneth Smith", override_at: "2026-11-02T00:00:00Z" },
];
reply = meters(41.2);
calls.length = 0;
check("A bartender cannot recalculate", !(await payDb.recalculateMileage(b2 as never, "f1", "b2")).ok && calls.length === 0);
check("Only people on the event", (await payDb.recalculateMileage(admin as never, "f1", "b3")).ok === false);
const rc = await payDb.recalculateMileage(mgr as never, "f1", "b2");
check("A manager recalculates: one call, driving stored", rc.ok && rc.miles === 41.2 && rc.source === "driving" && rc.changed && calls.length === 1 && row("x2")?.one_way_miles === 41.2 && row("x2")?.miles_source === "driving", JSON.stringify(rc));
check("Recalculating keeps the adjustment and the original lock time", row("x2")?.override_cents === 900 && row("x2")?.override_note === "Flat" && row("x2")?.locked_at === "2026-11-01T00:00:00Z");
reply = () => new Response("{}", { status: 500 });
const fail = await payDb.recalculateMileage(admin as never, "f1", "b2");
check("A failed call never replaces driving miles with straight line", !fail.ok && row("x2")?.one_way_miles === 41.2 && row("x2")?.miles_source === "driving");
check("Recalculating with no stored row stores one", (await payDb.recalculateMileage(admin as never, "f2", "b1")).ok && row("x3")?.miles_source === "straight_line" && !!row("x3")?.locked_at);

// ----- 5. The one time upgrade -----
reset();
withKey();
db.assignment_mileage = [
  { assignment_id: "x2", session_id: "f1", staff_id: "b2", one_way_miles: 30, miles_reason: null, miles_source: "straight_line", locked_at: "2026-11-01T00:00:00Z", override_miles: 25, override_cents: null, override_note: "Short cut", override_by: "a1", override_by_name: "Kenneth Smith", override_at: "2026-11-02T00:00:00Z" },
  { assignment_id: "x3", session_id: "f2", staff_id: "b1", one_way_miles: 61, miles_reason: null, miles_source: "driving", locked_at: "2026-11-01T00:00:00Z" },
  { assignment_id: "x4", session_id: "past", staff_id: "b1", one_way_miles: 50, miles_reason: null, miles_source: "straight_line", locked_at: "2026-11-01T00:00:00Z" },
];
const before = JSON.stringify(db.assignment_mileage);
reply = meters(36.4);
calls.length = 0;
const dry = await payDb.upgradeToDriving({ fromDay: today, apply: false });
check("Dry run: no calls, nothing written", calls.length === 0 && JSON.stringify(db.assignment_mileage) === before);
check("Lists straight line and never stored rows on upcoming events only", JSON.stringify(dry.map((l) => l.assignmentId).sort()) === JSON.stringify(["x2", "x5"]), JSON.stringify(dry.map((l) => l.assignmentId)));
check("Skips rows already driving, past events, and offers", !dry.some((l) => ["x3", "x4", "x1", "x6"].includes(l.assignmentId)));
const applied = await payDb.upgradeToDriving({ fromDay: today, apply: true });
check("Apply: one call each", calls.length === 2, `${calls.length} calls`);
check("Apply stores driving miles", row("x2")?.miles_source === "driving" && row("x2")?.one_way_miles === 36.4 && row("x5")?.miles_source === "driving" && applied.every((l) => l.note === "upgraded"));
check("Apply keeps adjustments", row("x2")?.override_miles === 25 && row("x2")?.override_note === "Short cut");
check("Past events are left alone", row("x4")?.miles_source === "straight_line" && row("x4")?.one_way_miles === 50);
calls.length = 0;
check("Running again finds nothing to do", (await payDb.upgradeToDriving({ fromDay: today, apply: true })).length === 0 && calls.length === 0);

// ----- 6. Source checks -----
const everything = ["lib/team/routes.ts", "lib/team/pay-db.ts", "lib/team/profile-db.ts", "lib/team/geocode.ts", "lib/team/clock-db.ts"].map(src).join("\n");
check("No legacy Distance Matrix or Directions API", !/distancematrix|maps\/api\/directions/i.test(everything));
check("Only the pay module calls the Routes API", src("lib/team/pay-db.ts").includes('from "@/lib/team/routes"') && !/team\/routes"/.test(src("lib/team/profile-db.ts") + src("lib/team/assignments-db.ts") + src("lib/team/shifts-db.ts") + src("lib/team/payout-db.ts")));
check("drivingMiles is called in one place (storing miles)", (src("lib/team/pay-db.ts").match(/drivingMiles\(/g) ?? []).length === 1);
check("Recalculate route is admins and managers", src("app/api/team/admin/mileage/recalculate/route.ts").includes("!isAdminRole(staff.role)"));
check("Payout card has Recalculate miles", src("app/team/admin/payout-card.tsx").includes("Recalculate miles") && src("app/team/admin/payout-card.tsx").includes("/api/team/admin/mileage/recalculate"));
check("The upgrade script is a dry run unless --apply", src("scripts/upgrade-driving-miles.mts").includes('process.argv.includes("--apply")'));

// ----- 7. Geocoding: Google first, OpenStreetMap when Google fails -----
const geoCounts = () => `${googleGeo.length} google, ${osm.length} osm`;
const clearGeo = () => {
  googleGeo.length = 0;
  osm.length = 0;
};
noKey();
clearGeo();
let g = await geocode.geocodeAddress("500 Congress Ave, Austin, TX");
check("No key: OpenStreetMap, recorded as openstreetmap", g.source === "openstreetmap" && !!g.location && googleGeo.length === 0 && osm.length === 1, geoCounts());
withKey();
geoReply = googleFinds;
clearGeo();
g = await geocode.geocodeAddress("1 Elm St, Dallas, TX");
check("Key: Google finds it, recorded as google, no OpenStreetMap call", g.source === "google" && g.location?.lat === 32.78 && googleGeo.length === 1 && osm.length === 0, geoCounts());
const failures: [string, (a: string) => Response | Promise<Response>][] = [
  ["REQUEST_DENIED (API not enabled on the key)", () => new Response(JSON.stringify({ status: "REQUEST_DENIED", error_message: "not authorized", results: [] }), { status: 200 })],
  ["an error status", () => new Response("oops", { status: 500 })],
  ["no result", () => new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 })],
  ["a network failure", () => Promise.reject(new Error("down"))],
];
for (const [label, fn] of failures) {
  geoReply = fn;
  clearGeo();
  g = await geocode.geocodeAddress("500 Congress Ave, Austin, TX");
  check(`Google ${label}: falls back to OpenStreetMap, recorded as openstreetmap`, g.source === "openstreetmap" && Math.abs(g.location!.lat - 30.2672) < 0.001 && googleGeo.length === 1 && osm.length === 1, `${g.source} ${geoCounts()}`);
}
geoReply = googleFinds;
g = await geocode.geocodeAddress("Somewhere Nobody Knows 99999");
check("Neither finds it: null, recorded as none", g.location === null && g.source === "none");
clearGeo();
g = await geocode.geocodeAddress("Somewhere Nobody Knows 99999", { googleOnly: true });
check("Google only: no OpenStreetMap call", g.source === "none" && googleGeo.length === 1 && osm.length === 0);
check("Blank address: no calls, none", (await geocode.geocodeAddress("  ")).source === "none");

// The event records which service found it.
reset();
geoReply = () => new Response(JSON.stringify({ status: "REQUEST_DENIED", results: [] }), { status: 200 });
const moved = db.sessions.find((x) => x.id === "f2")!;
moved.event_data = { ...(moved.event_data as object), event_address: "500 Congress Ave, Austin, TX" };
const loc = await clockDb.eventLocation(moved as never);
check("Event address found by the fallback records geo_source openstreetmap", !!loc && moved.geo_source === "openstreetmap" && Math.abs(Number(moved.geo_lat) - 30.2672) < 0.001, String(moved.geo_source));

// The home address records which service found it.
geoReply = googleFinds;
const home = () => db.staff_profiles.find((r) => r.staff_id === "b3") as Record<string, unknown>;
await profileDb.saveProfile(b3 as never, "b3", { home_address: "1 Elm St, Dallas, TX" });
check("Saving a home found by Google records home_geo_source google", home().home_geo_source === "google" && home().home_lat === 32.78, JSON.stringify(home()));
geoReply = () => new Response("oops", { status: 500 });
await profileDb.saveProfile(b3 as never, "b3", { home_address: "500 Congress Ave, Austin, TX" });
check("Saving a home found by the fallback records openstreetmap", home().home_geo_source === "openstreetmap" && Math.abs(Number(home().home_lat) - 30.2672) < 0.001);
await profileDb.saveProfile(b3 as never, "b3", { home_address: "Somewhere Nobody Knows 99999" });
check("A home neither finds saves with no location, recorded as none", home().home_geo_source === "none" && home().home_lat === null && home().home_address === "Somewhere Nobody Knows 99999");
await profileDb.saveProfile(b3 as never, "b3", { home_address: "" });
check("Clearing the home address clears the source", home().home_geo_source === null && home().home_lat === null);

// ----- 8. One time: look up again homes never found on the map -----
reset();
withKey();
geoReply = googleFinds;
db.staff_profiles = [
  { staff_id: "b1", home_address: "50 miles north", home_lat: north(50).lat, home_lng: north(50).lng },
  { staff_id: "b2", home_address: "77 Hidden Ranch Rd, Celina, TX", home_lat: null, home_lng: null },
  { staff_id: "b3", home_address: "Somewhere Nobody Knows 99999", home_lat: null, home_lng: null },
  { staff_id: "m1", home_address: null, home_lat: null, home_lng: null },
];
const homesBefore = JSON.stringify(db.staff_profiles);
clearGeo();
const dryHomes = await profileDb.relookupHomes({ apply: false });
check("Dry run: no lookups, nothing written", googleGeo.length === 0 && osm.length === 0 && JSON.stringify(db.staff_profiles) === homesBefore);
check("Lists only addresses on file with no map location", JSON.stringify(dryHomes.map((l) => l.staffId)) === JSON.stringify(["b2", "b3"]) && dryHomes.every((l) => l.found === null));
const applyHomes = await profileDb.relookupHomes({ apply: true, now: new Date("2026-11-17T12:00:00Z") });
const prof = (id: string) => db.staff_profiles.find((r) => r.staff_id === id) as Record<string, unknown>;
check("Apply: Google only, one lookup each, no OpenStreetMap", googleGeo.length === 2 && osm.length === 0, geoCounts());
check("Found: location and source google saved", prof("b2").home_lat === 33.1 && prof("b2").home_lng === -96.6 && prof("b2").home_geo_source === "google" && prof("b2").home_geocoded_at === "2026-11-17T12:00:00.000Z");
check("Still not found: no location, marked none, address unchanged", prof("b3").home_lat === null && prof("b3").home_geo_source === "none" && prof("b3").home_address === "Somewhere Nobody Knows 99999");
check("Homes already on the map are left alone", prof("b1").home_lat === north(50).lat && prof("b1").home_geo_source === undefined);
check("The report says which were found", applyHomes.find((l) => l.staffId === "b2")?.found === true && applyHomes.find((l) => l.staffId === "b3")?.found === false);
check("A newly found home on an upcoming event is picked up by the driving upgrade", (await payDb.upgradeToDriving({ fromDay: today, apply: false })).some((l) => l.staffId === "b2"));
check("The home script is a dry run unless --apply, and Google only", src("scripts/relookup-homes.mts").includes('process.argv.includes("--apply")') && src("lib/team/profile-db.ts").includes("googleOnly: true"));
check("The migration adds home_geo_source", src("supabase/migrations/20261214_home_geo_source.sql").includes("add column if not exists home_geo_source"));

noKey();
done("driving miles");
