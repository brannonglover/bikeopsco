import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token?.shopId || typeof token.shopId !== "string") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = await prisma.shop.findUnique({
    where: { id: token.shopId },
    select: { stripeCustomerId: true },
  });

  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }
  if (!shop.stripeCustomerId) {
    return NextResponse.json(
      { error: "Start a subscription before opening billing management." },
      { status: 400 },
    );
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: shop.stripeCustomerId,
    return_url: `${request.nextUrl.origin}/billing`,
  });

  return NextResponse.json({ url: session.url });
}
