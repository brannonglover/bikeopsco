import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  emoji: z.string().min(1).max(8),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { customerId, jobId: null },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    const { messageId } = await params;
    const json = await request.json();
    const { emoji } = createSchema.parse(json);

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId: conversation.id },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const reaction = await prisma.messageReaction.upsert({
      where: { messageId_reactorType: { messageId, reactorType: "CUSTOMER" } },
      update: { emoji },
      create: { messageId, emoji, reactorType: "CUSTOMER" },
    });

    return NextResponse.json(reaction);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/chat/conversation/messages/[messageId]/reactions error:", error);
    return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 });
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

  const conversation = await prisma.conversation.findFirst({
    where: { customerId, jobId: null },
  });

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

    await prisma.messageReaction.deleteMany({
      where: { messageId, reactorType: "CUSTOMER" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/chat/conversation/messages/[messageId]/reactions error:", error);
    return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 });
  }
}
