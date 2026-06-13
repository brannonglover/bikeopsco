import { NextResponse } from "next/server";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
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

  const conversation = await findOrCreateGeneralConversation(
    shop.id,
    customerId,
    {
      include: {
        customer: true,
        job: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { attachments: true },
        },
      },
    }
  );

  return NextResponse.json(conversation);
}
