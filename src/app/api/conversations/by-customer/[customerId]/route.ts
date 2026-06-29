import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAppFeatures } from "@/lib/app-settings";
import { resolveGeneralConversation } from "@/lib/conversation";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

type PreviewConversation = {
  id: string;
  updatedAt: Date;
  staffLastReadAt: Date | null;
  messages: Array<{
    id: string;
    body: string | null;
    sender: "STAFF" | "CUSTOMER" | "SYSTEM";
    createdAt: Date;
    attachments: { id: string }[];
  }>;
};

async function loadPreviewConversation(conversationId: string): Promise<PreviewConversation | null> {
  try {
    return await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        updatedAt: true,
        staffLastReadAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            body: true,
            sender: true,
            createdAt: true,
            attachments: { select: { id: true } },
          },
        },
      },
    });
  } catch (e) {
    console.warn("[chat] Failed to load conversation preview includes; falling back:", {
      conversationId,
      error: e,
    });
    const row = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        updatedAt: true,
        staffLastReadAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            body: true,
            sender: true,
            createdAt: true,
          },
        },
      },
    });
    if (!row) return null;
    return {
      ...row,
      messages: row.messages.map((m) => ({ ...m, attachments: [] })),
    };
  }
}

/**
 * Staff: preview of the customer's general chat thread (jobId null) for job detail / links.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  let customerId: string | null = null;
  let conversationId: string | null = null;
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    ({ customerId } = await params);
    const markRead = new URL(request.url).searchParams.get("markRead") === "1";

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, shopId: shop.id },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    let resolvedId: string | null = null;
    try {
      const resolved = await resolveGeneralConversation(shop.id, customerId);
      resolvedId = resolved?.id ?? null;
    } catch (e) {
      console.warn("[chat] resolveGeneralConversation failed; falling back:", {
        customerId,
        error: e,
      });
      const fallback = await prisma.conversation.findFirst({
        where: { shopId: shop.id, customerId, jobId: null, archived: false },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      resolvedId = fallback?.id ?? null;
    }

    if (!resolvedId) {
      return NextResponse.json({ conversation: null });
    }
    conversationId = resolvedId;

    const conversation = await loadPreviewConversation(resolvedId);
    if (!conversation) {
      return NextResponse.json({ conversation: null });
    }

    const last = conversation.messages[0];
    const latestCustomerMessageAt =
      last?.sender === "CUSTOMER" ? last.createdAt : null;

    if (markRead && latestCustomerMessageAt) {
      const shouldMarkRead =
        !conversation.staffLastReadAt ||
        latestCustomerMessageAt.getTime() > conversation.staffLastReadAt.getTime();

      if (shouldMarkRead) {
        try {
          // Preserve updatedAt so marking read does not reorder inbox lists.
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              staffLastReadAt: new Date(),
              updatedAt: conversation.updatedAt,
            },
            select: { id: true },
          });
        } catch (e) {
          console.warn("[chat] Failed to mark staffLastReadAt from preview; continuing:", e);
        }
      }
    }

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        updatedAt: conversation.updatedAt.toISOString(),
        lastMessage: last
          ? {
              id: last.id,
              body: last.body,
              sender: last.sender,
              createdAt: last.createdAt.toISOString(),
              attachmentCount: last.attachments.length,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("GET /api/conversations/by-customer/[customerId] error:", {
      customerId,
      conversationId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to fetch conversation" }, { status: 500 });
  }
}
