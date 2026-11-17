// Turn an address into a map location. Uses Google when GOOGLE_MAPS_API_KEY is
// set and falls back to OpenStreetMap's free geocoder when Google returns an
// error or no result (or there is no key). The source says which service
// found it: "google", "openstreetmap", or "none" when neither did. Never
// throws: an address that cannot be found returns a null location. Server only.

import type { LatLng } from "@/lib/team/clock";

const USER_AGENT = "MixFixTeamPortal/1.0";

export type GeoSource = "google" | "openstreetmap" | "none";

export const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

async function google(address: string, key: string): Promise<LatLng | null> {
  const url = `${GOOGLE_GEOCODE_URL}?address=${encodeURIComponent(address)}&components=country:US&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("[team] Google geocode failed:", res.status);
    return null;
  }
  const data = (await res.json()) as { status?: string; error_message?: string; results?: { geometry?: { location?: { lat: number; lng: number } } }[] };
  // Google answers 200 with a status: OK, ZERO_RESULTS, REQUEST_DENIED (API not enabled on the key), OVER_QUERY_LIMIT...
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") console.error("[team] Google geocode failed:", data.status, data.error_message ?? "");
  const loc = data.results?.[0]?.geometry?.location;
  return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) ? { lat: loc.lat, lng: loc.lng } : null;
}

async function openStreetMap(address: string): Promise<LatLng | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) return null;
  const data = (await res.json()) as { lat?: string; lon?: string }[];
  const hit = data[0];
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) && hit ? { lat, lng } : null;
}

async function attempt(name: string, run: () => Promise<LatLng | null>): Promise<LatLng | null> {
  try {
    return await run();
  } catch (err) {
    console.error(`[team] ${name} geocode failed:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Google first when there is a key, then OpenStreetMap. With googleOnly, no
 * fallback (the one time home re-lookup, which retries addresses OpenStreetMap
 * already missed).
 */
export async function geocodeAddress(address: string, opts: { googleOnly?: boolean } = {}): Promise<{ location: LatLng | null; source: GeoSource }> {
  const a = address.trim();
  if (!a) return { location: null, source: "none" };
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    const g = await attempt("Google", () => google(a, key));
    if (g) return { location: g, source: "google" };
  }
  if (opts.googleOnly) return { location: null, source: "none" };
  const o = await attempt("OpenStreetMap", () => openStreetMap(a));
  return o ? { location: o, source: "openstreetmap" } : { location: null, source: "none" };
}
