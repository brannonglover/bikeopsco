import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  customerId: z.string().min(1),
  jobId: z.string().optional().nullable(),
});

export async function GET() {
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const conversations = await prisma.conversation.findMany({
      where: { shopId: shop.id, archived: false },
      orderBy: { updatedAt: "desc" },
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

    return NextResponse.json(conversations);
  } catch (error) {
    console.error("GET /api/conversations error:", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const body = await request.json();
    const { customerId, jobId } = createSchema.parse(body);
    const normalizedJobId = jobId ?? null;

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, shopId: shop.id },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const conversation = await prisma.$transaction(async (tx) => {
      const lockKey = `${shop.id}:${customerId}:${normalizedJobId ?? "general"}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const existing = await tx.conversation.findFirst({
        where: {
          shopId: shop.id,
          customerId,
          jobId: normalizedJobId,
          archived: false,
        },
        orderBy: { updatedAt: "desc" },
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
      if (existing) return existing;

      return tx.conversation.create({
        data: {
          shopId: shop.id,
          customerId,
          jobId: normalizedJobId,
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
    });

    return NextResponse.json(conversation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/conversations error:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
