import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  active: z.boolean(),
});

/**
 * Customer-only: heartbeat while composing so staff can show a typing indicator.
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

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { customerId, jobId: null },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { customerId, jobId: null },
    });
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      customerTypingAt: body.active ? new Date() : null,
    },
  });

  return NextResponse.json({ ok: true });
}
