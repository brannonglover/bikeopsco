import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  archived: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const features = await getAppFeatures();
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const { id } = await params;
    const body = await request.json();
    const { archived } = patchSchema.parse(body);

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { archived },
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
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
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
