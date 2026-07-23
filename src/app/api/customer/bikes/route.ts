import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";

export const dynamic = "force-dynamic";

const createBikeSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1).optional().nullable(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional().nullable(),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
});

async function requireCustomerSession() {
  const shop = await requireCurrentShop();
  const features = await getAppFeatures(shop.id);
  if (!features.chatEnabled) {
    return {
      error: NextResponse.json({ error: "Chat is disabled" }, { status: 404 }),
    };
  }

  const customerId = await getCustomerFromSession();
  if (!customerId) {
    return {
      error: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }

  return { shop, customerId };
}

export async function GET() {
  try {
    const session = await requireCustomerSession();
    if ("error" in session) return session.error;

    const bikes = await prisma.bike.findMany({
      where: { shopId: session.shop.id, customerId: session.customerId },
      orderBy: [{ make: "asc" }, { model: "asc" }],
    });
    return NextResponse.json(bikes);
  } catch (error) {
    console.error("GET /api/customer/bikes error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bikes" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireCustomerSession();
    if ("error" in session) return session.error;

    const body = await request.json();
    const data = createBikeSchema.parse(body);

    const customer = await prisma.customer.findFirst({
      where: { id: session.customerId, shopId: session.shop.id },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const bike = await prisma.bike.create({
      data: {
        shopId: session.shop.id,
        customerId: customer.id,
        make: data.make.trim(),
        model: data.model?.trim() || null,
        bikeType: data.bikeType ?? null,
        nickname: data.nickname?.trim() || null,
        imageUrl: data.imageUrl?.trim() || null,
      },
    });
    return NextResponse.json(bike);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = Object.entries(error.flatten().fieldErrors)
        .flatMap(([field, msgs]) =>
          (Array.isArray(msgs) ? msgs : [msgs])
            .filter(Boolean)
            .map((m) => `${field}: ${m}`)
        )
        .join("; ");
      return NextResponse.json(
        { error: messages || "Invalid bike data" },
        { status: 400 }
      );
    }
    console.error("POST /api/customer/bikes error:", error);
    return NextResponse.json(
      { error: "Failed to create bike" },
      { status: 500 }
    );
  }
}
