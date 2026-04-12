import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getToken } from "next-auth/jwt";

const reorderSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string(),
      columnSortOrder: z.number(),
    })
  ),
});

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { updates } = reorderSchema.parse(body);

    await prisma.$transaction(
      updates.map(({ id, columnSortOrder }) =>
        prisma.job.update({
          where: { id },
          data: { columnSortOrder },
        })
      )
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("POST /api/jobs/reorder error:", error);
    return NextResponse.json({ error: "Failed to reorder jobs" }, { status: 500 });
  }
}
