import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isBillingActive } from "@/lib/billing";
import { verifyAppleSubscriptionPurchase } from "@/lib/apple-billing";

export const dynamic = "force-dynamic";

const verifySchema = z.object({
  shopId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  transactionId: z.string().trim().min(1),
  originalTransactionId: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid purchase payload" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { id: parsed.data.shopId },
    select: {
      id: true,
      billingStatus: true,
      trialEndsAt: true,
      billingProvider: true,
      appleOriginalTransactionId: true,
    },
  });

  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  if (
    shop.appleOriginalTransactionId &&
    shop.appleOriginalTransactionId !== parsed.data.originalTransactionId
  ) {
    return NextResponse.json({ error: "Shop already has an Apple subscription" }, { status: 409 });
  }

  const verification = await verifyAppleSubscriptionPurchase(parsed.data);
  if (!verification.ok) {
    const message =
      verification.reason === "apple_not_configured"
        ? "Apple billing verification is not configured."
        : verification.reason === "invalid_product"
          ? "Unexpected subscription product."
          : verification.reason === "shop_mismatch"
            ? "Purchase does not match this workspace."
            : "Could not verify App Store purchase.";
    const status = verification.reason === "apple_not_configured" ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: {
      billingProvider: "apple",
      billingStatus: verification.billingStatus,
      appleOriginalTransactionId: verification.originalTransactionId,
      appleProductId: verification.productId,
      appleCurrentPeriodEnd: verification.currentPeriodEnd,
      appleSubscriptionUpdatedAt: new Date(),
    },
    select: {
      billingStatus: true,
      trialEndsAt: true,
      appleOriginalTransactionId: true,
    },
  });

  return NextResponse.json({
    ok: true,
    billingActive: isBillingActive(updated),
  });
}
