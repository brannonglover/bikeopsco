import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

/**
 * Staff: preview of the customer's general chat thread (jobId null) for job detail / links.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const features = await getAppFeatures();
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const { customerId } = await params;
    const markRead = new URL(request.url).searchParams.get("markRead") === "1";

    const conversation = await prisma.conversation.findFirst({
      where: { customerId, jobId: null, archived: false },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { attachments: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ conversation: null });
    }

    if (markRead) {
      try {
        // Preserve updatedAt so marking read does not reorder inbox lists.
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { staffLastReadAt: new Date(), updatedAt: conversation.updatedAt },
          select: { id: true },
        });
      } catch (e) {
        console.warn("[chat] Failed to mark staffLastReadAt from preview; continuing:", e);
      }
    }

    const last = conversation.messages[0];
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
    console.error("GET /api/conversations/by-customer/[customerId] error:", error);
    return NextResponse.json({ error: "Failed to fetch conversation" }, { status: 500 });
  }
}
