import { NextResponse } from "next/server";
import {
  getGooglePlacesApiKey,
  getYelpApiKey,
  getGoogleBusinessProfileConfig,
} from "@/lib/env";
import { getAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const features = await getAppFeatures();
  if (!features.reviewsEnabled) {
    return NextResponse.json({ error: "Reviews are disabled" }, { status: 404 });
  }
  return NextResponse.json({
    googlePlacesApiConfigured: !!getGooglePlacesApiKey(),
    googleBusinessProfileConfigured: !!getGoogleBusinessProfileConfig(),
    yelpApiConfigured: !!getYelpApiKey(),
  });
}
