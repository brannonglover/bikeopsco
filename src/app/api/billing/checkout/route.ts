import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getBikeOpsPriceId } from "@/lib/billing";

export const dynamic = "force-dynamic";

function getOrigin(request: NextRequest): string {
  return request.nextUrl.origin;
}

function getRemainingTrialDays(trialEndsAt: Date | null): number | null {
  if (!trialEndsAt) return null;
  const remainingMs = trialEndsAt.getTime() - Date.now();
  if (remainingMs <= 0) return null;
  return Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request });
    if (!token?.shopId || typeof token.shopId !== "string") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shop = await prisma.shop.findUnique({
      where: { id: token.shopId },
      select: {
        id: true,
        name: true,
        subdomain: true,
        trialEndsAt: true,
        billingStatus: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        users: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { email: true, name: true },
        },
      },
    });

    if (!shop) {
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    }

    const stripe = getStripe();
    const priceId = getBikeOpsPriceId();
    const owner = shop.users[0];
    let customerId = shop.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: shop.name,
        email: owner?.email,
        metadata: {
          shopId: shop.id,
          shopSubdomain: shop.subdomain,
          ownerName: owner?.name ?? "",
        },
      });
      customerId = customer.id;
      await prisma.shop.update({
        where: { id: shop.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const trialDays = getRemainingTrialDays(shop.trialEndsAt);
    const origin = getOrigin(request);
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/billing?checkout=cancelled`,
      client_reference_id: shop.id,
      subscription_data: {
        ...(trialDays ? { trial_period_days: trialDays } : {}),
        metadata: {
          shopId: shop.id,
          shopSubdomain: shop.subdomain,
        },
      },
      metadata: {
        shopId: shop.id,
        shopSubdomain: shop.subdomain,
      },
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Failed to create billing checkout session", error);
    const message =
      error instanceof Error ? error.message : "Could not start billing checkout.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
