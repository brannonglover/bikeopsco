import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";

const updateMechanicSchema = z.object({
  fullName: z.string().trim().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Birthdate must be YYYY-MM-DD")
    .optional()
    .nullable(),
  imageUrl: z.string().optional().nullable(),
});

function emptyToNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  return typeof value === "string" ? value.trim() : null;
}

function parseBirthdate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return new Date(`${value}T00:00:00.000Z`);
}

function serializeMechanic(mechanic: {
  id: string;
  shopId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  birthdate: Date | null;
  imageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...mechanic,
    birthdate: mechanic.birthdate
      ? mechanic.birthdate.toISOString().slice(0, 10)
      : null,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const { id } = await params;
    const mechanic = await prisma.mechanic.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!mechanic) {
      return NextResponse.json({ error: "Mechanic not found" }, { status: 404 });
    }
    return NextResponse.json(serializeMechanic(mechanic));
  } catch (error) {
    console.error("GET /api/mechanics/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch mechanic" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const { id } = await params;
    const body = await request.json();
    const normalized = {
      ...body,
      ...(body.email !== undefined && { email: emptyToNull(body.email) }),
      ...(body.phone !== undefined && { phone: emptyToNull(body.phone) }),
      ...(body.birthdate !== undefined && {
        birthdate: emptyToNull(body.birthdate),
      }),
      ...(body.imageUrl !== undefined && { imageUrl: emptyToNull(body.imageUrl) }),
    };
    const data = updateMechanicSchema.parse(normalized);

    const existing = await prisma.mechanic.findFirst({
      where: { id, shopId: shop.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Mechanic not found" }, { status: 404 });
    }

    const birthdate = parseBirthdate(data.birthdate);

    const mechanic = await prisma.mechanic.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined && { fullName: data.fullName }),
        ...(data.email !== undefined && { email: data.email ?? null }),
        ...(data.phone !== undefined && { phone: data.phone ?? null }),
        ...(birthdate !== undefined && { birthdate }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl ?? null }),
      },
    });

    return NextResponse.json(serializeMechanic(mechanic));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const flattened = error.flatten();
      const fieldErrors = Object.entries(flattened.fieldErrors ?? {}).flatMap(
        ([field, msgs]) =>
          (Array.isArray(msgs) ? msgs : [msgs])
            .filter(Boolean)
            .map((m) => `${field}: ${m}`)
      );
      return NextResponse.json(
        { error: fieldErrors.join("; ") || "Invalid input" },
        { status: 400 }
      );
    }
    console.error("PATCH /api/mechanics/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update mechanic" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const { id } = await params;
    const existing = await prisma.mechanic.findFirst({
      where: { id, shopId: shop.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Mechanic not found" }, { status: 404 });
    }
    await prisma.mechanic.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/mechanics/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete mechanic" },
      { status: 500 }
    );
  }
}
