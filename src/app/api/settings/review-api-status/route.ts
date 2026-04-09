import { NextResponse } from "next/server";
import { getGooglePlacesApiKey, getYelpApiKey } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    googlePlacesApiConfigured: !!getGooglePlacesApiKey(),
    yelpApiConfigured: !!getYelpApiKey(),
  });
}
