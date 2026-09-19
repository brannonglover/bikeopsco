import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendPushToAllStaff } from "@/lib/push";
import { sendStaffNewChatMessageNotification } from "@/lib/email";
import { z } from "zod";
import { isChatEnabled } from "@/lib/app-settings";
import { loadStaffConversationMessages } from "@/lib/chat/staff-conversation-messages";
import { parseMessagePageOptions } from "@/lib/chat/message-page";
import { deliverStaffMessage } from "@/lib/chat/send-staff-message";
import {
  resolveStaffConversation,
  resolveStaffConversationForRead,
} from "@/lib/conversation";
import { requireCurrentShop } from "@/lib/shop";
import { attachmentNotificationLabel } from "@/lib/chat-media";

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
    if (!(await isChatEnabled(shop.id))) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    ({ id: conversationId } = await params);

    // Read path: resolve without the consolidation lock/transaction, and reuse
    // the resolved row so the loader doesn't re-fetch the same conversation.
    const resolved = await resolveStaffConversationForRead(shop.id, conversationId);
    if (!resolved) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const page = parseMessagePageOptions(request.nextUrl.searchParams);
    const payload = await loadStaffConversationMessages(shop.id, resolved, page);
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
    if (!(await isChatEnabled(shop.id))) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const { id: conversationId } = await params;
    const body = await request.json();
    const { sender, body: bodyText, attachmentIds } = createSchema.parse(body);

    const requested = await prisma.conversation.findFirst({
      where: { id: conversationId, shopId: shop.id },
      include: { customer: true },
    });

    if (!requested) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const conversation = await resolveStaffConversation(shop.id, conversationId);
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

    const targetConversationId = conversation.id;

    const message = await prisma.message.create({
      data: {
        shopId: shop.id,
        conversationId: targetConversationId,
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
      where: { id: targetConversationId },
      data: { updatedAt: new Date() },
    });

    if (sender === "STAFF") {
      // A person answering is the kill switch: the assistant stops the moment
      // staff join the thread, without anyone having to find a toggle first.
      // Its own messages are written with aiGenerated set, so they never
      // trip this.
      if (conversation.aiAssistantState === "ACTIVE") {
        await prisma.conversation.update({
          where: { id: targetConversationId },
          data: { aiAssistantState: "PAUSED" },
        });
      }

      await deliverStaffMessage({
        shop,
        customer: requested.customer,
        message: {
          id: message.id,
          conversationId: targetConversationId,
          body: message.body,
          attachments: message.attachments.map((a) => ({
            url: a.url,
            mimeType: a.mimeType,
          })),
        },
      });
    }

    if (sender === "CUSTOMER") {
      const customerName = [
        requested.customer.firstName,
        requested.customer.lastName,
      ]
        .filter(Boolean)
        .join(" ");
      const pushBody =
        bodyText?.trim() || attachmentNotificationLabel(message.attachments);
      await sendPushToAllStaff(shop.id, {
        title: `New message from ${customerName}`,
        body: pushBody,
        data: {
          type: "new_message",
          conversationId: targetConversationId,
          messageId: message.id,
        },
      }).catch((err) => console.error("Push notify staff:", err));

      void sendStaffNewChatMessageNotification({
        shopId: shop.id,
        conversationId: targetConversationId,
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
