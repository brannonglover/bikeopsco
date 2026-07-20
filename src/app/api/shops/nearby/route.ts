import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return R * c;
}

function parseCoord(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Public platform directory: shops near a lat/lng.
 * Intended for the mobile app (app.bikeops.co / any host).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const lat = parseCoord(searchParams.get("lat"));
  const lng = parseCoord(searchParams.get("lng"));
  const radiusKmRaw = parseCoord(searchParams.get("radiusKm"));
  const radiusKm =
    radiusKmRaw != null && radiusKmRaw > 0
      ? Math.min(radiusKmRaw, 500)
      : 50;

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
      const distanceKm = haversineKm(origin, { lat: shopLat, lng: shopLng });
      if (distanceKm > radiusKm) return null;
      return {
        id: shop.id,
        name: shop.name,
        subdomain: shop.subdomain,
        address: shop.address,
        distanceKm: Math.round(distanceKm * 10) / 10,
        lat: shopLat,
        lng: shopLng,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s != null)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return NextResponse.json({ shops: nearby });
}
