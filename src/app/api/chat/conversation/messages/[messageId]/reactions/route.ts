import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  emoji: z.string().min(1).max(8),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
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
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    const { messageId } = await params;
    const json = await request.json();
    const { emoji } = createSchema.parse(json);

    const message = await prisma.message.findFirst({
      where: { shopId: shop.id, id: messageId, conversationId: conversation.id },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const reaction = await prisma.messageReaction.upsert({
      where: { messageId_reactorType: { messageId, reactorType: "CUSTOMER" } },
      update: { emoji },
      create: { shopId: shop.id, messageId, emoji, reactorType: "CUSTOMER" },
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
  const shop = await requireCurrentShop();
  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { shopId: shop.id, customerId, jobId: null },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  try {
    const { messageId } = await params;

    const message = await prisma.message.findFirst({
      where: { shopId: shop.id, id: messageId, conversationId: conversation.id },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    await prisma.messageReaction.deleteMany({
      where: { shopId: shop.id, messageId, reactorType: "CUSTOMER" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/chat/conversation/messages/[messageId]/reactions error:", error);
    return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 });
  }
}
