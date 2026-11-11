// Shared setup for the team portal test scripts: "@/lib/supabase" resolves to
// the in-memory database, fetch is stubbed (staff texts, GHL webhooks, and
// geocoding are captured instead of sent), and console noise is muted.
// Import this first, then import the code under test with dynamic import().

import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase") return nextResolve(new URL("./fake-supabase.mts", import.meta.url).href, context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

process.env.GHL_STAFF_SMS_WEBHOOK = "https://hooks.test/staff-sms";
process.env.TEAM_BASE_URL = "https://plan.test";
process.env.TEAM_GEOCODE_GAP_MS = "0";
delete process.env.GOOGLE_MAPS_API_KEY;

export const PLACES: Record<string, { lat: number; lng: number }> = {
  Dallas: { lat: 32.7767, lng: -96.797 },
  Austin: { lat: 30.2672, lng: -97.7431 },
  Houston: { lat: 29.7604, lng: -95.3698 },
  "Santa Monica": { lat: 34.0195, lng: -118.4912 },
  "Oklahoma City": { lat: 35.4676, lng: -97.5164 },
};

export const texts: { phone: string; message: string }[] = [];
export const hooks: { url: string; body: Record<string, unknown> }[] = [];

globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("nominatim.openstreetmap.org")) {
    const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
    const hit = Object.entries(PLACES).find(([name]) => q.includes(name));
    return new Response(JSON.stringify(hit ? [{ lat: String(hit[1].lat), lon: String(hit[1].lng) }] : []), { status: 200 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(String(init?.body ?? "{}"));
  } catch {
    /* not JSON */
  }
  if (url === process.env.GHL_STAFF_SMS_WEBHOOK) texts.push({ phone: String(body.phone), message: String(body.message) });
  else hooks.push({ url, body });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

export const out = console.log;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

let failed = 0;
let total = 0;
export function check(label: string, ok: boolean, detail = "") {
  total++;
  if (!ok) failed++;
  out(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
}

export function done(name: string) {
  console.log = out;
  if (failed > 0) {
    console.error(`\n${failed} of ${total} ${name} checks failed.`);
    process.exit(1);
  }
  out(`\nAll ${total} ${name} checks pass.`);
}

export const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

export const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const textsTo = (s: { phone: string }) => texts.filter((t) => t.phone === s.phone);

export const CLIENT = { client_name: "Justin Reyes", client_email: "justin@example.com", client_phone: "+19725550199", event_name: "Justin's 30th" };

/** A submitted event. */
export function event(id: string, day: string, address: string, extra: Record<string, unknown> = {}, top: Record<string, unknown> = {}) {
  return {
    id,
    status: "submitted",
    version: 1,
    event_date: day,
    guest_count: "80",
    package_type: "Full Bar",
    booked_price: { total: 1800, bartenders: 2 },
    event_data: { ...CLIENT, event_type: "Birthday", event_date: day, bar_service_start: "6:00pm", bar_service_end: "10:00pm", event_address: address, guest_count: 80, package: "Full Bar", bartenders: 2, ...extra },
    ...top,
  } as Record<string, unknown>;
}

/** Client details that must never reach staff. */
export const noClientData = (s: string) => !/Reyes|justin@example|9725550199|1800/.test(s);
