import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

/**
 * Customer-only: returns the current customer's conversation (find or create).
 */
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

  let conversation = await prisma.conversation.findFirst({
    where: { shopId: shop.id, customerId, jobId: null },
    orderBy: { updatedAt: "desc" },
    include: {
      customer: true,
      job: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { attachments: true },
      },
    },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { shopId: shop.id, customerId, jobId: null },
      include: {
        customer: true,
        job: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { attachments: true },
        },
      },
    });
  }

  return NextResponse.json(conversation);
}
