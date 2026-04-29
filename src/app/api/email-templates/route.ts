import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";

export async function GET() {
  try {
    const shop = await requireCurrentShop();
    const templates = await prisma.emailTemplate.findMany({
      where: { shopId: shop.id },
      orderBy: { slug: "asc" },
    });
    return NextResponse.json(templates);
  } catch (error) {
    console.error("GET /api/email-templates error:", error);
    return NextResponse.json(
      { error: "Failed to fetch templates" },
      { status: 500 }
    );
  }
}

const updateSchema = z.object({
  slug: z.string(),
  subject: z.string().optional(),
  bodyHtml: z.string().optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const body = await request.json();
    const data = updateSchema.parse(body);

    const template = await prisma.emailTemplate.update({
      where: { shopId_slug: { shopId: shop.id, slug: data.slug } },
      data: {
        ...(data.subject !== undefined && { subject: data.subject }),
        ...(data.bodyHtml !== undefined && { bodyHtml: data.bodyHtml }),
      },
    });

    return NextResponse.json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/email-templates error:", error);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 }
    );
  }
}
