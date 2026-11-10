// Turn an event address into a map location, once per address. Uses Google
// when GOOGLE_MAPS_API_KEY is set, otherwise OpenStreetMap's free geocoder.
// Never throws: an address that cannot be found returns null and punches are
// flagged "no_event_location". Server only.

import type { LatLng } from "@/lib/team/clock";

const USER_AGENT = "MixFixTeamPortal/1.0";

async function google(address: string, key: string): Promise<LatLng | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&components=country:US&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: { geometry?: { location?: { lat: number; lng: number } } }[] };
  const loc = data.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
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

export async function geocodeAddress(address: string): Promise<{ location: LatLng | null; source: string }> {
  const a = address.trim();
  if (!a) return { location: null, source: "none" };
  const key = process.env.GOOGLE_MAPS_API_KEY;
  try {
    return key ? { location: await google(a, key), source: "google" } : { location: await openStreetMap(a), source: "openstreetmap" };
  } catch (err) {
    console.error("[team] geocode failed:", err instanceof Error ? err.message : String(err));
    return { location: null, source: key ? "google" : "openstreetmap" };
  }
}
