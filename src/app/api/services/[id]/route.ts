import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireStaffShop } from "@/lib/api-auth";

const updateServiceSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  price: z.number().min(0).optional(),
  isHidden: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;
    const body = await request.json();
    const data = updateServiceSchema.parse(body);

    const existing = await prisma.service.findFirst({ where: { id, shopId: auth.shopId }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    const service = await prisma.service.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.isHidden !== undefined && { isHidden: data.isHidden }),
      },
    });

    return NextResponse.json(service);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/services/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update service" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;
    const existing = await prisma.service.findFirst({ where: { id, shopId: auth.shopId } });
    if (!existing) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    if (existing.isSystem) {
      return NextResponse.json(
        { error: "System services cannot be deleted." },
        { status: 400 }
      );
    }
    await prisma.service.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/services/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete service" },
      { status: 500 }
    );
  }
}
