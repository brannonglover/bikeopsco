import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireStaffShop } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;

    const stripe = getStripe();
    const locationId = process.env.STRIPE_TERMINAL_LOCATION_ID?.trim();
    const connectionToken = await stripe.terminal.connectionTokens.create(
      locationId ? { location: locationId } : undefined
    );
    return NextResponse.json({ secret: connectionToken.secret });
  } catch (error) {
    console.error("POST /api/terminal/connection-token error:", error);
    return NextResponse.json(
      { error: "Failed to create connection token" },
      { status: 500 }
    );
  }
}
