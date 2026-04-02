import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { z } from "zod";

const createSchema = z.object({
  body: z.string().optional().nullable(),
  attachmentIds: z.array(z.string()).optional().default([]),
});

/**
 * Customer-only: GET messages for their conversation.
 */
export async function GET() {
  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { customerId, jobId: null },
    select: { id: true, updatedAt: true, staffLastReadAt: true },
  });

  if (!conversation) {
    return NextResponse.json({ messages: [], staffLastReadAt: null });
  }

  const [messages, readUpdate] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      include: { attachments: true },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        customerLastReadAt: new Date(),
        updatedAt: conversation.updatedAt,
      },
      select: { customerLastReadAt: true, staffLastReadAt: true },
    }),
  ]);

  return NextResponse.json({
    messages,
    staffLastReadAt: readUpdate.staffLastReadAt?.toISOString() ?? null,
  });
}

/**
 * Customer-only: POST a new message (always as CUSTOMER).
 */
export async function POST(request: NextRequest) {
  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { customerId, jobId: null },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { customerId, jobId: null },
    });
  }

  const body = await request.json();
  const { body: bodyText, attachmentIds } = createSchema.parse(body);

  if (!bodyText?.trim() && (!attachmentIds || attachmentIds.length === 0)) {
    return NextResponse.json(
      { error: "Message must have body text or at least one attachment" },
      { status: 400 }
    );
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      sender: "CUSTOMER",
      body: bodyText?.trim() || null,
      attachments:
        attachmentIds?.length
          ? { connect: attachmentIds.map((id) => ({ id })) }
          : undefined,
    },
    include: { attachments: true },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date(), customerTypingAt: null },
  });

  return NextResponse.json(message);
}
