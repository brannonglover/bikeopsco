import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

export async function GET() {
  const shop = await requireCurrentShop();
  const features = await getAppFeatures(shop.id);
  if (!features.chatEnabled) {
    return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
  }

  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const jobs = await prisma.job.findMany({
    where: { customerId, shopId: shop.id },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { include: { bikes: true } },
      jobBikes: { include: { bike: true }, orderBy: { sortOrder: "asc" } },
      jobServices: { include: { service: true } },
      jobProducts: { include: { product: true } },
    },
  });

  return NextResponse.json(jobs);
}
