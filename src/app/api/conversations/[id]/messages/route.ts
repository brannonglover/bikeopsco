import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendChatStaffSms } from "@/lib/sms";
import { z } from "zod";

const createSchema = z.object({
  sender: z.enum(["STAFF", "CUSTOMER"]),
  body: z.string().optional().nullable(),
  attachmentIds: z.array(z.string()).optional().default([]),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;

    const [conversation, messages] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { customerTypingAt: true, updatedAt: true },
      }),
      prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        include: { attachments: true },
      }),
    ]);

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Preserve updatedAt so marking read does not reorder the inbox (list is sorted by updatedAt).
    const readUpdate = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        staffLastReadAt: new Date(),
        updatedAt: conversation.updatedAt,
      },
      select: { staffLastReadAt: true },
    });

    return NextResponse.json({
      messages,
      customerTypingAt: conversation.customerTypingAt?.toISOString() ?? null,
      staffLastReadAt: (readUpdate.staffLastReadAt ?? new Date()).toISOString(),
    });
  } catch (error) {
    console.error("GET /api/conversations/[id]/messages error:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const body = await request.json();
    const { sender, body: bodyText, attachmentIds } = createSchema.parse(body);

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { customer: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (!bodyText?.trim() && (!attachmentIds || attachmentIds.length === 0)) {
      return NextResponse.json(
        { error: "Message must have body text or at least one attachment" },
        { status: 400 }
      );
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        sender,
        body: bodyText?.trim() || null,
        attachments: attachmentIds?.length
          ? {
              connect: attachmentIds.map((id) => ({ id })),
            }
          : undefined,
      },
      include: { attachments: true },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    if (sender === "STAFF" && conversation.customer.phone) {
      const hasText = Boolean(bodyText?.trim());
      const hasAtt = Boolean(attachmentIds?.length);
      if (hasText) {
        const smsText = hasAtt
          ? `${bodyText!.trim()} (see chat for photos)`
          : bodyText!.trim();
        sendChatStaffSms(conversation.customer.phone, smsText).catch((err) =>
          console.error("Chat SMS notify:", err)
        );
      } else if (hasAtt) {
        sendChatStaffSms(conversation.customer.phone, "", {
          attachmentOnly: true,
        }).catch((err) => console.error("Chat SMS notify:", err));
      }
    }

    return NextResponse.json(message);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/conversations/[id]/messages error:", error);
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    );
  }
}
