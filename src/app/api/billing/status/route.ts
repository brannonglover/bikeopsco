import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { BIKEOPS_MONTHLY_PRICE, isBillingActive } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.shopId || typeof token.shopId !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = await prisma.shop.findUnique({
    where: { id: token.shopId },
    select: {
      billingStatus: true,
      trialEndsAt: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripeCurrentPeriodEnd: true,
      stripeCancelAtPeriodEnd: true,
    },
  });

  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: shop.billingStatus,
    trialEndsAt: shop.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: shop.stripeCurrentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: shop.stripeCancelAtPeriodEnd,
    hasStripeCustomer: !!shop.stripeCustomerId,
    hasSubscription: !!shop.stripeSubscriptionId,
    billingActive: isBillingActive(shop),
    monthlyPrice: BIKEOPS_MONTHLY_PRICE,
  });
}
