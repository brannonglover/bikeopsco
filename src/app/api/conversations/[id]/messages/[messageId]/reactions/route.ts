import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  emoji: z.string().min(1).max(8),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const features = await getAppFeatures();
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const { id: conversationId, messageId } = await params;
    const json = await request.json();
    const { emoji } = createSchema.parse(json);

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const reaction = await prisma.messageReaction.upsert({
      where: { messageId_reactorType: { messageId, reactorType: "STAFF" } },
      update: { emoji },
      create: { messageId, emoji, reactorType: "STAFF" },
    });

    return NextResponse.json(reaction);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/conversations/[id]/messages/[messageId]/reactions error:", error);
    return NextResponse.json({ error: "Failed to add reaction" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id: conversationId, messageId } = await params;

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversationId },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    await prisma.messageReaction.deleteMany({
      where: { messageId, reactorType: "STAFF" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/conversations/[id]/messages/[messageId]/reactions error:", error);
    return NextResponse.json({ error: "Failed to remove reaction" }, { status: 500 });
  }
}
