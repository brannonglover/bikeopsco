import { NextResponse } from "next/server";
import { getAppFeatures } from "@/lib/app-settings";

/** Returns a 403 response when the shop has Rentals turned off. */
export async function rentalsDisabledResponse(shopId: string): Promise<NextResponse | null> {
  const features = await getAppFeatures(shopId);
  if (features.rentalsEnabled) return null;
  return NextResponse.json(
    { error: "Rentals are disabled for this shop. Enable them in Settings → Features." },
    { status: 403 }
  );
}
