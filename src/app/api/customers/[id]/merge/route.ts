import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const mergeSchema = z.object({
  sourceCustomerId: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: targetId } = await params;
    const body = await request.json();
    const { sourceCustomerId } = mergeSchema.parse(body);

    if (sourceCustomerId === targetId) {
      return NextResponse.json(
        { error: "Cannot merge a customer into themselves" },
        { status: 400 }
      );
    }

    const [target, source] = await Promise.all([
      prisma.customer.findUnique({ where: { id: targetId } }),
      prisma.customer.findUnique({ where: { id: sourceCustomerId } }),
    ]);

    if (!target) {
      return NextResponse.json(
        { error: "Target customer not found" },
        { status: 404 }
      );
    }
    if (!source) {
      return NextResponse.json(
        { error: "Source customer not found" },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.bike.updateMany({
        where: { customerId: sourceCustomerId },
        data: { customerId: targetId },
      });

      await tx.job.updateMany({
        where: { customerId: sourceCustomerId },
        data: { customerId: targetId },
      });

      await tx.conversation.updateMany({
        where: { customerId: sourceCustomerId },
        data: { customerId: targetId },
      });

      await tx.magicLinkToken.deleteMany({
        where: { customerId: sourceCustomerId },
      });

      await tx.chatSession.deleteMany({
        where: { customerId: sourceCustomerId },
      });

      await tx.customer.delete({ where: { id: sourceCustomerId } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "sourceCustomerId is required" },
        { status: 400 }
      );
    }
    console.error("POST /api/customers/[id]/merge error:", error);
    return NextResponse.json(
      { error: "Failed to merge customers" },
      { status: 500 }
    );
  }
}
