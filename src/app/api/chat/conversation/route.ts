import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";

/**
 * Customer-only: returns the current customer's conversation (find or create).
 */
export async function GET() {
  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { customerId, jobId: null },
    orderBy: { updatedAt: "desc" },
    include: {
      customer: true,
      job: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { attachments: true },
      },
    },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { customerId, jobId: null },
      include: {
        customer: true,
        job: true,
        messages: { include: { attachments: true } },
      },
    });
  }

  return NextResponse.json(conversation);
}
