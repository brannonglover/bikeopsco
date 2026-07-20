import { NextRequest, NextResponse } from "next/server";
import { getCustomerFromSession } from "@/lib/chat-session";
import { loadCustomerConversationMessages } from "@/lib/chat/customer-conversation-messages";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { sendPushToAllStaff } from "@/lib/push";
import { sendStaffNewChatMessageNotification } from "@/lib/email";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";
import { prisma } from "@/lib/db";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  body: z.string().optional().nullable(),
  attachmentIds: z.array(z.string()).optional().default([]),
});

/**
 * Customer-only: GET messages for their conversation.
 */
export async function GET() {
  let customerId: string | null = null;
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    customerId = await getCustomerFromSession();
    if (!customerId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const payload = await loadCustomerConversationMessages(shop.id, customerId);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("GET /api/chat/conversation/messages error:", {
      customerId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

/**
 * Customer-only: POST a new message (always as CUSTOMER).
 */
export async function POST(request: NextRequest) {
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
    customerId
  );

  const body = await request.json();
  const { body: bodyText, attachmentIds } = createSchema.parse(body);

  if (!bodyText?.trim() && (!attachmentIds || attachmentIds.length === 0)) {
    return NextResponse.json(
      { error: "Message must have body text or at least one attachment" },
      { status: 400 }
    );
  }

  const [message, customer] = await Promise.all([
    prisma.message.create({
      data: {
        shopId: shop.id,
        conversationId: conversation.id,
        sender: "CUSTOMER",
        body: bodyText?.trim() || null,
        attachments:
          attachmentIds?.length
            ? { connect: attachmentIds.map((id) => ({ id })) }
            : undefined,
      },
      include: { attachments: true, reactions: true },
    }),
    prisma.customer.findUnique({
      where: { id: customerId },
      select: { firstName: true, lastName: true },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date(), customerTypingAt: null },
    }),
  ]);

  const customerName = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
    : "Customer";
  const pushBody = bodyText?.trim() || "Sent a photo";
  await sendPushToAllStaff(shop.id, {
    title: `New message from ${customerName}`,
    body: pushBody,
    data: {
      type: "new_message",
      conversationId: conversation.id,
      messageId: message.id,
    },
  }).catch((err) => console.error("Push notify staff:", err));

  void sendStaffNewChatMessageNotification({
    shopId: shop.id,
    conversationId: conversation.id,
    messageId: message.id,
    customerName,
    messagePreview: pushBody,
  }).catch((err) => console.error("Email notify staff chat:", err));

  return NextResponse.json(message);
}
