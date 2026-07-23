import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getConfiguredSmsProvider, sendChatStaffSms } from "@/lib/sms";
import {
  customerHasPushTokens,
  sendPushToCustomer,
  sendPushToAllStaff,
} from "@/lib/push";
import { sendStaffNewChatMessageNotification } from "@/lib/email";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";
import { loadStaffConversationMessages } from "@/lib/chat/staff-conversation-messages";
import {
  customerHasActiveChatJob,
  findActiveJobIdForCustomer,
} from "@/lib/chat-session";
import { getEffectiveSmsConsent } from "@/lib/sms-consent";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  sender: z.enum(["STAFF", "CUSTOMER"]),
  body: z.string().optional().nullable(),
  attachmentIds: z.array(z.string()).optional().default([]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let conversationId: string | null = null;
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    ({ id: conversationId } = await params);

    const payload = await loadStaffConversationMessages(shop.id, conversationId);
    if (!payload) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("GET /api/conversations/[id]/messages error:", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const { id: conversationId } = await params;
    const body = await request.json();
    const { sender, body: bodyText, attachmentIds } = createSchema.parse(body);

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, shopId: shop.id },
      include: { customer: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (!bodyText?.trim() && (!attachmentIds || attachmentIds.length === 0)) {
      return NextResponse.json(
        { error: "Message must have body text or at least one attachment" },
        { status: 400 }
      );
    }

    const message = await prisma.message.create({
      data: {
        shopId: shop.id,
        conversationId,
        sender,
        body: bodyText?.trim() || null,
        attachments: attachmentIds?.length
          ? {
              connect: attachmentIds.map((id) => ({ id })),
            }
          : undefined,
      },
      include: { attachments: true, reactions: true },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    const shopName = shop.name;

    if (sender === "STAFF") {
      const hasText = Boolean(bodyText?.trim());
      const hasAtt = Boolean(attachmentIds?.length);
      // App users get push instead of a parallel SMS for the same message.
      const preferAppPush = await customerHasPushTokens(
        shop.id,
        conversation.customerId
      );

      if (
        !preferAppPush &&
        conversation.customer.phone &&
        getEffectiveSmsConsent(conversation.customer) &&
        (await customerHasActiveChatJob(shop.id, conversation.customerId))
      ) {
        const activeJobId = await findActiveJobIdForCustomer(
          shop.id,
          conversation.customerId
        );
        const attachmentPayload = message.attachments.map((a) => ({
          url: a.url,
          mimeType: a.mimeType,
        }));
        const updateSmsDelivery = (smsText: string, attachmentOnly = false) => {
          sendChatStaffSms(conversation.customer.phone!, smsText, {
            attachmentOnly,
            includeChatUrl: attachmentOnly || hasAtt,
            shopSubdomain: shop.subdomain,
            messageId: message.id,
            jobId: activeJobId ?? undefined,
            shopId: shop.id,
            attachments: attachmentPayload,
          })
            .then((result) =>
              prisma.message.update({
                where: { id: message.id },
                data: {
                  smsProvider: result.provider ?? getConfiguredSmsProvider(),
                  smsSid: result.externalMessageId,
                  smsDeliveryStatus: result.ok
                    ? result.externalStatus ?? "SENT"
                    : "FAILED",
                  smsDeliveryStatusName: result.ok
                    ? result.externalStatusName ?? null
                    : "SEND_FAILED",
                  smsDeliveryStatusDescription: result.ok
                    ? result.externalStatusDescription ?? null
                    : result.error ?? null,
                  smsDeliveryError: result.ok ? null : result.error ?? "SMS send failed",
                },
              })
            )
            .catch((err) =>
              console.error("Chat SMS delivery persistence failed:", err)
            );
        };

        if (hasText) {
          updateSmsDelivery(bodyText!.trim());
        } else if (hasAtt) {
          updateSmsDelivery("", true);
        }
      }

      const pushBody = hasText
        ? bodyText!.trim()
        : hasAtt
          ? "Sent a photo"
          : "New message";
      await sendPushToCustomer(shop.id, conversation.customerId, {
        title: shopName,
        body: pushBody,
        data: { type: "new_message", conversationId, messageId: message.id },
      }).catch((err) => console.error("Push notify customer:", err));
    }

    if (sender === "CUSTOMER") {
      const customerName = [
        conversation.customer.firstName,
        conversation.customer.lastName,
      ]
        .filter(Boolean)
        .join(" ");
      const pushBody = bodyText?.trim() || "Sent a photo";
      await sendPushToAllStaff(shop.id, {
        title: `New message from ${customerName}`,
        body: pushBody,
        data: { type: "new_message", conversationId, messageId: message.id },
      }).catch((err) => console.error("Push notify staff:", err));

      void sendStaffNewChatMessageNotification({
        shopId: shop.id,
        conversationId,
        messageId: message.id,
        customerName: customerName || "Customer",
        messagePreview: pushBody,
      }).catch((err) => console.error("Email notify staff chat:", err));
    }

    return NextResponse.json(message);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/conversations/[id]/messages error:", error);
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    );
  }
}
