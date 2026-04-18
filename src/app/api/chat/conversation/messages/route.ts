import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { sendPushToAllStaff } from "@/lib/push";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  body: z.string().optional().nullable(),
  attachmentIds: z.array(z.string()).optional().default([]),
});

/**
 * Customer-only: GET messages for their conversation.
 */
export async function GET() {
  const features = await getAppFeatures();
  if (!features.chatEnabled) {
    return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
  }
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
      include: { attachments: true, reactions: true },
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
  const features = await getAppFeatures();
  if (!features.chatEnabled) {
    return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
  }
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

  const [message] = await Promise.all([
    prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: "CUSTOMER",
        body: bodyText?.trim() || null,
        attachments:
          attachmentIds?.length
            ? { connect: attachmentIds.map((id) => ({ id })) }
            : undefined,
      },
      include: { attachments: true, reactions: true },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date(), customerTypingAt: null },
    }),
    prisma.customer.findUnique({
      where: { id: customerId },
      select: { firstName: true, lastName: true },
    }).then((customer) => {
      const customerName = customer
        ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
        : "Customer";
      const pushBody = bodyText?.trim() || "Sent a photo";
      sendPushToAllStaff({
        title: `New message from ${customerName}`,
        body: pushBody,
        data: { type: "new_message", conversationId: conversation.id },
      }).catch((err) => console.error("Push notify staff:", err));
    }),
  ]);

  return NextResponse.json(message);
}
