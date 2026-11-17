// Driving distance from Google's Routes API (computeRoutes), for mileage.
//
// Called only when a person is put on an event (accept, approved shift
// request, handoff) and when an admin or manager recalculates one person's
// miles. Never on a page view: open shifts and offers show a straight line
// estimate labeled "approximate". The field mask asks only for
// routes.distanceMeters, which keeps the call on the cheapest billing tier.
// Never throws: a missing key, an error, or no route returns null and the
// caller falls back to straight line miles. Server only.

import type { LatLng } from "@/lib/team/profile";

export const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const METERS_PER_MILE = 1609.344;
const TIMEOUT_MS = 8000;

const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

/** One way driving miles from a to b, to a tenth, or null when it could not be worked out. */
export async function drivingMiles(from: LatLng, to: LatLng): Promise<number | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters" },
      body: JSON.stringify({ origin: waypoint(from), destination: waypoint(to), travelMode: "DRIVE" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[team] driving miles failed:", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { routes?: { distanceMeters?: number }[] };
    const route = data.routes?.[0];
    if (!route) return null; // no drivable route
    const meters = Number(route.distanceMeters ?? 0); // zero is left out of the response
    if (!Number.isFinite(meters) || meters < 0) return null;
    return Math.round((meters / METERS_PER_MILE) * 10) / 10;
  } catch (err) {
    console.error("[team] driving miles failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
