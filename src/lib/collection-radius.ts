import { getGooglePlacesApiKey } from "@/lib/env";

export type CollectionEligibility =
  | { ok: true; enabled: false }
  | { ok: true; enabled: true; radiusMiles: number; distanceMiles: number; eligible: boolean; formattedAddress: string | null }
  | { ok: false; enabled: true; error: string };

function parseEnvFloat(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const val = Number(raw);
  return Number.isFinite(val) ? val : null;
}

function getShopOrigin(): { lat: number; lng: number } | null {
  const lat = parseEnvFloat("SHOP_LAT");
  const lng = parseEnvFloat("SHOP_LNG");
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

export function getCollectionRadiusMiles(): number {
  const raw = parseEnvFloat("COLLECTION_RADIUS_MILES");
  if (raw == null) return 5;
  // Guardrails: keep within a sane range.
  return Math.max(0.1, Math.min(100, raw));
}

function normalizeRadiusMiles(raw: number | null | undefined): number {
  if (raw == null) return getCollectionRadiusMiles();
  const val = Number(raw);
  if (!Number.isFinite(val)) return getCollectionRadiusMiles();
  return Math.max(0.1, Math.min(100, val));
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.7613; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return R * c;
}

async function geocodeAddress(address: string, apiKey: string): Promise<{
  location: { lat: number; lng: number };
  formattedAddress: string | null;
} | null> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}&components=country:US`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as unknown;
  if (
    typeof data !== "object" ||
    data === null ||
    !("results" in data) ||
    !Array.isArray((data as { results?: unknown }).results)
  ) {
    return null;
  }
  const results = (data as { results: unknown[] }).results;
  const first = results[0];
  const firstObj = typeof first === "object" && first !== null ? (first as Record<string, unknown>) : null;
  const geometry = firstObj && typeof firstObj.geometry === "object" && firstObj.geometry !== null
    ? (firstObj.geometry as Record<string, unknown>)
    : null;
  const location = geometry && typeof geometry.location === "object" && geometry.location !== null
    ? (geometry.location as Record<string, unknown>)
    : null;
  const lat = typeof location?.lat === "number" ? (location.lat as number) : null;
  const lng = typeof location?.lng === "number" ? (location.lng as number) : null;
  if (lat == null || lng == null) return null;
  const formattedAddress =
    firstObj && typeof firstObj.formatted_address === "string" ? (firstObj.formatted_address as string) : null;
  return { location: { lat, lng }, formattedAddress };
}

/**
 * Check whether an address is within the collection radius.
 *
 * Enabled when:
 * - `SHOP_LAT` and `SHOP_LNG` are set
 * - `GOOGLE_PLACES_API_KEY` is set (used for geocoding)
 */
export async function checkCollectionEligibility(
  addressRaw: string,
  radiusMilesOverride?: number
): Promise<CollectionEligibility> {
  const origin = getShopOrigin();
  const apiKey = getGooglePlacesApiKey();
  if (!origin || !apiKey) return { ok: true, enabled: false };

  const address = addressRaw.trim();
  if (!address) {
    return { ok: false, enabled: true, error: "Collection address is required." };
  }

  const geo = await geocodeAddress(address, apiKey);
  if (!geo) {
    return { ok: false, enabled: true, error: "We couldn’t verify that address. Please double-check it." };
  }

  const distanceMiles = haversineMiles(origin, geo.location);
  const radiusMiles = normalizeRadiusMiles(radiusMilesOverride);
  const eligible = distanceMiles <= radiusMiles;
  return { ok: true, enabled: true, radiusMiles, distanceMiles, eligible, formattedAddress: geo.formattedAddress };
}
