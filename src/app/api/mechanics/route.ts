import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";

const createMechanicSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
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

export async function GET() {
  try {
    const shop = await requireCurrentShop();
    const mechanics = await prisma.mechanic.findMany({
      where: { shopId: shop.id },
      orderBy: { fullName: "asc" },
    });
    const res = NextResponse.json(mechanics.map(serializeMechanic));
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    console.error("GET /api/mechanics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch mechanics" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const body = await request.json();
    const normalized = {
      ...body,
      email: emptyToNull(body.email),
      phone: emptyToNull(body.phone),
      birthdate: emptyToNull(body.birthdate),
      imageUrl: emptyToNull(body.imageUrl),
    };
    const data = createMechanicSchema.parse(normalized);

    const mechanic = await prisma.mechanic.create({
      data: {
        shopId: shop.id,
        fullName: data.fullName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        birthdate: parseBirthdate(data.birthdate ?? null) ?? null,
        imageUrl: data.imageUrl ?? null,
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
    console.error("POST /api/mechanics error:", error);
    return NextResponse.json(
      { error: "Failed to create mechanic" },
      { status: 500 }
    );
  }
}
