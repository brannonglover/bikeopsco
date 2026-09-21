import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publishChatEvent } from "@/lib/realtime/publish-chat-event";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

/**
 * Staff edit/delete for a single chat message.
 *
 * Every lookup here is scoped by `shopId` as well as by conversation. The
 * middleware only guarantees that the signed-in session matches the request
 * host — it says nothing about the *resource* being asked for, so a route that
 * finds a message by id alone would let one shop's staff edit another shop's
 * message given its ids. `requireCurrentShop()` resolves the shop from the
 * host, which is the value the session was already checked against.
 */
const patchSchema = z.object({
  body: z.string().optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const { id: conversationId, messageId } = await params;
    const json = await request.json();
    const { body: bodyText } = patchSchema.parse(json);

    const message = await prisma.message.findFirst({
      where: { shopId: shop.id, id: messageId, conversationId },
      include: { attachments: true },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (message.sender !== "STAFF") {
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

    // Safe to address by id alone: the findFirst above is what proves this row
    // belongs to this shop, and Prisma's `update` needs a unique selector.
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: {
        body: trimmed,
        editedAt: new Date(),
      },
      include: { attachments: true, reactions: true },
    });

    await prisma.conversation.update({
      where: { id: message.conversationId },
      data: { updatedAt: new Date() },
    });

    await publishChatEvent("chat:message", {
      shopId: shop.id,
      conversationId: message.conversationId,
      messageId: message.id,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/conversations/[id]/messages/[messageId] error:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const { id: conversationId, messageId } = await params;

    const message = await prisma.message.findFirst({
      where: { shopId: shop.id, id: messageId, conversationId },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (message.sender !== "STAFF") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/conversations/[id]/messages/[messageId] error:", error);
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 });
  }
}
