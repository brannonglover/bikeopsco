import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publishChatEvent } from "@/lib/realtime/publish-chat-event";
import { getCustomerFromSession } from "@/lib/chat-session";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

/**
 * Removes one image from a customer's own message, deleting the message
 * outright when that image was all it had. Scoped by shop as well as customer,
 * matching the sibling message route.
 */
export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ messageId: string; attachmentId: string }> }
) {
  const shop = await requireCurrentShop();
  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { shopId: shop.id, customerId, jobId: null },
  });
  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  try {
    const { messageId, attachmentId } = await params;

    const message = await prisma.message.findFirst({
      where: { shopId: shop.id, id: messageId, conversationId: conversation.id },
      include: { attachments: true },
    });

    if (!message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    if (message.sender !== "CUSTOMER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const attachment = message.attachments.find((a) => a.id === attachmentId);
    if (!attachment) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 }
      );
    }

    const hasBody = Boolean(message.body?.trim());
    const otherAttachments = message.attachments.length - 1;

    if (!hasBody && otherAttachments === 0) {
      await prisma.message.delete({ where: { id: message.id } });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      await publishChatEvent("chat:message", {
        shopId: shop.id,
        conversationId: conversation.id,
        messageId: message.id,
      });

      return NextResponse.json({ messageDeleted: true });
    }

    await prisma.messageAttachment.delete({ where: { id: attachment.id } });
    await prisma.message.update({
      where: { id: message.id },
      data: { editedAt: new Date() },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    const updated = await prisma.message.findUnique({
      where: { id: message.id },
      include: { attachments: true, reactions: true },
    });

    await publishChatEvent("chat:message", {
      shopId: shop.id,
      conversationId: conversation.id,
      messageId: message.id,
    });

    return NextResponse.json({ messageDeleted: false, message: updated });
  } catch (error) {
    console.error("DELETE customer attachment error:", error);
    return NextResponse.json(
      { error: "Failed to remove image" },
      { status: 500 }
    );
  }
}
