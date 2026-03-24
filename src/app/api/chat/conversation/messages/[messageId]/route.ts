import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { z } from "zod";

const patchSchema = z.object({
  body: z.string().optional().nullable(),
});

async function getCustomerConversation(customerId: string) {
  return prisma.conversation.findFirst({
    where: { customerId, jobId: null },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const conversation = await getCustomerConversation(customerId);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    const { messageId } = await params;
    const json = await request.json();
    const { body: bodyText } = patchSchema.parse(json);

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId: conversation.id },
      include: { attachments: true },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (message.sender !== "CUSTOMER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const trimmed = bodyText?.trim() ?? null;
    const hasAttachments = message.attachments.length > 0;
    if (!trimmed && !hasAttachments) {
      return NextResponse.json(
        { error: "Message must have body text or at least one attachment" },
        { status: 400 }
      );
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        body: trimmed,
        editedAt: new Date(),
      },
      include: { attachments: true },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/chat/conversation/messages/[messageId] error:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const conversation = await getCustomerConversation(customerId);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    const { messageId } = await params;

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId: conversation.id },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (message.sender !== "CUSTOMER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.message.delete({ where: { id: messageId } });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/chat/conversation/messages/[messageId] error:", error);
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 });
  }
}
