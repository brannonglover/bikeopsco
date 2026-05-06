import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendChatStaffSms } from "@/lib/sms";
import { sendPushToCustomer, sendPushToAllStaff } from "@/lib/push";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";
import { customerHasActiveChatJob } from "@/lib/chat-session";
import { getEffectiveSmsConsent } from "@/lib/sms-consent";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

type ChatMessageRow = {
  sender: "STAFF" | "CUSTOMER" | "SYSTEM";
  createdAt: Date;
  [key: string]: unknown;
};

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

    // Keep the base conversation fetch minimal so this route can still work if the DB
    // is temporarily behind migrations (missing newer optional columns).
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, shopId: shop.id },
      select: { updatedAt: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    let messages: ChatMessageRow[] = [];
    try {
      messages = await prisma.message.findMany({
        where: { shopId: shop.id, conversationId },
        orderBy: { createdAt: "asc" },
        include: { attachments: true, reactions: true },
      });
    } catch (e) {
      console.warn(
        "[chat] Failed to load message includes (attachments/reactions); falling back:",
        { conversationId, error: e }
      );
      messages = await prisma.message.findMany({
        where: { shopId: shop.id, conversationId },
        orderBy: { createdAt: "asc" },
      });
    }

    let customerTypingAtIso: string | null = null;
    let customerLastReadAtIso: string | null = null;
    let currentStaffLastReadAt: Date | null = null;
    try {
      const extra = await prisma.conversation.findFirst({
        where: { id: conversationId, shopId: shop.id },
        select: { customerTypingAt: true, customerLastReadAt: true, staffLastReadAt: true },
      });
      customerTypingAtIso = extra?.customerTypingAt?.toISOString() ?? null;
      customerLastReadAtIso = extra?.customerLastReadAt?.toISOString() ?? null;
      currentStaffLastReadAt = extra?.staffLastReadAt ?? null;
    } catch (e) {
      console.warn("[chat] Failed to load conversation extras; continuing:", {
        conversationId,
        error: e,
      });
    }

    const latestCustomerMessageAt = messages.reduce<Date | null>((latest, message) => {
      if (message.sender !== "CUSTOMER") return latest;
      if (!latest || message.createdAt > latest) return message.createdAt;
      return latest;
    }, null);

    // Preserve updatedAt so marking read does not reorder the inbox (list is sorted by updatedAt).
    let staffLastReadAtIso: string | null = currentStaffLastReadAt?.toISOString() ?? null;
    const shouldMarkRead =
      latestCustomerMessageAt !== null &&
      (!currentStaffLastReadAt ||
        latestCustomerMessageAt.getTime() > currentStaffLastReadAt.getTime());

    if (shouldMarkRead) {
      try {
        const readUpdate = await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            staffLastReadAt: new Date(),
            updatedAt: conversation.updatedAt,
          },
          select: { staffLastReadAt: true },
        });
        staffLastReadAtIso = (readUpdate.staffLastReadAt ?? new Date()).toISOString();
      } catch (e) {
        console.warn("[chat] Failed to mark staffLastReadAt; continuing:", {
          conversationId,
          error: e,
        });
      }
    }

    return NextResponse.json({
      messages,
      customerTypingAt: customerTypingAtIso,
      staffLastReadAt: staffLastReadAtIso,
      customerLastReadAt: customerLastReadAtIso,
    });
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

      if (
        conversation.customer.phone &&
        getEffectiveSmsConsent(conversation.customer) &&
        (await customerHasActiveChatJob(shop.id, conversation.customerId))
      ) {
        if (hasText) {
          const smsText = hasAtt
            ? `${bodyText!.trim()} (see chat for photos)`
            : bodyText!.trim();
          sendChatStaffSms(conversation.customer.phone, smsText).catch((err) =>
            console.error("Chat SMS notify:", err)
          );
        } else if (hasAtt) {
          sendChatStaffSms(conversation.customer.phone, "", {
            attachmentOnly: true,
          }).catch((err) => console.error("Chat SMS notify:", err));
        }
      }

      const pushBody = hasText
        ? bodyText!.trim()
        : hasAtt
          ? "Sent a photo"
          : "New message";
      sendPushToCustomer(shop.id, conversation.customerId, {
        title: shopName,
        body: pushBody,
        data: { type: "new_message", conversationId },
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
      sendPushToAllStaff(shop.id, {
        title: `New message from ${customerName}`,
        body: pushBody,
        data: { type: "new_message", conversationId },
      }).catch((err) => console.error("Push notify staff:", err));
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
