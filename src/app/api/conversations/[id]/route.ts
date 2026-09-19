import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";
import { resolveStaffConversation } from "@/lib/conversation";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    archived: z.boolean().optional(),
    /**
     * The per-conversation kill switch. Staff can only pause the assistant or
     * put it back to work: OFF is a thread it never touched, and DONE is its
     * own sign-off, so neither is something to set by hand.
     */
    aiAssistantState: z.enum(["ACTIVE", "PAUSED"]).optional(),
  })
  .refine(
    (value) => value.archived !== undefined || value.aiAssistantState !== undefined,
    { message: "Nothing to update" }
  );

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const features = await getAppFeatures();
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const shop = await requireCurrentShop();
    const { id } = await params;
    const body = await request.json();
    const { archived, aiAssistantState } = patchSchema.parse(body);

    const existing = await prisma.conversation.findFirst({
      where: { id, shopId: shop.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        ...(archived !== undefined ? { archived } : {}),
        ...(aiAssistantState !== undefined
          ? {
              aiAssistantState,
              // Resuming clears the handoff note: whatever it said is about a
              // conversation staff have now handed back.
              ...(aiAssistantState === "ACTIVE" ? { aiAssistantSummary: null } : {}),
            }
          : {}),
      },
      include: {
        customer: true,
        job: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { attachments: true, reactions: true },
        },
      },
    });

    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/conversations/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const { id } = await params;

    const resolved = await resolveStaffConversation(shop.id, id);
    if (!resolved) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: resolved.id },
      include: {
        customer: true,
        job: true,
        messages: {
          orderBy: { createdAt: "asc" },
          include: { attachments: true, reactions: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(conversation);
  } catch (error) {
    console.error("GET /api/conversations/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversation" },
      { status: 500 }
    );
  }
}
