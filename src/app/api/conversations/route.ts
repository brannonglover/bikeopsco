import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const createSchema = z.object({
  customerId: z.string().min(1),
  jobId: z.string().optional().nullable(),
});

export async function GET() {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        customer: true,
        job: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { attachments: true },
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
    const body = await request.json();
    const { customerId, jobId } = createSchema.parse(body);

    const conversation = await prisma.conversation.create({
      data: {
        customerId,
        jobId: jobId ?? null,
      },
      include: {
        customer: true,
        job: true,
      },
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
