import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; messageId: string; attachmentId: string }>;
  }
) {
  try {
    const { id: conversationId, messageId, attachmentId } = await params;

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
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
      await prisma.message.delete({ where: { id: messageId } });
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return NextResponse.json({ messageDeleted: true });
    }

    await prisma.messageAttachment.delete({ where: { id: attachmentId } });
    await prisma.message.update({
      where: { id: messageId },
      data: { editedAt: new Date() },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    const updated = await prisma.message.findUnique({
      where: { id: messageId },
      include: { attachments: true },
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
