import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getAppFeatures } from "@/lib/app-settings";
import {
  consolidateCustomerConversations,
  findOrCreateGeneralConversation,
} from "@/lib/conversation";
import { getEffectiveSmsConsent } from "@/lib/sms-consent";
import { requireCurrentShop } from "@/lib/shop";

const conversationInclude = {
  customer: true,
  job: true,
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: { attachments: true, reactions: true },
  },
};

export const dynamic = "force-dynamic";

const createSchema = z.object({
  customerId: z.string().min(1),
  jobId: z.string().optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const features = await getAppFeatures(shop.id);
    if (!features.chatEnabled) {
      return NextResponse.json({ error: "Chat is disabled" }, { status: 404 });
    }
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 8);
    const listWhere = {
      shopId: shop.id,
      archived: false,
      jobId: null,
      ...(terms.length > 0
        ? {
            AND: terms.map((term) => ({
              OR: [
                { customer: { firstName: { contains: term, mode: "insensitive" as const } } },
                { customer: { lastName: { contains: term, mode: "insensitive" as const } } },
                { customer: { email: { contains: term, mode: "insensitive" as const } } },
                { customer: { phone: { contains: term, mode: "insensitive" as const } } },
                { messages: { some: { body: { contains: term, mode: "insensitive" as const } } } },
              ],
            })),
          }
        : {}),
    };

    const conversations = await prisma.conversation.findMany({
      where: listWhere,
      orderBy: { updatedAt: "desc" },
      include: conversationInclude,
    });

    const customerCounts = new Map<string, number>();
    for (const c of conversations) {
      customerCounts.set(c.customerId, (customerCounts.get(c.customerId) ?? 0) + 1);
    }
    const dupeCustomerIds = [...customerCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([customerId]) => customerId);

    if (dupeCustomerIds.length > 0) {
      void prisma
        .$transaction(async (tx) => {
          for (const customerId of dupeCustomerIds) {
            await consolidateCustomerConversations(shop.id, customerId, tx);
          }
        })
        .catch((e) =>
          console.error("[chat] Background conversation consolidation failed:", e)
        );
    }

    return NextResponse.json(
      conversations.map((conversation) =>
        conversation.customer
          ? {
              ...conversation,
              customer: {
                ...conversation.customer,
                smsConsent: getEffectiveSmsConsent(conversation.customer),
              },
            }
          : conversation
      )
    );
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
    const { customerId } = createSchema.parse(body);

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, shopId: shop.id },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const conversation = await findOrCreateGeneralConversation(
      shop.id,
      customerId,
      { include: conversationInclude }
    );

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
