import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publishChatEvent } from "@/lib/realtime/publish-chat-event";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

/**
 * Removes one image from a staff message, deleting the message outright when
 * that image was all it had.
 *
 * Scoped by `shopId` throughout, for the reason spelled out in the sibling
 * message route: matching on ids alone would reach across tenants.
 */
export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; messageId: string; attachmentId: string }>;
  }
) {
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const { id: conversationId, messageId, attachmentId } = await params;

    const message = await prisma.message.findFirst({
      where: { shopId: shop.id, id: messageId, conversationId },
      include: { attachments: true },
    });

    if (!message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    if (message.sender !== "STAFF") {
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
        where: { id: message.conversationId },
        data: { updatedAt: new Date() },
      });

      await publishChatEvent("chat:message", {
        shopId: shop.id,
        conversationId: message.conversationId,
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
      where: { id: message.conversationId },
      data: { updatedAt: new Date() },
    });

    const updated = await prisma.message.findUnique({
      where: { id: message.id },
      include: { attachments: true, reactions: true },
    });

    await publishChatEvent("chat:message", {
      shopId: shop.id,
      conversationId: message.conversationId,
      messageId: message.id,
    });

    return NextResponse.json({ messageDeleted: false, message: updated });
  } catch (error) {
    console.error("DELETE staff attachment error:", error);
    return NextResponse.json(
      { error: "Failed to remove image" },
      { status: 500 }
    );
  }
}
