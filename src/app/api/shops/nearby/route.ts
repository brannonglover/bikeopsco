import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { haversineMiles } from "@/lib/collection-radius";

export const dynamic = "force-dynamic";

function parseCoord(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Public platform directory: shops near a lat/lng.
 * Distances are in miles. Intended for the mobile app (app.bikeops.co).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const lat = parseCoord(searchParams.get("lat"));
  const lng = parseCoord(searchParams.get("lng"));
  // Prefer radiusMiles; accept legacy radiusKm for older app builds.
  const radiusMilesRaw =
    parseCoord(searchParams.get("radiusMiles")) ??
    (() => {
      const km = parseCoord(searchParams.get("radiusKm"));
      return km != null ? km / 1.60934 : null;
    })();
  const radiusMiles =
    radiusMilesRaw != null && radiusMilesRaw > 0
      ? Math.min(radiusMilesRaw, 500)
      : 100;

  if (lat == null || lng == null) {
    return NextResponse.json(
      { error: "lat and lng query parameters are required." },
      { status: 400 }
    );
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json(
      { error: "lat/lng out of range." },
      { status: 400 }
    );
  }

  const shops = await prisma.shop.findMany({
    where: {
      latitude: { not: null },
      longitude: { not: null },
    },
    select: {
      id: true,
      name: true,
      subdomain: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  });

  const origin = { lat, lng };
  const nearby = shops
    .map((shop) => {
      const shopLat = shop.latitude;
      const shopLng = shop.longitude;
      if (shopLat == null || shopLng == null) return null;
      const distanceMiles = haversineMiles(origin, {
        lat: shopLat,
        lng: shopLng,
      });
      if (distanceMiles > radiusMiles) return null;
      const roundedMiles = Math.round(distanceMiles * 10) / 10;
      return {
        id: shop.id,
        name: shop.name,
        subdomain: shop.subdomain,
        address: shop.address,
        distanceMiles: roundedMiles,
        distanceKm: Math.round(distanceMiles * 1.60934 * 10) / 10,
        lat: shopLat,
        lng: shopLng,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s != null)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  return NextResponse.json({ shops: nearby });
}
