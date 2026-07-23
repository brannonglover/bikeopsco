import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCustomerFromSession } from "@/lib/chat-session";
import { getAppFeatures } from "@/lib/app-settings";
import { requireCurrentShop } from "@/lib/shop";
import { coerceCustomerPhone } from "@/lib/phone";
import { ensureCustomerBikesFromJobs } from "@/lib/customer-bikes-from-jobs";

export const dynamic = "force-dynamic";

const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  imageUrl: z.string().min(1).optional().nullable(),
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

    const customer = await prisma.customer.findFirst({
      where: { id: session.customerId, shopId: session.shop.id },
    });

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const bikes = await ensureCustomerBikesFromJobs(
      prisma,
      session.shop.id,
      customer.id
    );

    return NextResponse.json({ ...customer, bikes });
  } catch (error) {
    console.error("GET /api/customer/me error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireCustomerSession();
    if ("error" in session) return session.error;

    const body = await request.json();
    const data = updateProfileSchema.parse(body);

    const existing = await prisma.customer.findFirst({
      where: { id: session.customerId, shopId: session.shop.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const customer = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName.trim() }),
        ...(data.lastName !== undefined && {
          lastName: data.lastName?.trim() || null,
        }),
        ...(data.email !== undefined && {
          email: data.email?.trim().toLowerCase() || null,
        }),
        ...(data.phone !== undefined && {
          phone: coerceCustomerPhone(data.phone),
        }),
        ...(data.address !== undefined && {
          address: data.address?.trim() || null,
        }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
      },
      include: {
        bikes: { orderBy: [{ make: "asc" }, { model: "asc" }] },
      },
    });

    return NextResponse.json(customer);
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
        { error: messages || "Invalid profile data" },
        { status: 400 }
      );
    }
    console.error("PATCH /api/customer/me error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
